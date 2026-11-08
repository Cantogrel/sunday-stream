'use strict';

// Carte « Micro de stream » de la page Stream & OBS : choisir le micro d'OBS à mémoriser,
// activer ou couper sa surveillance (réparation automatique, voir src/discord/micGuard.js).
(() => {
  const $ = (id) => document.getElementById(id);
  const post = (p, b = {}) => fetch(p, { method: 'POST', body: JSON.stringify(b) }).then((r) => r.json());
  let inputsKey = '';

  async function refresh() {
    const s = await (await fetch('/api/discord', { cache: 'no-store' })).json();
    const r = await (await fetch('/api/obs/inputs', { cache: 'no-store' })).json();
    const names = r.ok ? r.inputs.map((i) => i.name) : [];
    const key = names.join('|') + '#' + s.settings.stream.micInput;
    if (key !== inputsKey) {
      inputsKey = key;
      $('micSel').innerHTML = names.length ? names.map((n) => `<option>${n.replace(/</g, '&lt;')}</option>`).join('') : '<option value="">— OBS non connecté —</option>';
      if (s.settings.stream.micInput) $('micSel').value = s.settings.stream.micInput;
    }
    if (document.activeElement !== $('micOn')) $('micOn').checked = s.settings.stream.micGuard;
    if (document.activeElement !== $('recOn')) $('recOn').checked = s.settings.stream.recordWithStream;
    const m = s.mic;
    $('micState').textContent = !m.enabled ? 'Surveillance désactivée.'
      : !m.configured ? 'Aucun micro mémorisé.'
      : m.state === 'warning' ? '⚠ ' + m.message
      : m.state === 'fixed' ? '🔧 ' + m.message
      : `✅ « ${m.input} » en place.`;
    $('micState').style.color = m.enabled && m.state === 'warning' ? 'var(--bad)' : 'var(--dim)';
  }

  $('micOn').onchange = async () => {
    await post('/api/discord/settings', { micGuard: $('micOn').checked });
    refresh();
  };
  $('recOn').onchange = () => post('/api/discord/settings', { recordWithStream: $('recOn').checked });
  $('btnMicSave').onclick = async () => {
    const r = await post('/api/mic/remember', { input: $('micSel').value });
    $('micState').textContent = r.ok ? 'Micro mémorisé.' : r.error;
    ui.toast(r.ok ? 'Micro de stream mémorisé.' : r.error, r.ok ? 'ok' : 'err');
    inputsKey = '';
    setTimeout(refresh, 1500);
  };
  $('btnMicForget').onclick = async () => { await post('/api/mic/forget'); ui.toast('Micro oublié : plus de surveillance.', 'ok'); inputsKey = ''; refresh(); };

  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), 4000);
})();
