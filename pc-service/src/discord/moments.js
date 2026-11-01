// Détection de moments forts à partir de l'enveloppe sonore qu'OBS fournit déjà
// (InputVolumeMeters, ~20 mesures/s). Aucun audio n'est capturé ni enregistré :
// seul le niveau en dB est analysé, donc pas de hauteur de voix ni de mots —
// on repère la *dynamique* qui accompagne les émotions fortes :
//   exclamation : montée brutale bien au-dessus du niveau habituel de la voix,
//   cri         : niveau très au-dessus de l'habituel, tenu plus d'une seconde,
//   rire        : rafales régulières (4–10 par seconde) d'au moins 6 dB de creux.
// Tout est relatif au niveau habituel de CETTE voix (référence lente), pas à un seuil fixe.

export const dbOf = (mul) => 20 * Math.log10(Math.max(Number(mul) || 0, 1e-5));

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export class EmotionDetector {
  constructor({ floorDb = -45, warmupMs = 20_000, tauMs = 90_000 } = {}) {
    this.floorDb = floorDb;
    this.warmupMs = warmupMs;
    this.tauMs = tauMs;
    this.reset();
  }

  reset() {
    this.buf = []; // { t, db }
    this.baseline = null; // niveau habituel de la voix (dB), connu après la période d'apprentissage
    this.learning = []; // niveaux de parole vus pendant l'apprentissage
    this.voicedMs = 0;
    this.last = null;
  }

  // Un relevé du niveau (dB, déjà le maximum des canaux) à l'instant t (ms).
  // `learn` : ce relevé est de la parole et peut servir à établir le niveau habituel (par défaut :
  // tout ce qui dépasse le plancher de bruit) ; sinon il est seulement mémorisé pour l'analyse.
  push(t, db, learn = db > this.floorDb) {
    const dt = this.last === null ? 0 : Math.max(0, Math.min(t - this.last, 1000));
    this.last = t;
    this.buf.push({ t, db });
    while (this.buf.length && this.buf[0].t < t - 4000) this.buf.shift();
    if (!learn || db <= this.floorDb) return;
    this.voicedMs += dt;
    if (this.baseline === null) {
      // Apprentissage : la médiane de la parole entendue est plus fiable qu'un premier échantillon.
      this.learning.push(db);
      if (this.voicedMs >= this.warmupMs) {
        const sorted = [...this.learning].sort((a, b) => a - b);
        this.baseline = sorted[Math.floor(sorted.length / 2)];
        this.learning = [];
      }
      return;
    }
    // La référence ne suit pas les pics : un cri ne doit pas relever « le niveau normal » d'un coup.
    const target = Math.min(db, this.baseline + 6);
    this.baseline += (target - this.baseline) * Math.min(1, dt / this.tauMs);
  }

  get warm() {
    return this.baseline !== null && this.voicedMs >= this.warmupMs;
  }

  // Scores 0..1 à l'instant t. value = le plus fort des trois.
  score(t) {
    const zero = { exclaim: 0, scream: 0, laugh: 0, value: 0 };
    if (!this.warm) return zero;
    const win = (from, to) => this.buf.filter((s) => s.t > t - from && s.t <= t - to).map((s) => s.db);
    const base = this.baseline;

    const now = win(400, 0);
    const before = win(2400, 400);
    let exclaim = 0;
    if (now.length >= 3) {
      const excess = mean(now) - base;
      const rise = mean(now) - (before.length ? mean(before) : this.floorDb);
      if (rise >= 6) exclaim = clamp01((excess - 6) / 10);
    }

    const long = win(1500, 0);
    let scream = 0;
    if (long.length >= 12) {
      const excess = mean(long) - base;
      const low = Math.min(...long) - base;
      if (low >= 3) scream = clamp01((excess - 6) / 10);
    }

    const laugh = this._laugh(t, base);
    return { exclaim: exclaim * 0.85, scream, laugh, value: Math.max(exclaim * 0.85, scream, laugh) };
  }

  _laugh(t, base) {
    const s = this.buf.filter((x) => x.t > t - 3000);
    if (s.length < 24) return 0;
    const v = s.map((x) => x.db);
    const peaks = [];
    for (let i = 2; i < v.length - 2; i++) {
      if (!(v[i] >= v[i - 1] && v[i] > v[i + 1]) || v[i] < base - 3) continue; // plateau : le dernier point compte
      const left = v[i] - Math.min(...v.slice(Math.max(0, i - 6), i));
      const right = v[i] - Math.min(...v.slice(i + 1, i + 7));
      if (Math.min(left, right) >= 6) peaks.push(s[i].t);
    }
    // Plus longue chaîne de pics espacés de 100 à 450 ms et de rythme régulier.
    let best = 0;
    for (let i = 0; i < peaks.length; i++) {
      const gaps = [];
      for (let j = i + 1; j < peaks.length; j++) {
        const g = peaks[j] - peaks[j - 1];
        if (g < 100 || g > 450) break;
        gaps.push(g);
      }
      if (gaps.length >= 3) {
        const m = mean(gaps);
        const cv = Math.sqrt(mean(gaps.map((g) => (g - m) ** 2))) / m;
        if (cv <= 0.3) best = Math.max(best, gaps.length + 1);
      }
    }
    return clamp01((best - 3) / 3);
  }
}

// Activité manette / clavier / souris : nombre d'actions par seconde, ramené à
// la dynamique habituelle (même principe que la normalisation du contrat §7).
export function activityLevel({ keys = 0, mouse = 0, pad = 0 }) {
  return keys + mouse / 300 + pad;
}

// « Filtre de voix » pour le son du PC (jeu + amis sur Discord mélangés) : sans accès à
// l'audio brut, on juge si l'enveloppe ressemble à de la parole — alternance de syllabes et
// de creux d'au moins 12 dB, 1,3 à 9 fois par seconde, de façon irrégulière — plutôt qu'à
// de la musique (niveau stable ou battue régulière lente), une explosion (une seule
// impulsion) ou un ambiant. Renvoie 0..1 ; c'est une heuristique, pas une reconnaissance de voix.
export class VoiceGate {
  constructor({ floorDb = -50 } = {}) {
    this.floorDb = floorDb;
    this.buf = [];
  }

  reset() { this.buf = []; }

  push(t, db) {
    this.buf.push({ t, db });
    while (this.buf.length && this.buf[0].t < t - 3000) this.buf.shift();
  }

  likeness(t) {
    const s = this.buf.filter((x) => x.t > t - 3000);
    if (s.length < 40) return 0;
    const v = s.map((x) => x.db);
    const top = [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.9)];
    if (top < this.floorDb) return 0;
    let high = v[0] > top - 8;
    const onsets = [];
    let low = 0;
    for (const x of s) {
      if (x.db < top - 12) low++;
      if (high && x.db < top - 12) high = false;
      else if (!high && x.db > top - 5) { high = true; onsets.push(x.t); }
    }
    if (onsets.length < 4) return 0;
    const rate = onsets.length / 3;
    if (rate > 9) return 0; // trop dense : bruit, pas des syllabes
    const gaps = onsets.slice(1).map((o, i) => o - onsets[i]);
    const m = mean(gaps);
    const cv = Math.sqrt(mean(gaps.map((g) => (g - m) ** 2))) / m;
    const fracLow = low / v.length;
    const rateScore = clamp01((onsets.length - 3) / 4);
    const dipScore = fracLow >= 0.12 && fracLow <= 0.7 ? 1 : 0.4;
    const beatPenalty = cv < 0.12 && rate <= 3.5 ? 0.3 : 1; // battue de musique, très régulière et lente
    return clamp01(rateScore * dipScore * beatPenalty);
  }
}
