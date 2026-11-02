'use strict';

// Fenêtre d'appli Sunday Stream : menu latéral + zone de contenu. Chaque section
// est une page du service affichée dans la zone de contenu (même origine, donc
// la console et l'assistant existants sont réutilisés tels quels).
const SECTIONS = {
  live: { url: '/live.html' },
  obs: { url: '/desktop?view=obs' },
  chat: { url: '/desktop?view=chat' },
  phone: { url: '/desktop?view=phone' },
  discord: { url: '/discord.html' },
  clips: { url: '/clips.html' },
  settings: { url: '/settings.html' },
  wizard: { url: '/setup' },
};
const DEFAULT_SECTION = 'live';
const KEY = 'sundayStream.section';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
let current = null;

function show(s, force = false) {
  if (!SECTIONS[s]) s = DEFAULT_SECTION;
  for (const a of document.querySelectorAll('nav a[data-s]')) a.classList.toggle('active', a.dataset.s === s);
  if (s !== current || force) {
    current = s;
    stage.src = SECTIONS[s].url;
    try { localStorage.setItem(KEY, s); } catch { /* stockage indisponible : sans conséquence */ }
  }
}

function load() {
  let s = location.hash.slice(1);
  if (!SECTIONS[s]) {
    try { s = localStorage.getItem(KEY); } catch { s = null; }
  }
  show(s);
}
window.addEventListener('hashchange', load);
load();

// Un clic sur le menu ramène toujours à la page de la section, même si on est dans un écran ouvert
// depuis cette section (ex. l'assistant) : le hash ne change pas, donc il faut recharger à la main.
let custom = false;
for (const a of document.querySelectorAll('nav a[data-s]')) {
  a.addEventListener('click', () => {
    if (custom && location.hash === '#' + a.dataset.s) show(a.dataset.s, true);
    custom = false;
  });
}

// Les sous-pages demandent parfois à changer de section (ex. « Ouvrir l'assistant »).
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'goto') return;
  if (SECTIONS[e.data.section]) {
    custom = false;
    if (location.hash === '#' + e.data.section) show(e.data.section, true); else location.hash = '#' + e.data.section;
  } else if (typeof e.data.url === 'string' && e.data.url.startsWith('/')) {
    custom = true;
    stage.src = e.data.url;
  }
});

// ---------- bandeau de mise à jour (toutes les sections) ----------
let upd = null;
function renderUpdate() {
  const u = upd, el = $('update');
  const text = {
    available: () => `Mise à jour disponible : version ${u.version} (installée : ${u.current}).`,
    downloading: () => `Téléchargement de la version ${u.version}… ${u.progress ?? 0} %`,
    installing: () => `Installation de la version ${u.version} : l'application va redémarrer.`,
    error: () => u.message || 'Mise à jour impossible.',
  }[u?.state];
  el.hidden = !text;
  if (!text) return;
  el.classList.toggle('err', u.state === 'error');
  $('updateText').textContent = text();
  const btn = $('updateBtn');
  btn.hidden = !['available', 'error'].includes(u.state);
  btn.textContent = u.state === 'error' ? 'Réessayer' : 'Installer maintenant';
}
$('updateBtn').onclick = async () => {
  if (upd?.state === 'error') { await ui.checkUpdate(); return; }
  const live = await fetch('/api/live', { cache: 'no-store' }).then((r) => r.json()).then((l) => Boolean(l.obs?.streaming)).catch(() => false);
  if (live && !confirm('Un live est en cours : l’installation ferme l’application et le coupe côté service. Installer quand même ?')) return;
  const r = await fetch('/api/update/install', { method: 'POST', body: JSON.stringify({ force: live }) }).then((x) => x.json());
  if (!r.ok) throw new Error(r.error || 'Installation impossible.');
  ui.toast('Installation lancée : l’application va redémarrer.', 'ok');
};

async function pollStatus() {
  let s = null;
  try { s = await (await fetch('/api/status', { cache: 'no-store' })).json(); } catch { /* service indisponible */ }
  $('obsDot').className = 'dot ' + (s ? (s.obs.connected ? 'ok' : 'bad') : 'warn');
  $('twDot').className = 'dot ' + (s ? (s.twitch.connected ? 'ok' : 'warn') : 'warn');
  $('phDot').className = 'dot ' + (s && s.phones ? 'ok' : 'warn');
  $('phText').textContent = s?.phones ? `Téléphone ×${s.phones}` : 'Aucun téléphone';
  upd = s?.update ?? null;
  renderUpdate();
  $('ver').textContent = s ? 'v' + s.version + (s.update?.state === 'available' ? ' · mise à jour dispo' : '') : '';
}
pollStatus();
setInterval(pollStatus, 4000);
