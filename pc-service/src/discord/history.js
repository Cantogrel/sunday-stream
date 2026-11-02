import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from '../paths.js';

// Historique des derniers streams (20 au plus) : paramètres retenus, émotions détectées, pics de voix,
// clips et verdicts. Sert à connaître la « norme » de CE streamer et de SA bande : ce qui revient
// tout le temps (un rire par minute, des cris à chaque partie) est banal et n'a pas à être clippé ;
// seul ce qui dépasse nettement le niveau habituel l'est. Aucun audio, seulement des statistiques.

export const HISTORY_FILE = join(DATA_DIR, 'stream-history.json');
const MAX_SESSIONS = 20;
const BINS = 50; // histogramme du score composite, 0..1
const MIN_TALK_TICKS = 600; // ~10 min de son « actif » avant de se fier à la norme
const FLOOR_DB = -45;
const TYPES = ['exclaim', 'scream', 'laugh'];

const bin = (x) => Math.min(BINS - 1, Math.max(0, Math.floor(x * BINS)));
const pct = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
const round = (x, d = 3) => (x == null ? null : Number(x.toFixed(d)));

const newSession = (params, now) => ({
  id: `s${now}`,
  start: now,
  end: null,
  params, // seuil, ajustement appris, confiance par type, secondes gardées…
  ticks: 0, // secondes de stream analysées
  talkTicks: 0, // secondes où une voix (micro ou amis) était audible
  scoreBins: new Array(BINS).fill(0), // distribution du score pendant ces secondes « actives »
  maxScore: 0,
  levels: { mic: { n: 0, sum: 0, max: -100 }, voice: { n: 0, sum: 0, max: -100 } },
  events: Object.fromEntries(['mic', 'voice'].flatMap((s) => TYPES.map((t) => [`${s}.${t}`, 0]))),
  clips: { auto: 0, manual: 0, approved: 0, refused: 0 },
  clipIds: [],
});

export class StreamHistory {
  // file = null : en mémoire seulement (tests).
  constructor({ file = HISTORY_FILE, clock = () => Date.now() } = {}) {
    this.file = file;
    this.clock = clock;
    this.sessions = this._load();
    this.cur = null;
    this._edge = {}; // front montant des événements d'émotion (un événement = un franchissement du seuil 0,5)
    this._edgeAt = {};
    this._savedAt = 0;
    this._micDbs = []; // plus haut niveau de chaque seconde, pour les percentiles de fin de session
    this._voiceDbs = [];
  }

  _load() {
    try {
      if (!this.file || !existsSync(this.file)) return [];
      const j = JSON.parse(readFileSync(this.file, 'utf8'));
      const list = Array.isArray(j.sessions) ? j.sessions.filter((s) => s && Array.isArray(s.scoreBins) && s.scoreBins.length === BINS) : [];
      // Une session restée ouverte (arrêt brutal, mise à jour) est close à sa dernière sauvegarde.
      for (const s of list) if (s.end == null) s.end = s.savedAt || s.start;
      return list.slice(-MAX_SESSIONS);
    } catch {
      return [];
    }
  }

  save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const sessions = this.cur ? [...this.sessions, { ...this.cur, savedAt: this.clock() }] : this.sessions;
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ sessions: sessions.slice(-MAX_SESSIONS) }));
      renameSync(`${this.file}.tmp`, this.file);
    } catch { /* l'historique n'est jamais bloquant */ }
  }

  begin(params = {}) {
    if (this.cur) this.end();
    this.cur = newSession(params, this.clock());
    this._edge = {};
    this._edgeAt = {};
    this._micDbs = [];
    this._voiceDbs = [];
    this._savedAt = this.clock();
  }

  // Une seconde de stream : score composite, niveaux (dB) et scores par type d'émotion.
  tick({ score, micDb = null, voiceDb = null, types = null, calibrated = true }) {
    const s = this.cur;
    if (!s) return;
    const now = this.clock();
    s.ticks += 1;
    if (micDb != null) { s.levels.mic.n += 1; s.levels.mic.sum += micDb; s.levels.mic.max = Math.max(s.levels.mic.max, micDb); this._micDbs.push(micDb); }
    if (voiceDb != null) { s.levels.voice.n += 1; s.levels.voice.sum += voiceDb; s.levels.voice.max = Math.max(s.levels.voice.max, voiceDb); this._voiceDbs.push(voiceDb); }
    if (calibrated) {
      const talking = (micDb ?? -100) > FLOOR_DB || (voiceDb ?? -100) > FLOOR_DB;
      if (talking) { s.talkTicks += 1; s.scoreBins[bin(score)] += 1; }
      s.maxScore = Math.max(s.maxScore, score);
      for (const src of ['mic', 'voice']) for (const t of TYPES) {
        const k = `${src}.${t}`;
        const high = (types?.[src]?.[t] || 0) >= 0.5;
        if (high && !this._edge[k] && now - (this._edgeAt[k] || 0) > 5000) { s.events[k] += 1; this._edgeAt[k] = now; }
        this._edge[k] = high;
      }
    }
    if (now - this._savedAt > 5 * 60_000) { this._savedAt = now; this.save(); }
  }

  clip(kind, id = null) {
    if (!this.cur) return;
    if (kind === 'auto' || kind === 'manual') this.cur.clips[kind] += 1;
    if (id) { this.cur.clipIds.push(id); if (this.cur.clipIds.length > 100) this.cur.clipIds.shift(); }
  }

  // Verdict sur un clip : attribué à la session qui l'a produit (même si le vote arrive plus tard).
  vote(id, outcome) {
    const key = outcome === 'validated' ? 'approved' : outcome === 'refused' ? 'refused' : null;
    if (!key) return;
    const s = [this.cur, ...this.sessions.slice().reverse()].find((x) => x?.clipIds?.includes(id));
    if (!s) return;
    s.clips[key] += 1;
    this.save();
  }

  end() {
    const s = this.cur;
    if (!s) return;
    s.end = this.clock();
    const q = (arr, p) => round(pct([...arr].sort((a, b) => a - b), p), 1);
    s.levels.mic.p50 = q(this._micDbs, 0.5); s.levels.mic.p95 = q(this._micDbs, 0.95);
    s.levels.voice.p50 = q(this._voiceDbs, 0.5); s.levels.voice.p95 = q(this._voiceDbs, 0.95);
    this.cur = null;
    if (s.ticks >= 120) this.sessions.push(s); // un stream de moins de 2 minutes n'apprend rien
    this.sessions = this.sessions.slice(-MAX_SESSIONS);
    this.save();
  }

  _all() { return this.cur ? [...this.sessions, this.cur] : this.sessions; }

  // Distribution cumulée du score sur les derniers streams (+ le stream en cours).
  _bins() {
    const total = new Array(BINS).fill(0);
    for (const s of this._all()) s.scoreBins.forEach((n, i) => { total[i] += n; });
    return total;
  }

  get talkTicks() { return this._all().reduce((n, s) => n + s.talkTicks, 0); }

  // Score au-dessus duquel se trouvent seulement `1 − q` des secondes « actives » habituelles.
  quantile(q) {
    const bins = this._bins();
    const total = bins.reduce((a, b) => a + b, 0);
    if (!total) return null;
    let acc = 0;
    for (let i = 0; i < BINS; i++) {
      acc += bins[i];
      if (acc / total >= q) return (i + 1) / BINS;
    }
    return 1;
  }

  // Seuil de déclenchement tenant compte de la norme : jamais en dessous du seuil réglé, jamais plus de
  // +0,12 au-dessus, et seulement une fois assez de données (sinon le seuil réglé s'applique tel quel).
  // Si les moments « forts » sont banals pour cette bande (le 97e centile est déjà haut), seuls les pics
  // qui dépassent vraiment le niveau habituel sont retenus.
  adaptiveThreshold(base) {
    if (this.talkTicks < MIN_TALK_TICKS) return base;
    const usual = this.quantile(0.97);
    if (usual == null) return base;
    // Le poids de la norme croît avec la quantité de données (plein effet à ~1 h de son actif).
    const w = Math.min(1, this.talkTicks / 3600);
    return Math.min(0.97, Math.max(base, base + w * Math.min(0.12, Math.max(0, usual - base))));
  }

  summary() {
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const list = this._all().map((s) => {
      const bins = s.scoreBins;
      const total = bins.reduce((a, b) => a + b, 0);
      let acc = 0, p97 = null;
      for (let i = 0; i < BINS && total; i++) { acc += bins[i]; if (acc / total >= 0.97) { p97 = (i + 1) / BINS; break; } }
      return {
        id: s.id, start: s.start, end: s.end, minutes: Math.round(((s.end ?? this.clock()) - s.start) / 60000),
        talkMinutes: Math.round(s.talkTicks / 60), maxScore: round(s.maxScore, 2), p97, clips: s.clips,
        events: s.events, threshold: s.params?.threshold ?? null, offset: s.params?.offset ?? null,
        micP95: s.levels.mic.p95 ?? (s.levels.mic.n ? round(s.levels.mic.sum / s.levels.mic.n, 1) : null),
        live: s === this.cur,
      };
    });
    const done = list.filter((x) => !x.live && x.talkMinutes > 0);
    const perHour = (key) => {
      const h = done.reduce((n, x) => n + x.talkMinutes, 0) / 60;
      return h > 0 ? round(done.reduce((n, x) => n + (x.events[key] || 0), 0) / h, 1) : null;
    };
    return {
      sessions: list.slice().reverse(),
      norm: {
        streams: done.length,
        usualScore: round(this.quantile(0.97), 2),
        avgClipsAuto: round(mean(done.map((x) => x.clips.auto)), 1),
        avgMaxScore: round(mean(done.map((x) => x.maxScore)), 2),
        eventsPerHour: Object.fromEntries(['mic.laugh', 'mic.exclaim', 'mic.scream', 'voice.laugh', 'voice.exclaim', 'voice.scream'].map((k) => [k, perHour(k)])),
        ready: this.talkTicks >= MIN_TALK_TICKS,
      },
    };
  }

  reset() {
    this.sessions = [];
    if (this.cur) this.cur = newSession(this.cur.params, this.clock());
    this.save();
  }
}
