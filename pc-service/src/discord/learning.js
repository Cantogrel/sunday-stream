import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from '../paths.js';

// Apprentissage de la détection de clips, d'un stream à l'autre. Trois sources de retour :
//   ✅ / ❌ des admins sur un clip automatique  -> la confiance accordée au type d'émotion qui l'a
//        déclenché monte ou baisse, et le seuil se resserre ou se relâche un peu ;
//   clip manuel (bouton, raccourci, /clip)       -> un moment que l'utilisateur jugeait fort : on renforce
//        les détecteurs qui le voyaient, et on abaisse le seuil s'il était passé inaperçu ;
//   niveau habituel de la voix                   -> mémorisé, donc calibration bien plus courte à chaque live.
// Tout est borné (poids 0,5–1,3 ; seuil −0,10/+0,15) et réinitialisable : aucune dérive possible.

export const LEARNING_FILE = join(DATA_DIR, 'learning.json');
const SOURCES = ['mic', 'voice'];
const TYPES = ['exclaim', 'scream', 'laugh'];
const W_MIN = 0.5;
const W_MAX = 1.3;
const OFF_MIN = -0.1;
const OFF_MAX = 0.15;
const HISTORY_MAX = 200;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const fresh = () => ({
  weights: Object.fromEntries(SOURCES.flatMap((s) => TYPES.map((t) => [`${s}.${t}`, 1]))),
  offset: 0,
  baselines: { mic: null, voice: null },
  stats: { approved: 0, refused: 0, manual: 0 },
  history: [], // { id, types, score, done } : ce qui a déclenché chaque clip automatique publié
});

export class ClipLearner {
  // file = null : en mémoire seulement (tests, ou si le dossier de données est inutilisable).
  constructor({ file = LEARNING_FILE } = {}) {
    this.file = file;
    this.s = this._load();
  }

  _load() {
    const base = fresh();
    try {
      if (!this.file || !existsSync(this.file)) return base;
      const j = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const k of Object.keys(base.weights)) if (Number.isFinite(j.weights?.[k])) base.weights[k] = clamp(j.weights[k], W_MIN, W_MAX);
      if (Number.isFinite(j.offset)) base.offset = clamp(j.offset, OFF_MIN, OFF_MAX);
      for (const s of SOURCES) if (Number.isFinite(j.baselines?.[s])) base.baselines[s] = j.baselines[s];
      for (const k of Object.keys(base.stats)) if (Number.isFinite(j.stats?.[k])) base.stats[k] = j.stats[k];
      if (Array.isArray(j.history)) base.history = j.history.slice(-HISTORY_MAX);
    } catch { /* fichier illisible : on repart de zéro */ }
    return base;
  }

  save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.s));
      renameSync(`${this.file}.tmp`, this.file);
    } catch { /* l'apprentissage n'est jamais bloquant */ }
  }

  get offset() { return this.s.offset; }
  weight(source, type) { return this.s.weights[`${source}.${type}`] ?? 1; }

  // Score d'une source (0..1) une fois la confiance apprise appliquée à chaque type d'émotion.
  apply(source, scores) {
    return Math.min(1, Math.max(...TYPES.map((t) => (scores?.[t] || 0) * this.weight(source, t))));
  }

  // Types d'émotion qui ont réellement porté une détection : (source.type) proches du plus fort.
  _dominant(types) {
    const all = SOURCES.flatMap((s) => TYPES.map((t) => [`${s}.${t}`, (types?.[s]?.[t] || 0) * this.weight(s, t)]));
    const top = Math.max(0, ...all.map(([, v]) => v));
    return top < 0.3 ? [] : all.filter(([, v]) => v >= 0.6 * top).map(([k]) => k);
  }

  _nudge(keys, delta) {
    for (const k of keys) this.s.weights[k] = clamp(this.s.weights[k] + delta, W_MIN, W_MAX);
  }

  // À la publication d'un clip automatique : on garde ce qui l'a déclenché pour apprendre du vote.
  remember(id, { types, score }) {
    this.s.history.push({ id, types, score, done: false });
    if (this.s.history.length > HISTORY_MAX) this.s.history.shift();
    this.save();
  }

  // Verdict définitif des admins (validé / refusé) ; compté une seule fois par clip.
  vote(id, outcome) {
    const h = this.s.history.find((x) => x.id === id);
    if (!h || h.done) return false;
    if (outcome === 'validated') {
      this._nudge(this._dominant(h.types), 0.05);
      this.s.offset = clamp(this.s.offset - 0.01, OFF_MIN, OFF_MAX);
      this.s.stats.approved += 1;
    } else if (outcome === 'refused') {
      this._nudge(this._dominant(h.types), -0.08);
      this.s.offset = clamp(this.s.offset + 0.02, OFF_MIN, OFF_MAX);
      this.s.stats.refused += 1;
    } else {
      return false;
    }
    h.done = true;
    this.save();
    return true;
  }

  // Clip demandé à la main : un moment que l'utilisateur jugeait fort. `threshold` = seuil effectif.
  manual({ types, score }, threshold) {
    const keys = this._dominant(types);
    this._nudge(keys, 0.04);
    if (keys.length && score < threshold) this.s.offset = clamp(this.s.offset - 0.015, OFF_MIN, OFF_MAX);
    this.s.stats.manual += 1;
    this.save();
  }

  baseline(source) { return this.s.baselines[source]; }
  setBaseline(source, db) {
    if (!Number.isFinite(db)) return;
    this.s.baselines[source] = this.s.baselines[source] == null ? db : this.s.baselines[source] * 0.5 + db * 0.5;
    this.save();
  }

  reset() {
    const baselines = this.s.baselines; // le niveau de la voix n'est pas un « avis » : on le garde
    this.s = fresh();
    this.s.baselines = baselines;
    this.save();
  }

  summary() {
    return { ...this.s.stats, offset: Number(this.s.offset.toFixed(3)), weights: this.s.weights, hasBaselines: SOURCES.every((x) => this.s.baselines[x] != null) };
  }
}
