// Logique pure du contrat Discord (docs/CONTRACT-DISCORD.md) : aucun accès
// réseau ni horloge cachée, tout est injecté pour être testable.

export const EMBED_COLOR = 0x5865f2;
export const MARKER_PREFIX = 'sundaybot';
export const STOP_BUFFER_MINUTES = 30;
export const START_LEAD_MINUTES = 30;
export const STARTUP_JITTER_MAX = 30;
export const STREAM_LOCK_MAX_AGE_MS = 12 * 3600 * 1000;
export const APPROVALS_NEEDED = 2;
export const CONFIRM_TIMEOUT_MS = 120_000;
export const HISTORY_LIMIT = 30;

export const CHOICE = { STREAM: 0, OBS_ONLY: 1, NO: 2, NO_SESSION: 3 };

export const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');

export const dayName = (d) => DAYS_EN[d.getDay()];
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hhmm = (d) => `${pad(d.getHours())}h${pad(d.getMinutes())}`;

// Fenêtre active : jour == activeDay et début <= heure < fin (minutes ignorées).
export function isWindowActive(now, { activeDay, hourStart, hourEnd }) {
  return dayName(now) === activeDay && now.getHours() >= hourStart && now.getHours() < hourEnd;
}

// Le bot doit tourner entre (début − 30 min) et (fin + 30 min) du jour actif.
// Remplace les tâches planifiées SundayStreamBot_Start / _Stop.
export function botShouldRun(now, { activeDay, hourStart, hourEnd }) {
  if (dayName(now) !== activeDay) return false;
  const start = new Date(now);
  start.setHours(hourStart, 0, 0, 0);
  start.setMinutes(start.getMinutes() - START_LEAD_MINUTES);
  const stop = stopAt(now, { hourEnd });
  return now >= start && now < stop;
}

export function stopAt(now, { hourEnd }) {
  const stop = new Date(now);
  stop.setHours(hourEnd, 0, 0, 0);
  stop.setMinutes(stop.getMinutes() + STOP_BUFFER_MINUTES);
  return stop;
}

// « (durée 2 h 05) » / « (durée 12 min) » / « » si le début est inconnu.
export function durationText(startDt, now) {
  if (!startDt) return '';
  const total = Math.max(0, Math.floor((now - startDt) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h >= 1 ? ` (durée ${h} h ${pad(m)})` : ` (durée ${m} min)`;
}

export const LOG_TEXT = {
  window: () => '📅 **Session du dimanche** — la détection est ouverte.',
  stream: (name, now) => `🔴 Stream lancé par **${name}** à ${hhmm(now)}.`,
  fail: (name) => `⚠️ ${name} : échec du lancement du stream (OBS injoignable).`,
  end: (now, startDt) => `⚪ Stream terminé à ${hhmm(now)}${durationText(startDt, now)}.`,
  close: () => '🌙 Détection fermée. Bonne nuit.',
};

export const markerFooter = (kind, now) => `${MARKER_PREFIX}|${kind}|${isoDay(now)}`;

// Parcourt les messages (du plus récent au plus ancien) et renvoie, par kind
// demandé, la date de création du premier marqueur valide rencontré.
// `messages` : [{ authorId, createdAt: Date, footers: string[] }].
export function findMarkers(messages, clientId, wanted, day = null) {
  const found = {};
  for (const m of messages) {
    if (m.authorId !== clientId) continue;
    for (const footer of m.footers) {
      if (!footer || !footer.startsWith(`${MARKER_PREFIX}|`)) continue;
      const parts = footer.split('|');
      if (parts.length !== 3) continue;
      const [, kind, date] = parts;
      if (!wanted.has(kind) || (day && date !== day)) continue;
      if (!(kind in found)) found[kind] = m.createdAt;
    }
  }
  return found;
}

// Verrou : `stream` sans `end` plus récent, ignoré au-delà de 12 h.
export function lockState(markers, nowUtcMs) {
  const stream = markers.stream;
  if (!stream) return { held: false };
  const end = markers.end;
  if (end && end > stream) return { held: false };
  const age = nowUtcMs - stream.getTime();
  if (age > STREAM_LOCK_MAX_AGE_MS) return { held: false, stale: true, ageMs: age };
  return { held: true };
}

// Nom de la personne indiquée dans « 🔴 Stream lancé par **Bob** à 21h07. ».
export function parseStreamer(description) {
  const m = /lancé par \*\*(.+?)\*\*/.exec(description || '');
  return m ? m[1] : null;
}

// Détail du verrou pour le tableau de bord : qui diffuse et depuis quand.
// `messages` : [{ authorId, createdAt, footers, description }], du plus récent au plus ancien.
export function lockDetails(messages, clientId, nowUtcMs) {
  const markers = findMarkers(messages, clientId, new Set(['stream', 'end']));
  const st = lockState(markers, nowUtcMs);
  let by = null;
  if (st.held) {
    const msg = messages.find((m) => m.authorId === clientId && m.createdAt === markers.stream
      && m.footers.some((f) => f && f.startsWith(`${MARKER_PREFIX}|stream|`)));
    by = parseStreamer(msg?.description);
  }
  return {
    held: Boolean(st.held),
    by,
    since: st.held ? markers.stream.getTime() : null,
    lastEnd: markers.end ? markers.end.getTime() : null,
  };
}

// ---- Clips ----
export const CLIP_STATUS = {
  pending: { label: '⏳ En attente de validation', color: 0x5865f2 },
  validated: { label: '✅ Clip validé', color: 0x57f287 },
  vetoed: { label: '🚫 Clip refusé', color: 0xed4245 },
};

export const clipFooter = (messageId, status) => `${MARKER_PREFIX}|clip|${messageId}|${status}`;

// 4 segments exactement ; statut illisible => pending. Renvoie null si ce n'est pas un clip.
export function parseClipFooter(footer) {
  if (!footer || !footer.startsWith(`${MARKER_PREFIX}|clip|`)) return null;
  const parts = footer.split('|');
  const status = parts.length === 4 && CLIP_STATUS[parts[3]] ? parts[3] : 'pending';
  return { id: parts[2], status };
}

export function clipDescription({ score, mic, speech, input }) {
  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  return `Score composite : **${pct(score)}**\nMicro ${pct(mic)} · Voix ${pct(speech)} · Inputs ${pct(input)}`;
}

// Vote : seuls les administrateurs comptent. Monotone (pending -> validated -> vetoed).
export function computeClipStatus(current, { approvals, vetoes }) {
  if (current === 'vetoed') return 'vetoed';
  if (vetoes >= 1) return 'vetoed';
  if (current === 'validated') return 'validated';
  if (approvals >= APPROVALS_NEEDED) return 'validated';
  return current;
}

// ---- Invitation de groupe : IDs de salons uniquement, jamais le token ----
const ID_RE = /^\d{5,25}$/;

export function encodeInvite({ voiceChannelId, logChannelId, clipsChannelId }) {
  const payload = { v: 1, voice: String(voiceChannelId || ''), log: String(logChannelId || ''), clips: String(clipsChannelId || '') };
  return 'SS1-' + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeInvite(code) {
  const m = /^SS1-([A-Za-z0-9_-]+)$/.exec(String(code || '').trim());
  if (!m) throw new Error("Code d'invitation invalide.");
  let p;
  try {
    p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error("Code d'invitation illisible.");
  }
  if (!p || p.v !== 1) throw new Error("Version de code d'invitation inconnue.");
  const out = {};
  for (const [src, dst] of [['voice', 'voiceChannelId'], ['log', 'logChannelId'], ['clips', 'clipsChannelId']]) {
    const v = String(p[src] ?? '');
    if (v && !ID_RE.test(v)) throw new Error("Code d'invitation corrompu.");
    out[dst] = v;
  }
  return out;
}

// ---- Réglages ----
export const DEFAULT_SETTINGS = {
  modules: { couch: true, discord: false, clips: false },
  discord: {
    userId: '',
    voiceChannelId: '',
    logChannelId: '',
    clipsChannelId: '',
    activeDay: 'Sunday',
    hourStart: 20,
    hourEnd: 23,
    startingScene: 'Démarrage',
  },
  clips: { threshold: 0.65, cooldownSeconds: 90 },
};

// 0 est une valeur valide (contrairement à l'ancien `or` Python).
function hour(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

export function normalizeSettings(raw = {}) {
  const d = { ...DEFAULT_SETTINGS.discord, ...(raw.discord || {}) };
  const c = { ...DEFAULT_SETTINGS.clips, ...(raw.clips || {}) };
  const idStr = (v) => (ID_RE.test(String(v ?? '').trim()) ? String(v).trim() : '');
  const out = {
    modules: { ...DEFAULT_SETTINGS.modules, ...(raw.modules || {}) },
    discord: {
      userId: idStr(d.userId),
      voiceChannelId: idStr(d.voiceChannelId),
      logChannelId: idStr(d.logChannelId),
      clipsChannelId: idStr(d.clipsChannelId),
      activeDay: DAYS_EN.includes(d.activeDay) ? d.activeDay : 'Sunday',
      hourStart: hour(d.hourStart, 20),
      hourEnd: hour(d.hourEnd, 23),
      startingScene: String(d.startingScene || 'Démarrage'),
    },
    clips: {
      threshold: Number(c.threshold) > 0 && Number(c.threshold) <= 1 ? Number(c.threshold) : 0.65,
      cooldownSeconds: Number.isInteger(Number(c.cooldownSeconds)) && Number(c.cooldownSeconds) >= 0 ? Number(c.cooldownSeconds) : 90,
    },
  };
  for (const k of Object.keys(out.modules)) out.modules[k] = Boolean(out.modules[k]);
  if (out.discord.hourEnd <= out.discord.hourStart) {
    out.discord.hourStart = 20;
    out.discord.hourEnd = 23;
  }
  return out;
}
