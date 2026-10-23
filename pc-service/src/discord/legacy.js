import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TASKS = ['SundayStreamBot_Start', 'SundayStreamBot_Stop'];

const run = (cmd, args, timeout = 20_000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
  });

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// Retrouve l'ancien exe grâce à la tâche planifiée SundayStreamBot_Start.
export async function findLegacyBot() {
  const r = await run('schtasks', ['/Query', '/TN', TASKS[0], '/XML']);
  if (!r.ok) return { found: false, tasks: [] };
  const cmd = /<Command>([^<]+)<\/Command>/i.exec(r.out)?.[1]?.trim().replace(/^"|"$/g, '');
  const tasks = [];
  for (const t of TASKS) if ((await run('schtasks', ['/Query', '/TN', t])).ok) tasks.push(t);
  if (!cmd) return { found: false, tasks };
  const dir = dirname(cmd);
  const envPath = join(dir, '.env');
  return { found: true, exe: cmd, dir, envPath, hasEnv: existsSync(envPath), tasks };
}

// Réglages importables, sans jamais renvoyer le token ni le mot de passe OBS au navigateur.
export function mapLegacyEnv(env) {
  const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
  const discord = {
    userId: env.MY_DISCORD_USER_ID,
    voiceChannelId: env.TARGET_VOICE_CHANNEL_ID,
    logChannelId: env.LOG_CHANNEL_ID,
    clipsChannelId: env.CLIPS_CHANNEL_ID,
    activeDay: env.ACTIVE_DAY,
    hourStart: num(env.ACTIVE_HOUR_START),
    hourEnd: num(env.ACTIVE_HOUR_END),
  };
  for (const k of Object.keys(discord)) if (discord[k] === undefined || discord[k] === '' || Number.isNaN(discord[k])) delete discord[k];
  const clips = { threshold: num(env.CLIP_SCORE_THRESHOLD), cooldownSeconds: num(env.CLIP_COOLDOWN_SECONDS) };
  for (const k of Object.keys(clips)) if (clips[k] === undefined || Number.isNaN(clips[k])) delete clips[k];
  return {
    discord,
    clips,
    modules: { discord: true, clips: Boolean(env.CLIPS_CHANNEL_ID) },
    token: env.DISCORD_BOT_TOKEN || '',
    obs: { url: env.OBS_WS_HOST ? `ws://${env.OBS_WS_HOST}:${env.OBS_WS_PORT || 4455}` : '', password: env.OBS_WS_PASSWORD || '' },
  };
}

export function readLegacyEnv(envPath) {
  return mapLegacyEnv(parseEnv(readFileSync(envPath, 'utf8')));
}

// Arrêt propre de l'ancien bot (--stop), puis suppression des deux tâches planifiées.
export async function retireLegacy({ exe, tasks }) {
  const notes = [];
  if (exe && existsSync(exe)) {
    const r = await run(exe, ['--stop'], 30_000);
    notes.push(r.ok ? 'Ancien bot arrêté proprement.' : `Arrêt de l'ancien bot : ${r.err.trim() || 'sans réponse'}`);
  }
  for (const t of tasks) {
    const r = await run('schtasks', ['/Delete', '/TN', t, '/F']);
    notes.push(r.ok ? `Tâche ${t} supprimée.` : `Tâche ${t} : ${r.err.trim()}`);
  }
  return notes;
}
