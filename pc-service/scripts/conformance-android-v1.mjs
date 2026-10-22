// Joue le rôle d'un téléphone Android v1 contre un service en marche et vérifie
// le contrat docs/CONTRACT-ANDROID-V1.md : /hello, jumelage, authentification,
// séquence d'accueil, commandes, mDNS.
// Usage : node scripts/conformance-android-v1.mjs [port=8765]
// Doit tourner sur le PC du service (utilise les routes loopback /api/session et
// /api/pairing pour obtenir un token partagé et un code de jumelage).
import { WebSocket } from 'ws';
import { Bonjour } from 'bonjour-service';

const port = Number(process.argv[2] || 8765);
const base = `http://127.0.0.1:${port}`;
let failed = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond ? '' : ' ' + extra}`);
  if (!cond) failed++;
};
const json = (p, o) => fetch(base + p, o).then((r) => r.json());

function openWs(token, { protocol = 1, appVersion = '0.1.4', send = true } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msgs = [];
    const waiters = [];
    const api = { ws, msgs, closed: null };
    ws.on('open', () => send && ws.send(JSON.stringify({ type: 'auth', token, appVersion, protocol })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      msgs.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    });
    ws.on('close', (code, reason) => { api.closed = { code, reason: reason.toString() }; for (const w of waiters) w.resolve(null); });
    api.wait = (pred, ms = 8000) => new Promise((res) => {
      const found = msgs.find(pred);
      if (found) return res(found);
      const w = { pred, resolve: res };
      waiters.push(w);
      setTimeout(() => res(null), ms);
    });
    let id = 1;
    api.cmd = async (action, payload = {}) => {
      const my = id++;
      ws.send(JSON.stringify({ type: 'command', id: my, action, payload }));
      return api.wait((m) => m.type === 'result' && m.id === my);
    };
    api.waitClose = (ms = 7000) => new Promise((res) => { if (api.closed) return res(api.closed); const t = setInterval(() => { if (api.closed) { clearInterval(t); res(api.closed); } }, 50); setTimeout(() => { clearInterval(t); res(api.closed); }, ms); });
    ws.on('open', () => resolve(api));
  });
}

// --- HTTP ---
const hello = await json('/hello');
ok(hello.app === 'couch-stream', '/hello app == "couch-stream"');
ok(typeof hello.id === 'string' && hello.id.length > 8, '/hello id');
ok(hello.protocol === 1, '/hello protocol == 1');
ok(hello.port === port, '/hello port réel', `(${hello.port})`);
ok(typeof hello.version === 'string' && /^\d+\.\d+\.\d+/.test(hello.version), '/hello version', hello.version);
const [maj, min, pat] = hello.version.split('.').map(Number);
ok(maj > 0 || min > 1 || (min === 1 && pat >= 4), 'pcVersion >= 0.1.4', hello.version);

const pairing = await json('/api/pairing');
ok(typeof pairing.code === 'string' && pairing.code.length === 32, '/api/pairing expose un code à usage unique');
const pair1 = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ code: pairing.code, name: 'Test conformité' }) });
const paired = await pair1.json();
ok(pair1.status === 200 && typeof paired.token === 'string' && paired.pcId === hello.id && typeof paired.name === 'string', 'POST /api/pair (text/plain) → {token, pcId, name}');
const pair2 = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ code: pairing.code }) });
ok(pair2.status === 403, 'code déjà utilisé → 403', String(pair2.status));
const pair3 = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"code":"zz"}' });
ok(pair3.status === 403 && (await pair3.json()).error === 'code invalide ou expiré', 'code invalide → 403 + message');
const opt = await fetch(`${base}/api/pair`, { method: 'OPTIONS' });
ok(opt.status === 204 && opt.headers.get('access-control-allow-origin') === '*', 'CORS OPTIONS 204');
const apk = await fetch(`${base}/app.apk`);
ok([200, 404].includes(apk.status), '/app.apk répond', String(apk.status));
if (apk.status === 200) ok(apk.headers.get('content-type') === 'application/vnd.android.package-archive', '/app.apk content-type');
else console.log('INFO /app.apk absent (pas d\'APK embarquée dans ce build)');
const root = await fetch(`${base}/`);
ok(root.status === 200, 'GET / sert l\'UI du téléphone');

// --- WebSocket ---
const noAuth = await openWs('', { send: false });
const c1 = await noAuth.waitClose(7000);
ok(c1?.code === 4001, 'silence 5 s → fermeture 4001', JSON.stringify(c1));

const bad = await openWs('mauvais-token');
const c2 = await bad.waitClose(3000);
ok(c2?.code === 4003, 'mauvais token → 4003', JSON.stringify(c2));

const phone = await openWs(paired.token);
const welcome = await phone.wait((m) => m.type === 'welcome');
ok(welcome && typeof welcome.pcVersion === 'string' && welcome.protocol === 1, 'welcome {pcVersion, protocol:1}');
const state = await phone.wait((m) => m.type === 'state');
ok(state && 'obsConnected' in state && Array.isArray(state.scenes) && 'streaming' in state && 'micMuted' in state && 'micVolume' in state && 'congestion' in state, 'state (objet complet)');
const hist = await phone.wait((m) => m.type === 'chat-history');
ok(hist && Array.isArray(hist.messages), 'chat-history {messages[]}');
const viewers = await phone.wait((m) => m.type === 'event' && m.name === 'twitch.viewers');
ok(viewers && 'live' in viewers && 'viewers' in viewers && 'chatters' in viewers, 'event twitch.viewers');
const upd = await phone.wait((m) => m.type === 'event' && m.name === 'update.status');
ok(upd && typeof upd.state === 'string', 'event update.status', JSON.stringify(upd));
const order = phone.msgs.map((m) => (m.type === 'event' ? m.name : m.type)).filter((x) => ['welcome', 'state', 'chat-history', 'twitch.viewers', 'update.status'].includes(x));
ok(order.join(',') === 'welcome,state,chat-history,twitch.viewers,update.status', 'séquence d\'accueil', order.join(','));

const r1 = await phone.cmd('state.get');
ok(r1?.ok === true && r1.data && 'obsConnected' in r1.data, 'command state.get');
const r2 = await phone.cmd('nope.nothing');
ok(r2?.ok === false && r2.error === 'Action inconnue: nope.nothing', 'action inconnue → erreur exacte', JSON.stringify(r2));
const r3 = await phone.cmd('audio.getSettings');
ok(r3?.ok === true && typeof r3.data.jitterBufferMs === 'number', 'audio.getSettings');
const r4 = await phone.cmd('audio.setJitterBuffer', { ms: 5 });
ok(r4?.ok === false && /hors plage/.test(r4.error), 'audio.setJitterBuffer hors plage refusé');
const r5 = await phone.cmd('update.getStatus');
ok(r5?.ok === true && typeof r5.data.state === 'string', 'update.getStatus');
const r6 = await phone.cmd('obs.getHealth');
ok(r6 && (r6.ok === true || /OBS n'est pas connecté/.test(r6.error)), 'obs.getHealth (ok ou « OBS n\'est pas connecté »)', JSON.stringify(r6));
const r7 = await phone.cmd('twitch.getChatters');
ok(r7?.ok === true ? Array.isArray(r7.data.names) : typeof r7?.error === 'string', 'twitch.getChatters');
phone.ws.close();

const old = await openWs(paired.token, { protocol: 0 });
const incompat = await old.wait((m) => m.type === 'incompatible');
const w2 = await old.wait((m) => m.type === 'welcome');
ok(incompat && typeof incompat.pcVersion === 'string' && incompat.minProtocol === 1 && w2, 'protocole < 1 → incompatible puis welcome (jamais bloquant)');
old.ws.close();

const { token: shared } = await json('/api/session');
const legacy = await openWs(shared);
ok(!!(await legacy.wait((m) => m.type === 'welcome')), 'token partagé historique accepté');
legacy.ws.close();

const devices = await json('/api/devices');
const mine = devices.find((d) => d.name === 'Test conformité');
ok(!!mine, 'appareil jumelé listé');
if (mine) await fetch(`${base}/api/devices/${encodeURIComponent(mine.id)}`, { method: 'DELETE' });
const revoked = await openWs(paired.token);
const c3 = await revoked.waitClose(3000);
ok(c3?.code === 4003, 'jumelage révoqué → 4003', JSON.stringify(c3));

// --- mDNS ---
const found = await new Promise((resolve) => {
  const b = new Bonjour();
  const t = setTimeout(() => { b.destroy(); resolve(null); }, 6000);
  b.find({ type: 'couchstream', protocol: 'tcp' }, (svc) => {
    if (svc.txt?.id === hello.id) { clearTimeout(t); b.destroy(); resolve(svc); }
  });
});
ok(!!found && found.port === port && found.txt.name === hello.name, 'mDNS _couchstream._tcp : TXT id/name + port', JSON.stringify(found && { port: found.port, txt: found.txt }));

console.log(failed ? `\n${failed} contrôle(s) en échec` : '\nContrat Android v1 : tout est conforme');
process.exit(failed ? 1 : 0);
