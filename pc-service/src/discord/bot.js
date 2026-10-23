import { EventEmitter } from 'node:events';
import { Client, EmbedBuilder, GatewayIntentBits, Partials } from 'discord.js';
import { launchObs } from '../obsLocator.js';
import {
  CHOICE, EMBED_COLOR, HISTORY_LIMIT, LOG_TEXT, STARTUP_JITTER_MAX,
  botShouldRun, dayName, findMarkers, isWindowActive, lockDetails, lockState, markerFooter, stopAt,
} from './logic.js';

const LIVE_LOCK_TTL_MS = 15_000;
const WATCHDOG_MS = 3000;
const SCHEDULER_MS = 15_000;
const OBS_WAIT_MS = 40_000;
const LOG_RING = 200;

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`;

// Bot Discord de Sunday Stream (remplace l'exe Python « Sunday Stream Bot »).
// Comportement de référence : docs/CONTRACT-DISCORD.md. Les marqueurs de
// pied d'embed, les textes et les règles de verrou sont identiques à l'ancien
// exe pour que les 4 PC cohabitent pendant la transition.
export class DiscordBot extends EventEmitter {
  constructor({ obs, settings, confirm, now = () => new Date() }) {
    super();
    this.obs = obs;
    this.settings = settings;
    this.confirm = confirm;
    this.now = now;
    this.client = null;
    this.running = false; // connexion Discord demandée (planifiée ou manuelle)
    this.ready = false;
    this.forced = false; // démarrage manuel : pas d'arrêt automatique à fin + 30 min
    this.jitterEndsAt = 0;
    this.logLines = [];
    this._resetNight();
    this._schedulerTimer = null;
    this._watchdogTimer = null;
    this._connecting = false;
  }

  // État par processus = par soirée (contrat §3).
  _resetNight() {
    this.dialogOpen = false;
    this.stopAskingTonight = false;
    this.iLaunchedStream = false;
    this.streamStartDt = null;
    this.endPosted = false;
    this.windowOpenDone = false;
    this.windowCloseDone = false;
    this._endCheckTicks = 0;
  }

  log(msg) {
    const line = `${stamp(this.now())} ${msg}`;
    this.logLines.push(line);
    if (this.logLines.length > LOG_RING) this.logLines.shift();
    console.log(`[discord] ${msg}`);
    this.emit('log', line);
  }

  get cfg() {
    return this.settings.get().discord;
  }

  get enabled() {
    return this.settings.get().modules.discord;
  }

  async configured() {
    const c = this.cfg;
    return Boolean((await this.settings.hasToken()) && c.userId && c.voiceChannelId);
  }

  status() {
    const c = this.cfg;
    const now = this.now();
    return {
      enabled: this.enabled,
      running: this.running,
      ready: this.ready,
      forced: this.forced,
      user: this.client?.user?.tag || null,
      windowActive: isWindowActive(now, c),
      shouldRun: botShouldRun(now, c),
      jitterSeconds: this.jitterEndsAt > Date.now() ? Math.ceil((this.jitterEndsAt - Date.now()) / 1000) : 0,
      iLaunchedStream: this.iLaunchedStream,
      stopAskingTonight: this.stopAskingTonight,
      dialogOpen: this.dialogOpen,
      log: this.logLines.slice(-60),
    };
  }

  // ---- planification interne (remplace les tâches Windows Start/Stop) ----
  startScheduler() {
    if (this._schedulerTimer) return;
    this._schedulerTimer = setInterval(() => this._schedulerTick().catch((e) => this.log(`planification: ${e.message}`)), SCHEDULER_MS);
    this._schedulerTimer.unref();
    this._schedulerTick().catch(() => {});
  }

  stopScheduler() {
    clearInterval(this._schedulerTimer);
    this._schedulerTimer = null;
  }

  async _schedulerTick() {
    if (!this.enabled || this.running || this._connecting) return;
    if (!botShouldRun(this.now(), this.cfg)) return;
    if (!(await this.configured())) return;
    await this.start({ forced: false });
  }

  // ---- cycle de vie ----
  async start({ forced = false } = {}) {
    if (this.running || this._connecting) return { ok: false, error: 'déjà démarré' };
    const token = await this.settings.getToken();
    const c = this.cfg;
    const missing = [!token && 'token', !c.userId && 'ID utilisateur', !c.voiceChannelId && 'ID salon vocal'].filter(Boolean);
    if (missing.length) {
      this.log(`Config incomplète (${missing.join(', ')}).`);
      return { ok: false, error: `Config incomplète : ${missing.join(', ')}` };
    }
    this._connecting = true;
    this.running = true;
    this.forced = forced;
    this._resetNight();
    this.log(`=== Démarrage du bot (${this.now().toLocaleDateString('fr-FR')}) ===`);
    // Anti-collision entre les 4 PC : délai aléatoire avant la connexion.
    const jitterEnv = process.env.SSB_STARTUP_JITTER;
    const jitter = forced ? 0 : jitterEnv !== undefined ? Number(jitterEnv) : Math.random() * STARTUP_JITTER_MAX;
    if (jitter > 0) {
      this.jitterEndsAt = Date.now() + jitter * 1000;
      this.log(`Attente de ${jitter.toFixed(0)} s avant la connexion (anti-collision).`);
      await new Promise((r) => setTimeout(r, jitter * 1000));
      this.jitterEndsAt = 0;
      if (!this.running) { this._connecting = false; return { ok: false, error: 'arrêté pendant l\'attente' }; }
    }
    try {
      this.client = this._buildClient();
      await this.client.login(token);
    } catch (err) {
      this.log(`Connexion Discord impossible : ${err.message}`);
      this.running = false;
      this._connecting = false;
      this.client?.destroy();
      this.client = null;
      return { ok: false, error: err.message };
    }
    this._connecting = false;
    return { ok: true };
  }

  _buildClient() {
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });
    client.once('clientReady', () => this._onReady());
    client.on('voiceStateUpdate', (before, after) => this._onVoice(before, after).catch((e) => this.log(`voiceStateUpdate: ${e.message}`)));
    client.on('error', (e) => this.log(`erreur client: ${e.message}`));
    this.emit('client', client);
    return client;
  }

  _onReady() {
    this.ready = true;
    this.log(`Connecté en tant que ${this.client.user.tag}.`);
    this._watchdogTimer = setInterval(() => this._watchdog().catch((e) => this.log(`watchdog: ${e.message}`)), WATCHDOG_MS);
    this.emit('ready', this.client);
  }

  // Arrêt propre : poste « Stream terminé » si l'on a lancé le stream et que
  // OBS ne diffuse plus (sans `force`), puis se déconnecte.
  async stop(reason = 'Arrêt demandé') {
    if (!this.running) return;
    this.log(`${reason} — fermeture du bot.`);
    try {
      await this._postStreamEndIfNeeded();
    } catch (err) {
      this.log(`fin de stream: ${err.message}`);
    }
    clearInterval(this._watchdogTimer);
    this._watchdogTimer = null;
    this.ready = false;
    this.running = false;
    this._connecting = false;
    this.forced = false;
    this.jitterEndsAt = 0;
    const c = this.client;
    this.client = null;
    try { await c?.destroy(); } catch { /* déjà fermé */ }
    this.log(`=== Bot arrêté (${this.now().toLocaleDateString('fr-FR')}) ===`);
    this.emit('stopped');
  }

  // ---- voix : arrivée dans le salon cible (contrat §3) ----
  async _onVoice(before, after) {
    const c = this.cfg;
    const member = after.member || before.member;
    if (!member || member.id !== c.userId) return;
    const joined = after.channelId === c.voiceChannelId && before.channelId !== c.voiceChannelId;
    if (!joined) return;
    const now = this.now();
    if (!isWindowActive(now, c)) return this.log('Tu as rejoint le salon cible, mais hors fenêtre active — rien à faire.');
    if (this.dialogOpen) return this.log('Une fenêtre de confirmation est déjà ouverte — rien à faire.');
    if (this.stopAskingTonight) return this.log('Tu as rejoint le salon cible, mais plus de rappel prévu ce soir.');
    if (!this.iLaunchedStream && (await this._streamLockHeld())) {
      return this.log('Un stream est déjà en cours sur la chaîne (verrou Discord) — pas de fenêtre.');
    }
    this.dialogOpen = true;
    let choice = CHOICE.NO;
    try {
      choice = await this.confirm.ask();
    } finally {
      this.dialogOpen = false;
    }
    await this._handleChoice(choice, member);
  }

  async _handleChoice(choice, member) {
    const name = member.displayName || member.user?.username || 'Quelqu\'un';
    if (choice === CHOICE.STREAM) {
      const status = await this.startStream();
      if (status === 'launched') {
        this.iLaunchedStream = true;
        this.streamStartDt = this.now();
        this.stopAskingTonight = true;
        await this.postLog('stream', LOG_TEXT.stream(name, this.now()));
      } else if (status === 'already') {
        this.stopAskingTonight = true;
      } else {
        await this.postLog('fail', LOG_TEXT.fail(name), { dedup: false });
      }
    } else if (choice === CHOICE.OBS_ONLY) {
      const ok = await this.ensureObsRunning().then(() => true).catch((e) => { this.log(e.message); return false; });
      if (!ok) await this.postLog('fail', LOG_TEXT.fail(name), { dedup: false });
    } else if (choice === CHOICE.NO_SESSION) {
      this.stopAskingTonight = true;
      this.log('Plus de rappel ce soir.');
    } else {
      this.log('Stream refusé (rappel possible si tu rejoins de nouveau le vocal).');
    }
  }

  // ---- OBS (contrat §4) ----
  async ensureObsRunning(maxWaitMs = OBS_WAIT_MS) {
    if (this.obs.connected) return;
    const r = await launchObs();
    if (!r.ok) throw new Error(r.error);
    const t0 = Date.now();
    while (Date.now() - t0 < maxWaitMs) {
      await new Promise((res) => setTimeout(res, 2000));
      if (this.obs.connected) {
        this.log(`OBS prêt (après ${Math.round((Date.now() - t0) / 1000)} s).`);
        return;
      }
    }
    throw new Error(`ÉCHEC : OBS ne répond pas après ${OBS_WAIT_MS / 1000} s.`);
  }

  // Renvoie 'launched' | 'already' | 'failed'.
  async startStream() {
    try {
      await this.ensureObsRunning();
      let status = 'launched';
      if (await this.obs.isStreaming()) {
        this.log("OBS diffuse déjà — le stream n'est pas relancé.");
        status = 'already';
      } else {
        try {
          await this.obs.switchScene(this.cfg.startingScene);
        } catch (e) {
          this.log(`Scène « ${this.cfg.startingScene} » non sélectionnée : ${e.message}`);
        }
        await this.obs.startStream();
      }
      if (!(await this.obs.isRecording())) await this.obs.startRecord();
      return status;
    } catch (err) {
      this.log(`ÉCHEC du démarrage du stream : ${err.message}`);
      return 'failed';
    }
  }

  async _obsStreaming() {
    try {
      return await this.obs.isStreaming();
    } catch {
      return false;
    }
  }

  // ---- salon de logs : marqueurs, déduplication, verrou (contrat §5) ----
  async _logChannel() {
    const id = this.cfg.logChannelId;
    if (!id || !this.client) return null;
    try {
      return this.client.channels.cache.get(id) || (await this.client.channels.fetch(id));
    } catch {
      this.log(`(logs) salon ${id} introuvable.`);
      return null;
    }
  }

  async _history(channel) {
    const fetched = await channel.messages.fetch({ limit: HISTORY_LIMIT });
    return [...fetched.values()]
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .map((m) => ({
        authorId: m.author.id,
        createdAt: m.createdAt,
        footers: m.embeds.map((e) => e.footer?.text || ''),
        description: m.embeds.map((e) => e.description || '').join(' '),
      }));
  }

  // Qui diffuse sur la chaîne d'après le verrou Discord (tableau de bord « En direct »).
  // Lecture mise en cache : l'écran se rafraîchit toutes les quelques secondes.
  async liveLock() {
    const cached = this._liveLock;
    if (cached && Date.now() - cached.at < LIVE_LOCK_TTL_MS) return cached.value;
    let value = { available: false };
    const ch = this.ready ? await this._logChannel() : null;
    if (ch) {
      try {
        value = { available: true, ...lockDetails(await this._history(ch), this.client.user.id, Date.now()) };
      } catch {
        // historique illisible (permission) : le tableau de bord retombe sur OBS seul
      }
    }
    this._liveLock = { at: Date.now(), value };
    return value;
  }

  async _findMarkers(channel, wanted, day = null) {
    try {
      const messages = await this._history(channel);
      return findMarkers(messages, this.client.user.id, wanted, day);
    } catch (err) {
      if (err.code === 50013 || err.status === 403) this.log("(logs) permission « Voir l'historique des messages » manquante — verrou/anti-doublon ignorés.");
      else this.log(`(logs) lecture de l'historique impossible : ${err.message}`);
      return {};
    }
  }

  async postLog(kind, text, { dedup = true } = {}) {
    const ch = await this._logChannel();
    if (!ch) return;
    if (dedup) {
      const found = await this._findMarkers(ch, new Set([kind]), `${this.now().getFullYear()}-${pad(this.now().getMonth() + 1)}-${pad(this.now().getDate())}`);
      if (kind in found) return;
    }
    const embed = new EmbedBuilder().setColor(EMBED_COLOR).setDescription(text);
    if (dedup) embed.setFooter({ text: markerFooter(kind, this.now()) });
    try {
      await ch.send({ embeds: [embed] });
      this.log(`(logs) message posté : ${kind}`);
    } catch (err) {
      if (err.code === 50013 || err.status === 403) this.log("(logs) permission « Envoyer des messages / Intégrer des liens » manquante.");
      else this.log(`(logs) échec de l'envoi : ${err.message}`);
    }
  }

  async _streamLockHeld() {
    const ch = await this._logChannel();
    if (!ch) return false;
    const m = await this._findMarkers(ch, new Set(['stream', 'end']));
    const st = lockState(m, Date.now());
    if (st.stale) this.log(`verrou stream ignoré : marqueur 'stream' vieux de ${Math.round(st.ageMs / 3600000)} h sans 'end' (arrêt forcé probable).`);
    return st.held;
  }

  async _postStreamEndIfNeeded({ force = false } = {}) {
    if (!this.iLaunchedStream || this.endPosted) return;
    if (!force && (await this._obsStreaming())) return;
    this.endPosted = true;
    await this.postLog('end', LOG_TEXT.end(this.now(), this.streamStartDt));
  }

  // ---- surveillance (contrat §6), tick de 3 s ----
  async _watchdog() {
    if (!this.running || !this.ready || this._wd) return;
    this._wd = true;
    try {
      const now = this.now();
      const c = this.cfg;
      if (!this.windowOpenDone && isWindowActive(now, c)) {
        this.windowOpenDone = true;
        await this.postLog('window', LOG_TEXT.window());
      }
      if (this.windowOpenDone && !this.windowCloseDone && dayName(now) === c.activeDay && now.getHours() >= c.hourEnd) {
        this.windowCloseDone = true;
        await this.postLog('close', LOG_TEXT.close());
      }
      if (this.iLaunchedStream && !this.endPosted) {
        this._endCheckTicks += 1;
        if (this._endCheckTicks % 10 === 0 && !(await this._obsStreaming())) await this._postStreamEndIfNeeded({ force: true });
      }
      if (!this.forced && now >= stopAt(now, c)) {
        // On ne coupe pas la détection en plein stream lancé par ce PC.
        if (this.iLaunchedStream && !this.endPosted) return;
        await this.stop('Fin de la fenêtre active (+30 min)');
      }
    } finally {
      this._wd = false;
    }
  }

  // ---- « détecter mon ID » (contrat §9) : écoute seule, rien n'est écrit ----
  async detectId({ token, channelId, timeoutMs = Number(process.env.SSB_DETECT_TIMEOUT || 120) * 1000 }) {
    const tok = token || (await this.settings.getToken());
    if (!tok) return { error: 'login' };
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    try {
      await client.login(tok);
    } catch {
      client.destroy();
      return { error: 'login' };
    }
    try {
      await new Promise((r) => (client.isReady() ? r() : client.once('clientReady', r)));
      let ch;
      try {
        ch = await client.channels.fetch(channelId);
      } catch {
        return { error: 'channel' };
      }
      if (!ch || !ch.isVoiceBased()) return { error: 'channel' };
      const humans = [...ch.members.values()].filter((m) => !m.user.bot);
      if (humans.length === 1) return { id: humans[0].id, name: humans[0].displayName };
      return await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ error: 'timeout' }), timeoutMs);
        client.on('voiceStateUpdate', (before, after) => {
          if (after.channelId === channelId && before.channelId !== channelId && !after.member.user.bot) {
            clearTimeout(timer);
            resolve({ id: after.member.id, name: after.member.displayName });
          }
        });
      });
    } finally {
      client.destroy();
    }
  }
}
