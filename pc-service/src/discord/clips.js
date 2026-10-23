import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { DATA_DIR } from '../paths.js';
import { MIC_INPUT_NAME } from '../obs.js';
import { CLIP_STATUS, clipDescription, clipFooter, computeClipStatus, parseClipFooter } from './logic.js';

export const CLIPS_DIR = join(DATA_DIR, 'clips');
const WEIGHTS = { mic: 0.3, speech: 0.3, input: 0.4 };
const MIN_DURATION_TICKS = 3;
const MIC_RE = /mic|micro|aux|voix|voice/i;
const OK_EMOJI = '✅';
const KO_EMOJI = '❌';

// Normalisation adaptative par signal (contrat §7) : la valeur est la part du
// niveau au-dessus du bruit de fond (baseline) rapportée à la dynamique vue.
export class Normalizer {
  constructor() { this.reset(); }
  reset() { this.baseline = null; this.ceiling = 0; }
  push(raw) {
    if (this.baseline === null) {
      this.baseline = raw;
      this.ceiling = raw;
      return 0;
    }
    this.ceiling = Math.max(raw, this.ceiling * 0.999, this.baseline);
    this.baseline = this.baseline * 0.99 + raw * 0.01;
    const span = Math.max(this.ceiling - this.baseline, 1e-6);
    return Math.min(1, Math.max(0, (raw - this.baseline) / span));
  }
}

function fileLimitBytes(guild) {
  // discord.js n'expose pas la limite d'envoi : déduite du palier de boost (10 Mo par défaut).
  const mb = guild?.premiumTier === 3 ? 100 : guild?.premiumTier === 2 ? 50 : 10;
  return mb * 1024 * 1024;
}

// Module Clips : Replay Buffer OBS -> publication dans le salon de clips ->
// vote des administrateurs, à l'identique de l'ancien exe (contrat §8).
// La détection automatique lit les niveaux sonores qu'OBS fournit déjà
// (InputVolumeMeters) au lieu de capter le PC :
//   Micro  = pic des entrées de type micro,
//   Voix   = pic soudain (hausse brusque du niveau, rires, cris),
//   Inputs = pic des autres entrées (audio du jeu).
// Le score composite garde les pondérations 0,3 / 0,3 / 0,4 de l'ancien exe.
export class ClipsModule extends EventEmitter {
  constructor({ obs, bot, settings }) {
    super();
    this.obs = obs;
    this.bot = bot;
    this.settings = settings;
    this.busy = false;
    this.recent = [];
    this.norm = { mic: new Normalizer(), speech: new Normalizer(), input: new Normalizer() };
    this.acc = { mic: 0, game: 0, spike: 0 };
    this.prevPeaks = new Map();
    this.streak = 0;
    this.cooldown = 0;
    this.active = false;
    this.maxScore = 0;
    this.lastScores = { score: 0, mic: 0, speech: 0, input: 0 };
    this._timer = null;

    obs.on('volume-meters', (inputs) => this._onMeters(inputs));
    bot.on('client', (client) => this._attach(client));
    bot.on('stopped', () => this._setActive(false));
  }

  get cfg() { return this.settings.get().clips; }
  get enabled() { return this.settings.get().modules.clips && Boolean(this.settings.get().discord.clipsChannelId); }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick().catch((e) => this.bot.log(`(clips) erreur de détection : ${e.message}`)), 1000);
    this._timer.unref();
  }

  status() {
    return { enabled: this.enabled, active: this.active, last: this.lastScores, maxScore: this.maxScore, cooldown: this.cooldown, recent: this.recent.slice(-10) };
  }

  _onMeters(inputs) {
    for (const i of inputs || []) {
      const peak = Math.max(0, ...(i.inputLevelsMul || []).map((c) => c[1] || 0));
      const prev = this.prevPeaks.get(i.inputName) ?? peak;
      this.prevPeaks.set(i.inputName, peak);
      const isMic = i.inputName === MIC_INPUT_NAME || MIC_RE.test(i.inputName);
      if (isMic) this.acc.mic = Math.max(this.acc.mic, peak);
      else this.acc.game = Math.max(this.acc.game, peak);
      this.acc.spike = Math.max(this.acc.spike, peak - prev);
    }
  }

  _setActive(on) {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      for (const n of Object.values(this.norm)) n.reset();
      this.streak = 0;
      this.cooldown = 0;
      this.maxScore = 0;
      this.bot.log('(clips) détection démarrée — OBS diffuse sur cette machine.');
    } else {
      this.bot.log(`(clips) détection arrêtée. Score max atteint : ${this.maxScore.toFixed(2)} (seuil ${this.cfg.threshold}).`);
    }
  }

  async _tick() {
    const live = this.enabled && this.bot.ready && this.obs.connected && this.obs.streaming;
    this._setActive(Boolean(live));
    const raw = this.acc;
    this.acc = { mic: 0, game: 0, spike: 0 };
    if (!live) return;
    const mic = this.norm.mic.push(raw.mic);
    const speech = this.norm.speech.push(Math.max(0, raw.spike));
    const input = this.norm.input.push(raw.game);
    const score = WEIGHTS.mic * mic + WEIGHTS.speech * speech + WEIGHTS.input * input;
    this.lastScores = { score, mic, speech, input };
    this.maxScore = Math.max(this.maxScore, score);
    if (this.cooldown > 0) {
      this.cooldown -= 1;
      this.streak = 0;
      return;
    }
    this.streak = score > this.cfg.threshold ? this.streak + 1 : 0;
    if (this.streak >= MIN_DURATION_TICKS) {
      this.streak = 0;
      this.cooldown = this.cfg.cooldownSeconds;
      await this.trigger({ source: 'auto', scores: this.lastScores });
    }
  }

  // Déclenchement (auto, bouton de l'app, /clip) : sauvegarde le Replay Buffer
  // puis publie le fichier.
  async trigger({ source = 'manual', scores = null } = {}) {
    if (!this.enabled) return { ok: false, error: 'Module Clips désactivé ou salon de clips non renseigné.' };
    if (!this.bot.ready) return { ok: false, error: "Le bot Discord n'est pas connecté." };
    if (!this.obs.connected) return { ok: false, error: "OBS n'est pas connecté." };
    if (this.busy) return { ok: false, error: 'Un clip est déjà en cours de sauvegarde.' };
    this.busy = true;
    try {
      if (!(await this.obs.replayBufferActive())) {
        await this.obs.startReplayBuffer().catch(() => {
          throw new Error("Replay Buffer inactif : active-le une fois dans OBS (Réglages → Sortie → Enregistrement).");
        });
        return { ok: false, error: "Replay Buffer démarré à l'instant : il n'a encore rien enregistré. Réessaie dans quelques secondes." };
      }
      const path = await this.obs.saveReplayBuffer((p) => existsSync(p));
      if (!path) throw new Error('Fichier du clip introuvable après la sauvegarde.');
      const s = scores || { score: 0, mic: 0, speech: 0, input: 0 };
      const id = await this.publish(path, s);
      this.recent.push({ id, at: Date.now(), source, file: basename(path) });
      this.bot.log(`(clips) clip publié (${source}) : ${basename(path)}`);
      return { ok: true, id };
    } catch (err) {
      this.bot.log(`(clips) échec : ${err.message}`);
      return { ok: false, error: err.message };
    } finally {
      this.busy = false;
    }
  }

  // ---- publication (contrat §8.1) ----
  async publish(path, scores) {
    const channel = await this.bot.client.channels.fetch(this.settings.get().discord.clipsChannelId);
    const size = statSync(path).size;
    const embed = new EmbedBuilder()
      .setTitle(CLIP_STATUS.pending.label)
      .setColor(CLIP_STATUS.pending.color)
      .setDescription(clipDescription(scores));
    const payload = { embeds: [embed] };
    if (size < fileLimitBytes(channel.guild)) {
      payload.files = [new AttachmentBuilder(path)];
    } else {
      embed.addFields({ name: 'Fichier trop volumineux pour Discord', value: `Récupère-le localement : \`${path}\``, inline: false });
    }
    // Envoi SANS pied, puis édition pour le poser : tant que le pied manque, le message n'est pas un clip.
    const msg = await channel.send(payload);
    embed.setFooter({ text: clipFooter(msg.id, 'pending') });
    await msg.edit({ embeds: [embed] });
    await msg.react(OK_EMOJI);
    await msg.react(KO_EMOJI);
    mkdirSync(CLIPS_DIR, { recursive: true });
    copyFileSync(path, join(CLIPS_DIR, `${msg.id}${extname(path)}`));
    return msg.id;
  }

  // ---- vote (contrat §8.2) : état entièrement dérivé de Discord ----
  _attach(client) {
    const onReaction = (reaction) => this._syncFromReaction(reaction).catch((e) => this.bot.log(`(clips) vote : ${e.message}`));
    client.on('messageReactionAdd', onReaction);
    client.on('messageReactionRemove', onReaction);
    client.on('interactionCreate', (i) => this._onInteraction(i).catch((e) => this.bot.log(`(clips) /clip : ${e.message}`)));
    client.once('clientReady', () => this._registerCommand(client));
  }

  async _syncFromReaction(reaction) {
    if (reaction.partial) reaction = await reaction.fetch();
    const emoji = reaction.emoji.name;
    if (emoji !== OK_EMOJI && emoji !== KO_EMOJI) return;
    let message = reaction.message;
    if (message.partial) message = await message.fetch();
    if (message.channelId !== this.settings.get().discord.clipsChannelId) return;
    if (message.author?.id !== this.bot.client.user.id) return;
    const embed = message.embeds[0];
    const info = parseClipFooter(embed?.footer?.text);
    if (!info) return;
    const guild = message.guild;
    const count = async (name) => {
      const r = message.reactions.cache.find((x) => x.emoji.name === name);
      if (!r) return 0;
      const users = await r.users.fetch();
      let n = 0;
      for (const u of users.values()) {
        if (u.bot) continue;
        const m = await guild.members.fetch(u.id).catch(() => null);
        if (m?.permissions.has('Administrator')) n += 1;
      }
      return n;
    };
    const next = computeClipStatus(info.status, { approvals: await count(OK_EMOJI), vetoes: await count(KO_EMOJI) });
    if (next === info.status) return;
    // Titre, couleur et pied réécrits ; la description (score) est conservée.
    const updated = EmbedBuilder.from(embed).setTitle(CLIP_STATUS[next].label).setColor(CLIP_STATUS[next].color).setFooter({ text: clipFooter(message.id, next) });
    await message.edit({ embeds: [updated] });
    this.bot.log(`(clips) clip ${message.id} : ${info.status} -> ${next}`);
  }

  // ---- /clip ----
  async _registerCommand(client) {
    try {
      const ch = await client.channels.fetch(this.settings.get().discord.voiceChannelId);
      await ch.guild.commands.create({ name: 'clip', description: 'Enregistrer un clip des dernières secondes du stream' });
    } catch (err) {
      this.bot.log(`(clips) commande /clip non enregistrée (${err.message}) — le bouton de l'app reste disponible.`);
    }
  }

  async _onInteraction(i) {
    if (!i.isChatInputCommand() || i.commandName !== 'clip') return;
    // Une seule machine répond : celle qui diffuse vers la chaîne.
    if (!this.enabled || !this.obs.connected || !this.obs.streaming) return;
    await i.deferReply({ ephemeral: true });
    const r = await this.trigger({ source: `/clip (${i.user.username})` });
    await i.editReply(r.ok ? '🎬 Clip enregistré, il arrive dans le salon des clips.' : `⚠️ ${r.error}`);
  }
}
