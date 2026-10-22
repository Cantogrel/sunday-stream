'use strict';

// Fenêtre d'appli Sunday Stream : menu latéral + zone de contenu. Chaque section
// est une page du service affichée dans la zone de contenu (même origine, donc
// la console et l'assistant existants sont réutilisés tels quels).
const SECTIONS = {
  live: { url: '/desktop?view=live' },
  obs: { url: '/desktop?view=obs' },
  chat: { url: '/desktop?view=chat' },
  phone: { url: '/desktop?view=phone' },
  discord: { url: '/soon.html?s=discord' },
  clips: { url: '/soon.html?s=clips' },
  settings: { url: '/settings.html' },
  wizard: { url: '/setup' },
};
const DEFAULT_SECTION = 'live';
const KEY = 'sundayStream.section';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
let current = null;

function load() {
  let s = location.hash.slice(1);
  if (!SECTIONS[s]) {
    try { s = localStorage.getItem(KEY); } catch { s = null; }
  }
  if (!SECTIONS[s]) s = DEFAULT_SECTION;
  for (const a of document.querySelectorAll('nav a[data-s]')) a.classList.toggle('active', a.dataset.s === s);
  if (s !== current) {
    current = s;
    stage.src = SECTIONS[s].url;
    try { localStorage.setItem(KEY, s); } catch { /* stockage indisponible : sans conséquence */ }
  }
}
window.addEventListener('hashchange', load);
load();

// Les sous-pages demandent parfois à changer de section (ex. « Ouvrir l'assistant »).
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'goto') return;
  if (SECTIONS[e.data.section]) location.hash = '#' + e.data.section;
  else if (typeof e.data.url === 'string' && e.data.url.startsWith('/')) stage.src = e.data.url;
});

async function pollStatus() {
  let s = null;
  try { s = await (await fetch('/api/status', { cache: 'no-store' })).json(); } catch { /* service indisponible */ }
  $('obsDot').className = 'dot ' + (s ? (s.obs.connected ? 'ok' : 'bad') : 'warn');
  $('twDot').className = 'dot ' + (s ? (s.twitch.connected ? 'ok' : 'warn') : 'warn');
  $('phDot').className = 'dot ' + (s && s.phones ? 'ok' : 'warn');
  $('phText').textContent = s?.phones ? `Téléphone ×${s.phones}` : 'Aucun téléphone';
  $('ver').textContent = s ? 'v' + s.version + (s.update?.state === 'available' ? ' · mise à jour dispo' : '') : '';
}
pollStatus();
setInterval(pollStatus, 4000);
