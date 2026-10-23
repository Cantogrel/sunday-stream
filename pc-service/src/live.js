const CHAT_LIMIT = 20;

// Agrège l'état « En direct » pour la fenêtre de l'appli : OBS (stream, scène,
// santé), verrou Discord (qui diffuse), chat Twitch, spectateurs et clips récents.
// Chaque source est optionnelle : une source en panne laisse les autres affichées.
export async function buildLive({ obs, discord, chat, viewers }) {
  const safe = (p) => Promise.resolve(p).catch(() => null);
  // Le relevé des spectateurs ne tourne que si quelqu'un regarde (voir ViewerStats).
  if (viewers) viewers.watchedAt = Date.now();

  const state = obs.connected ? await safe(obs.getState()) : null;
  const streaming = Boolean(state?.streaming);
  const health = streaming ? await safe(obs.getHealth()) : null;

  const settings = discord?.settings.get();
  const discordOn = Boolean(settings?.modules.discord);
  const lock = discordOn ? await safe(discord.bot.liveLock()) : null;

  let streamer = null;
  if (lock?.held) {
    streamer = { name: lock.by, since: lock.since, here: Boolean(discord.bot.iLaunchedStream), source: 'discord' };
  } else if (streaming) {
    // OBS diffuse ici sans marqueur Discord : lancé à la main ou module Discord coupé.
    streamer = { name: null, since: state.streamDurationMs != null ? Date.now() - state.streamDurationMs : null, here: true, source: 'obs' };
  }

  const messages = (chat?.getHistory() || []).filter((m) => !m.deleted).slice(-CHAT_LIMIT);

  return {
    at: Date.now(),
    live: Boolean(streamer) || streaming,
    streamer,
    obs: {
      connected: Boolean(obs.connected),
      streaming,
      scene: state?.currentScene ?? null,
      scenes: state?.scenes ?? [],
      durationMs: state?.streamDurationMs ?? null,
      health,
    },
    discord: {
      enabled: discordOn,
      ready: Boolean(discord?.bot.ready),
      lockAvailable: Boolean(lock?.available),
      lastEnd: lock?.lastEnd ?? null,
    },
    viewers: viewers?.value ?? { live: false, viewers: null, chatters: null },
    chat: messages.map((m) => ({ id: m.id, name: m.displayName, text: m.text, at: m.timestamp, mod: m.isMod })),
    clips: discordOn || settings?.modules.clips ? (discord.clips.status().recent || []).slice().reverse() : [],
  };
}
