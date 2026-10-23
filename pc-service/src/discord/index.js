import { setEnvVar } from '../envFile.js';
import { DiscordBot } from './bot.js';
import { ClipsModule } from './clips.js';
import { ConfirmDialog } from './confirm.js';
import { decodeInvite, encodeInvite } from './logic.js';
import { findLegacyBot, readLegacyEnv, retireLegacy } from './legacy.js';
import { SettingsStore } from './settings.js';

// Assemble les modules Discord + Clips et expose leurs routes /api/discord/*.
export function createDiscordModules({ obs }) {
  const settings = new SettingsStore();
  const confirm = new ConfirmDialog();
  const bot = new DiscordBot({ obs, settings, confirm });
  const clips = new ClipsModule({ obs, bot, settings });

  const publicState = async () => ({
    settings: settings.get(),
    hasToken: await settings.hasToken(),
    configured: await bot.configured(),
    bot: bot.status(),
    clips: clips.status(),
    dialog: confirm.info(),
  });

  async function handle(method, path, body) {
    const route = `${method} ${path}`;
    switch (route) {
      case 'GET /api/discord':
        return publicState();

      case 'POST /api/discord/settings': {
        const prev = settings.get();
        if (typeof body.token === 'string' && body.token.trim()) await settings.setToken(body.token);
        settings.update({ modules: body.modules, discord: body.discord, clips: body.clips });
        // Modules : un module désactivé coupe immédiatement le bot.
        if (!settings.get().modules.discord && bot.running) await bot.stop('Module Discord désactivé');
        if (prev.discord.userId !== settings.get().discord.userId && bot.running) await bot.stop('Réglages modifiés');
        return { ok: true, ...(await publicState()) };
      }

      case 'POST /api/discord/start':
        return bot.start({ forced: true });
      case 'POST /api/discord/stop':
        await bot.stop('Arrêt manuel');
        return { ok: true };

      case 'POST /api/discord/detect-id': {
        const channelId = String(body.channelId || settings.get().discord.voiceChannelId || '');
        if (!channelId) return { ok: false, error: 'Renseigne d\'abord l\'ID du salon vocal.' };
        const r = await bot.detectId({ token: body.token, channelId });
        if (r.id) {
          settings.update({ discord: { userId: r.id } });
          return { ok: true, id: r.id, name: r.name };
        }
        const msg = { login: 'Connexion impossible : token invalide ?', channel: 'Salon vocal introuvable ou inaccessible au bot.', timeout: 'Personne n\'a rejoint le salon à temps.' }[r.error] || 'Détection impossible.';
        return { ok: false, error: msg };
      }

      case 'GET /api/discord/confirm':
        return confirm.info() || { id: null };
      case 'POST /api/discord/confirm':
        return { ok: confirm.answer(body.id, body.choice) };

      case 'POST /api/discord/invite/create': {
        const d = settings.get().discord;
        if (!d.voiceChannelId) return { ok: false, error: "Renseigne au moins le salon vocal." };
        return { ok: true, code: encodeInvite(d) };
      }
      case 'POST /api/discord/invite/apply': {
        try {
          const ids = decodeInvite(body.code);
          const discord = {};
          for (const [k, v] of Object.entries(ids)) if (v) discord[k] = v;
          settings.update({ discord, modules: { discord: true, clips: Boolean(ids.clipsChannelId) } });
          return { ok: true, ...(await publicState()) };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }

      case 'GET /api/discord/legacy': {
        const l = await findLegacyBot();
        const out = { found: l.found, exe: l.exe || null, tasks: l.tasks, preview: null };
        if (l.found && l.hasEnv) {
          const m = readLegacyEnv(l.envPath);
          out.preview = { ...m.discord, ...m.clips, hasToken: Boolean(m.token), obsHost: m.obs.url };
        }
        return out;
      }
      case 'POST /api/discord/legacy/import': {
        const l = await findLegacyBot();
        if (!l.found || !l.hasEnv) return { ok: false, error: "Ancien .env introuvable." };
        const m = readLegacyEnv(l.envPath);
        if (m.token) await settings.setToken(m.token);
        settings.update({ discord: m.discord, clips: m.clips, modules: m.modules });
        // OBS partagé : n'écrase pas une configuration OBS déjà faite.
        if (m.obs.password && m.obs.url && !obs.password) {
          setEnvVar('OBS_WEBSOCKET_URL', m.obs.url);
          setEnvVar('OBS_WEBSOCKET_PASSWORD', m.obs.password);
          obs.setCredentials({ url: m.obs.url, password: m.obs.password });
        }
        return { ok: true, ...(await publicState()) };
      }
      case 'POST /api/discord/legacy/retire': {
        const l = await findLegacyBot();
        if (!l.found) return { ok: false, error: "Ancien bot introuvable." };
        return { ok: true, notes: await retireLegacy(l) };
      }

      case 'POST /api/clips/trigger':
        return clips.trigger({ source: 'bouton' });
      default:
        return null;
    }
  }

  return {
    settings, confirm, bot, clips, handle,
    start() {
      clips.start();
      bot.startScheduler();
    },
    async shutdown() {
      bot.stopScheduler();
      await bot.stop('Arrêt du service');
    },
  };
}
