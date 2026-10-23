import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbedBuilder } from 'discord.js';

// Le dossier de données (copie locale des clips) est lu à l'import : on le fixe avant.
process.env.SUNDAY_DATA_DIR = mkdtempSync(join(tmpdir(), 'ss-data-'));
const { ClipsModule, Normalizer } = await import('../src/discord/clips.js');
const { DiscordBot } = await import('../src/discord/bot.js');
const { normalizeSettings } = await import('../src/discord/logic.js');

const settingsWith = (over = {}) => ({
  get: () => normalizeSettings({ modules: { discord: true, clips: true }, discord: { userId: '11111', voiceChannelId: '22222', clipsChannelId: '44444', ...over } }),
  hasToken: async () => true,
  getToken: async () => 'x',
});

function setup({ obsOver = {} } = {}) {
  const obs = Object.assign(new EventEmitter(), { connected: true, streaming: true }, obsOver);
  const bot = new DiscordBot({ obs, settings: settingsWith(), confirm: {} });
  bot.ready = true;
  bot.running = true;
  const calls = [];
  const channel = {
    guild: { premiumTier: 0 },
    send: async (p) => { calls.push(['send', p.embeds[0].toJSON(), Boolean(p.files)]); return msg; },
  };
  const msg = {
    id: '555',
    react: async (e) => calls.push(['react', e]),
    edit: async (p) => calls.push(['edit', p.embeds[0].toJSON()]),
  };
  bot.client = { user: { id: 'BOT' }, channels: { fetch: async () => channel } };
  const clips = new ClipsModule({ obs, bot, settings: settingsWith() });
  return { obs, bot, clips, calls };
}

test('publication : envoi sans pied, puis édition du pied, puis ✅ ❌', async () => {
  const { clips, calls } = setup();
  const dir = mkdtempSync(join(tmpdir(), 'ss-'));
  const file = join(dir, 'clip.mp4');
  writeFileSync(file, 'x'.repeat(100));
  const id = await clips.publish(file, { score: 0.7, mic: 0.5, speech: 1, input: 0 });
  assert.equal(id, '555');
  assert.deepEqual(calls.map((c) => c[0]), ['send', 'edit', 'react', 'react']);
  assert.equal(calls[0][1].footer, undefined);
  assert.equal(calls[0][1].title, '⏳ En attente de validation');
  assert.equal(calls[0][1].description, 'Score composite : **70%**\nMicro 50% · Voix 100% · Inputs 0%');
  assert.equal(calls[0][2], true);
  assert.equal(calls[1][1].footer.text, 'sundaybot|clip|555|pending');
  assert.deepEqual([calls[2][1], calls[3][1]], ['✅', '❌']);
});

test('fichier trop gros : pas de pièce jointe, champ avec le chemin local', async () => {
  const { clips, calls } = setup();
  const big = join(mkdtempSync(join(tmpdir(), 'ss-')), 'big.mp4');
  writeFileSync(big, Buffer.alloc(11 * 1024 * 1024));
  await clips.publish(big, { score: 0.7, mic: 0, speech: 0, input: 0 });
  assert.equal(calls[0][2], false);
  assert.equal(calls[0][1].fields[0].name, 'Fichier trop volumineux pour Discord');
});

// Faux message de clip avec réactions d'utilisateurs (admin ou non).
function voteMessage(status, { ok = [], ko = [] }) {
  const embed = new EmbedBuilder().setTitle('t').setDescription('Score composite : **70%**').setFooter({ text: `sundaybot|clip|555|${status}` });
  const users = (ids) => ({ users: { fetch: async () => new Map(ids.map((u) => [u.id, { id: u.id, bot: Boolean(u.bot) }])) } });
  const edits = [];
  const admins = new Set([...ok, ...ko].filter((u) => u.admin).map((u) => u.id));
  return {
    edits,
    id: '555',
    channelId: '44444',
    author: { id: 'BOT' },
    partial: false,
    embeds: [embed.toJSON()],
    reactions: { cache: { find: (fn) => [{ emoji: { name: '✅' }, ...users(ok) }, { emoji: { name: '❌' }, ...users(ko) }].find(fn) } },
    guild: { members: { fetch: async (id) => ({ permissions: { has: () => admins.has(id) } }) } },
    edit: async (p) => edits.push(p.embeds[0].toJSON()),
  };
}
const a = (id) => ({ id, admin: true });

async function vote(status, votes) {
  const { clips } = setup();
  const message = voteMessage(status, votes);
  await clips._syncFromReaction({ partial: false, emoji: { name: '✅' }, message });
  return message.edits[0];
}

test('vote : 2 ✅ d\'admins distincts valident, description conservée', async () => {
  const e = await vote('pending', { ok: [a('1'), a('2')] });
  assert.equal(e.title, '✅ Clip validé');
  assert.equal(e.footer.text, 'sundaybot|clip|555|validated');
  assert.equal(e.description, 'Score composite : **70%**');
});

test('vote : 1 seul ✅, non-admins et bots ne comptent pas', async () => {
  assert.equal(await vote('pending', { ok: [a('1'), { id: '2' }, { id: '3', admin: true, bot: true }] }), undefined);
});

test('vote : un ❌ d\'admin refuse définitivement', async () => {
  const e = await vote('pending', { ok: [a('1'), a('2')], ko: [a('3')] });
  assert.equal(e.footer.text, 'sundaybot|clip|555|vetoed');
  assert.equal(await vote('vetoed', { ok: [a('1'), a('2')] }), undefined);
});

test('vote : validé ne revient pas à pending quand des ✅ sont retirés', async () => {
  assert.equal(await vote('validated', { ok: [] }), undefined);
});

test('vote : message d\'un autre salon ou sans pied de clip ignoré', async () => {
  const { clips } = setup();
  const other = voteMessage('pending', { ok: [a('1'), a('2')] });
  other.channelId = '99999';
  await clips._syncFromReaction({ partial: false, emoji: { name: '✅' }, message: other });
  assert.equal(other.edits.length, 0);
  const plain = voteMessage('pending', { ok: [a('1'), a('2')] });
  plain.embeds = [{ footer: { text: 'sundaybot|stream|2026-10-25' } }];
  await clips._syncFromReaction({ partial: false, emoji: { name: '✅' }, message: plain });
  assert.equal(plain.edits.length, 0);
});

test('Normalizer : premier échantillon 0, pic au-dessus du bruit de fond proche de 1', () => {
  const n = new Normalizer();
  assert.equal(n.push(0.1), 0);
  for (let i = 0; i < 20; i++) n.push(0.1);
  assert.ok(n.push(0.9) > 0.9);
  assert.ok(n.push(0.1) < 0.1);
});

test('détection : bruit constant ne déclenche rien, pics soutenus déclenchent une fois puis cooldown', async () => {
  const { obs, clips } = setup();
  const triggers = [];
  clips.trigger = async (o) => { triggers.push(o.source); return { ok: true }; };
  const meter = (mic, game) => obs.emit('volume-meters', [
    { inputName: 'Micro', inputLevelsMul: [[0, mic, 0]] },
    { inputName: 'Desktop', inputLevelsMul: [[0, game, 0]] },
  ]);
  for (let i = 0; i < 30; i++) { meter(0.1, 0.1); await clips._tick(); }
  assert.equal(triggers.length, 0);
  for (let i = 0; i < 6; i++) { meter(1, 1); await clips._tick(); }
  assert.deepEqual(triggers, ['auto']);
  for (let i = 0; i < 6; i++) { meter(1, 1); await clips._tick(); }
  assert.equal(triggers.length, 1); // cooldown 90 s
});

test('détection inactive quand OBS ne diffuse pas', async () => {
  const { obs, clips } = setup({ obsOver: { streaming: false } });
  let n = 0;
  clips.trigger = async () => { n++; return { ok: true }; };
  for (let i = 0; i < 10; i++) { obs.emit('volume-meters', [{ inputName: 'Micro', inputLevelsMul: [[0, 1, 0]] }]); await clips._tick(); }
  assert.equal(n, 0);
  assert.equal(clips.active, false);
});

test('trigger : refus clair sans salon de clips ou sans bot connecté', async () => {
  const { bot, clips } = setup();
  bot.ready = false;
  assert.match((await clips.trigger()).error, /pas connecté/);
});

test('planification : le bot ne démarre que dans la plage et si configuré', async () => {
  const calls = [];
  const mk = (now) => {
    const bot = new DiscordBot({ obs: {}, settings: settingsWith(), confirm: {}, now: () => now });
    bot.start = async (o) => { calls.push(o); return { ok: true }; };
    return bot;
  };
  await mk(new Date(2026, 9, 25, 19, 29))._schedulerTick();
  await mk(new Date(2026, 9, 26, 21, 0))._schedulerTick();
  assert.equal(calls.length, 0);
  await mk(new Date(2026, 9, 25, 19, 30))._schedulerTick();
  assert.deepEqual(calls, [{ forced: false }]);
});

test('watchdog : ferme à fin + 30 min sauf stream lancé en cours, jamais en mode forcé', async () => {
  const mk = (now, over = {}) => {
    const bot = new DiscordBot({ obs: { isStreaming: async () => over.streaming ?? false }, settings: settingsWith(), confirm: {}, now: () => now });
    bot.ready = true;
    bot.running = true;
    bot.windowOpenDone = true;
    bot.windowCloseDone = true;
    bot.stop = async () => { bot.stopped = true; };
    Object.assign(bot, over.state || {});
    return bot;
  };
  const late = new Date(2026, 9, 25, 23, 30);
  const b1 = mk(late); await b1._watchdog(); assert.equal(b1.stopped, true);
  const b2 = mk(late, { streaming: true, state: { iLaunchedStream: true } }); await b2._watchdog(); assert.equal(b2.stopped, undefined);
  const b3 = mk(late, { state: { forced: true } }); await b3._watchdog(); assert.equal(b3.stopped, undefined);
  const b4 = mk(new Date(2026, 9, 25, 23, 29)); await b4._watchdog(); assert.equal(b4.stopped, undefined);
});
