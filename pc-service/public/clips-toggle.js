// Bouton de la fenêtre principale : met la détection automatique des clips en pause / la reprend
// à chaud, sans passer par la page Clips ni toucher au Replay Buffer d'OBS.
(() => {
  const btn = document.getElementById('clipsBtn');
  if (!btn) return;
  let auto = true;

  const paint = (s) => {
    const on = s.settings.modules.clips && Boolean(s.settings.discord.clipsChannelId);
    btn.classList.toggle('hidden', !on);
    auto = s.settings.clips.auto;
    btn.textContent = auto ? 'Clips auto : actifs' : 'Clips auto : en pause';
    btn.title = auto ? 'Cliquer pour mettre la détection en pause (les clips manuels restent possibles)' : 'Cliquer pour reprendre la détection';
    btn.classList.toggle('paused', !auto);
  };
  const refresh = async () => paint(await (await fetch('/api/discord', { cache: 'no-store' })).json());

  btn.onclick = async () => {
    const r = await (await fetch('/api/discord/settings', { method: 'POST', body: JSON.stringify({ clips: { auto: !auto } }) })).json();
    if (!r.ok) throw new Error(r.error || 'Échec.');
    await refresh();
    ui.toast(auto ? 'Détection des clips reprise.' : 'Détection des clips en pause : plus aucun clip automatique.', 'ok');
  };

  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), 4000);
})();
