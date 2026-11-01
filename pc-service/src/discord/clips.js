import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { DATA_DIR } from '../paths.js';
import { MIC_INPUT_NAME } from '../obs.js';
import { EmotionDetector, VoiceGate, activityLevel, dbOf } from './moments.js';
import { CLIP_STATUS, clipDescription, clipFooter, computeClipStatus, parseClipFooter } from './logic.js';

export const CLIPS_DIR = join(DATA_DIR, 'clips');
export const DEFAULT_CLIPS_FOLDER = join(homedir(), 'Videos', 'Sunday Stream Clips');
const MIC_RE = /mic|micro|aux|voix|voice/i;
const OK_EMOJI = '✅';
const KO_EMOJI = '❌';

// OBS crée le fichier avant d'avoir fini de l'écrire : on attend que sa taille se stabilise
// avant de le déplacer ou de l'envoyer (sinon Discord reçoit un clip tronqué).
async function waitStable(path, { tries = 30, every = 500 } = {}) {
  let last = -1;
  for (let i = 0; i < tries; i++) {
    const size = statSync(path).size;
    if (size > 0 && size === last) return;
    last = size;
    await new Promise((r) => setTimeout(r, every));
  }
}

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
  constructor({ obs, bot, settings, ffmpeg = null, activity = null, clock = () => Date.now() }) {
    super();
    this.ffmpeg = ffmpeg;
    this.activity = activity;
    this.clock = clock;
    this.obs = obs;
    this.bot = bot;
    this.settings = settings;
    this.busy = false;
    this.recent = [];
    // Micro et voix des amis : émotions lues dans l'enveloppe sonore (moments.js) ;
    // Inputs : activité manette / clavier / souris, normalisée.
    this.emotion = { mic: new EmotionDetector(), voice: new EmotionDetector() };
    this.gate = new VoiceGate(); // filtre de voix appliqué au son du PC
    this.desktopNames = new Set();
    this._desktopAt = 0;
    this.norm = { input: new Normalizer() };
    this.cooldown = 0;
    this.active = false;
    this.maxScore = 0;
    this.lastScores = { score: 0, mic: 0, speech: 0, input: 0 };
    this._timer = null;

    obs.on('volume-meters', (inputs) => this._onMeters(inputs));
    obs.on('event', (e) => {
      if (e.name === 'obs.stream_state') this._onStreamState(e.active).catch((err) => this.bot.log(`(clips) ${err.message}`));
    });
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

  // Replay Buffer lancé avec le stream (module Clips actif) ; à l'arrêt du stream,
  // enregistrement et Replay Buffer coupés si l'option est cochée.
  async _onStreamState(active) {
    if (active) {
      if (!this.enabled) return;
      if (!(await this.obs.replayBufferActive())) {
        await this.obs.startReplayBuffer();
        this.bot.log('(clips) Replay Buffer démarré avec le stream.');
      }
      return;
    }
    if (!this.cfg.stopWithStream) return;
    // Un clip en cours de sauvegarde ne doit pas être coupé net.
    for (let i = 0; this.busy && i < 10; i++) await new Promise((r) => setTimeout(r, 1000));
    const stopped = [];
    if (await this.obs.isRecording()) { await this.obs.stopRecord(); stopped.push('enregistrement'); }
    if (await this.obs.replayBufferActive()) { await this.obs.stopReplayBuffer(); stopped.push('Replay Buffer'); }
    if (stopped.length) this.bot.log(`(clips) stream arrêté : ${stopped.join(' et ')} coupé${stopped.length > 1 ? 's' : ''}.`);
  }

  // Niveaux OBS (~20/s) : le micro et les entrées « voix des amis » alimentent chacun un
  // détecteur d'émotion ; le son du jeu est volontairement ignoré (toujours fort, peu parlant).
  _onMeters(inputs) {
    const t = this.clock();
    const stream = this.settings.get().stream;
    // Voix des amis : entrées choisies, sinon le son du PC (où passe Discord), repéré automatiquement.
    const voiceNames = this.cfg.voiceInputs.length ? new Set(this.cfg.voiceInputs) : this.desktopNames;
    let mic = null;
    let voice = null;
    for (const i of inputs || []) {
      const peak = Math.max(0, ...(i.inputLevelsMul || []).map((c) => c[1] || 0));
      if (voiceNames.has(i.inputName)) voice = Math.max(voice ?? 0, peak);
      // Micro du PC (celui mémorisé, ou repéré par son nom) et flux micro du téléphone.
      else if (i.inputName === MIC_INPUT_NAME || (stream.micInput ? i.inputName === stream.micInput : MIC_RE.test(i.inputName))) mic = Math.max(mic ?? 0, peak);
    }
    if (mic !== null) this.emotion.mic.push(t, dbOf(mic));
    if (voice !== null) {
      this.emotion.voice.push(t, dbOf(voice));
      this.gate.push(t, dbOf(voice));
    }
  }

  // Repère l'entrée « son du PC » d'OBS (capture de sortie audio) pour l'analyse de la voix des amis.
  async _refreshDesktop() {
    this._desktopAt = this.clock();
    try {
      const inputs = await this.obs.listAudioInputs();
      this.desktopNames = new Set(inputs.filter((i) => /output_capture/.test(i.kind) || /desktop|bureau|son du pc|audio du pc/i.test(i.name)).map((i) => i.name));
    } catch {
      // OBS indisponible : on garde la liste précédente
    }
  }

  _setActive(on) {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.norm.input.reset();
      this.cooldown = 0;
      this.activity?.start();
      this.maxScore = 0;
      this.bot.log('(clips) détection démarrée — OBS diffuse sur cette machine.');
    } else {
      this.activity?.stop();
      this.bot.log(`(clips) détection arrêtée. Score max atteint : ${this.maxScore.toFixed(2)} (seuil ${this.cfg.threshold}).`);
    }
  }

  async _tick() {
    const live = this.enabled && this.bot.ready && this.obs.connected && this.obs.streaming;
    this._setActive(Boolean(live));
    if (!live) return;
    const t = this.clock();
    if (this.obs.listAudioInputs && t - this._desktopAt > 60_000) await this._refreshDesktop();
    const mic = this.emotion.mic.score(t).value;
    // Le son du PC mélange jeu et amis : ce qui ressemble à de la voix compte à plein, le reste très peu.
    const speech = this.emotion.voice.score(t).value * (0.15 + 0.85 * this.gate.likeness(t));
    const sample = this.cfg.useActivity ? this.activity?.latest : null;
    const input = sample ? this.norm.input.push(activityLevel(sample)) : 0;
    // Les émotions (micro, ou voix des amis un peu moins sûre) font le score ; l'activité de jeu
    // l'amplifie ou le tempère de ±15 % mais ne peut jamais déclencher un clip seule.
    const score = Math.min(1, Math.max(mic, speech * 0.9) * (0.85 + 0.3 * input));
    this.lastScores = { score, mic, speech, input };
    this.maxScore = Math.max(this.maxScore, score);
    if (this.cooldown > 0) {
      this.cooldown -= 1;
      return;
    }
    if (score > this.cfg.threshold) {
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
      const saved = await this.obs.saveReplayBuffer((p) => existsSync(p));
      if (!saved) throw new Error('Fichier du clip introuvable après la sauvegarde.');
      await waitStable(saved);
      const path = this.store(saved);
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

  // Dossier dédié aux clips (réglable), à la place du dossier d'enregistrement d'OBS.
  get folder() {
    return this.cfg.folder || DEFAULT_CLIPS_FOLDER;
  }

  // Déplace le fichier sauvegardé par OBS dans le dossier des clips ; en cas d'échec,
  // le clip reste où OBS l'a mis (rien n'est perdu).
  store(path) {
    try {
      mkdirSync(this.folder, { recursive: true });
      let dest = join(this.folder, basename(path));
      for (let n = 2; existsSync(dest); n++) dest = join(this.folder, `${basename(path, extname(path))} (${n})${extname(path)}`);
      try {
        renameSync(path, dest);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        copyFileSync(path, dest);
        unlinkSync(path);
      }
      return dest;
    } catch (err) {
      this.bot.log(`(clips) dossier des clips inutilisable (${err.message}) — fichier laissé dans le dossier d'OBS.`);
      return path;
    }
  }

  // ---- publication (contrat §8.1) ----
  async publish(path, scores) {
    const channel = await this.bot.client.channels.fetch(this.settings.get().discord.clipsChannelId);
    const embed = new EmbedBuilder()
      .setTitle(CLIP_STATUS.pending.label)
      .setColor(CLIP_STATUS.pending.color)
      .setDescription(clipDescription(scores));
    const payload = { embeds: [embed] };
    const limit = fileLimitBytes(channel.guild);
    // Discord ne lit que du MP4 H.264 et limite la taille : ffmpeg (téléchargé au premier usage)
    // convertit ou réencode au besoin ; l'original reste dans le dossier des clips.
    const size = statSync(path).size;
    const prepared = this.ffmpeg ? await this.ffmpeg.prepare(path, limit) : null;
    const compressed = prepared;
    if (compressed || size < limit) {
      payload.files = [new AttachmentBuilder(compressed ? compressed.path : path, compressed ? { name: `${basename(path, extname(path))}.mp4` } : undefined)];
    } else {
      embed.addFields({ name: 'Fichier trop volumineux pour Discord', value: `Récupère-le localement : \`${path}\``, inline: false });
    }
    // Envoi SANS pied, puis édition pour le poser : tant que le pied manque, le message n'est pas un clip.
    let msg;
    try {
      msg = await channel.send(payload);
    } finally {
      compressed?.cleanup();
    }
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
      this.bot.log(`(clips) commande /clip non enregistrée (${err.message}) — réinvite le bot avec le lien de la section Discord (droit « commandes »). Le bouton de l'app reste disponible.`);
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
