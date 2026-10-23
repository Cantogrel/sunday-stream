import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordBot } from '../src/discord/bot.js';
import { normalizeSettings } from '../src/discord/logic.js';

// Faux salon de logs : mémorise les envois et rejoue l'historique.
function fakeLogChannel(history = []) {
  const sent = [];
  return {
    sent,
    messages: { fetch: async () => new Map(history.map((m, i) => [String(i), m])) },
    send: async ({ embeds }) => { const e = embeds[0].toJSON(); sent.push(e); return { id: 'x' }; },
  };
}
const histMsg = (footer, at = new Date()) => ({ author: { id: 'BOT' }, createdTimestamp: at.getTime(), createdAt: at, embeds: [{ footer: { text: footer } }] });

function makeBot({ channel, obsState = {}, now = new Date(2026, 9, 25, 21, 7, 0) } = {}) {
  const obs = {
    connected: true,
    streaming: false,
    isStreaming: async () => obsState.streaming ?? false,
    isRecording: async () => false,
    startRecord: async () => { obsState.recorded = true; },
    startStream: async () => { obsState.started = true; obsState.streaming = true; },
    switchScene: async () => {},
  };
  const settings = {
    get: () => normalizeSettings({ modules: { discord: true }, discord: { userId: '11111', voiceChannelId: '22222', logChannelId: '33333' } }),
    hasToken: async () => true,
    getToken: async () => 'x',
  };
  const confirm = { ask: async () => obsState.choice ?? 2 };
  const bot = new DiscordBot({ obs, settings, confirm, now: () => now });
  bot.client = { user: { id: 'BOT' }, channels: { cache: new Map([['33333', channel]]) } };
  bot.running = true;
  bot.ready = true;
  return bot;
}

const voiceEvent = (userId = '11111', channelId = '22222', before = null) => [
  { channelId: before, member: { id: userId, displayName: 'Bob' } },
  { channelId, member: { id: userId, displayName: 'Bob' } },
];

test('« Lancer le stream » : démarre OBS, pose le marqueur stream et coupe les rappels', async () => {
  const ch = fakeLogChannel();
  const st = { choice: 0 };
  const bot = makeBot({ channel: ch, obsState: st });
  await bot._onVoice(...voiceEvent());
  assert.equal(st.started, true);
  assert.equal(st.recorded, true);
  assert.equal(ch.sent.length, 1);
  assert.equal(ch.sent[0].description, '🔴 Stream lancé par **Bob** à 21h07.');
  assert.equal(ch.sent[0].footer.text, 'sundaybot|stream|2026-10-25');
  assert.equal(bot.iLaunchedStream, true);
  assert.equal(bot.stopAskingTonight, true);
});

test('OBS diffusait déjà : aucun message, rappels coupés', async () => {
  const ch = fakeLogChannel();
  const bot = makeBot({ channel: ch, obsState: { choice: 0, streaming: true } });
  await bot._onVoice(...voiceEvent());
  assert.equal(ch.sent.length, 0);
  assert.equal(bot.stopAskingTonight, true);
  assert.equal(bot.iLaunchedStream, false);
});

test('« Non » : rien posté, nouveau rappel possible ; « plus ce soir » coupe les rappels', async () => {
  const ch = fakeLogChannel();
  const st = { choice: 2 };
  const bot = makeBot({ channel: ch, obsState: st });
  await bot._onVoice(...voiceEvent());
  assert.equal(ch.sent.length, 0);
  assert.equal(bot.stopAskingTonight, false);
  st.choice = 3;
  await bot._onVoice(...voiceEvent());
  assert.equal(bot.stopAskingTonight, true);
});

test('verrou tenu par un autre PC : pas de fenêtre', async () => {
  const ch = fakeLogChannel([histMsg('sundaybot|stream|2026-10-25', new Date(Date.now() - 3600e3))]);
  let asked = false;
  const bot = makeBot({ channel: ch });
  bot.confirm = { ask: async () => { asked = true; return 0; } };
  await bot._onVoice(...voiceEvent());
  assert.equal(asked, false);
});

test('autre utilisateur, autre salon ou déjà dans le salon : ignoré', async () => {
  const ch = fakeLogChannel();
  let asked = 0;
  const bot = makeBot({ channel: ch });
  bot.confirm = { ask: async () => { asked++; return 2; } };
  await bot._onVoice(...voiceEvent('99999'));
  await bot._onVoice(...voiceEvent('11111', '44444'));
  await bot._onVoice(...voiceEvent('11111', '22222', '22222'));
  assert.equal(asked, 0);
});

test('hors fenêtre active : pas de fenêtre', async () => {
  const ch = fakeLogChannel();
  let asked = false;
  const bot = makeBot({ channel: ch, now: new Date(2026, 9, 26, 21, 0, 0) });
  bot.confirm = { ask: async () => { asked = true; return 0; } };
  await bot._onVoice(...voiceEvent());
  assert.equal(asked, false);
});

test('déduplication : un marqueur du jour déjà présent => rien n\'est reposté', async () => {
  const ch = fakeLogChannel([histMsg('sundaybot|window|2026-10-25')]);
  const bot = makeBot({ channel: ch });
  await bot.postLog('window', 'x');
  assert.equal(ch.sent.length, 0);
  await bot.postLog('close', 'y');
  assert.equal(ch.sent.length, 1);
  await bot.postLog('fail', 'z', { dedup: false });
  assert.equal(ch.sent.length, 2);
  assert.equal(ch.sent[0].footer.text, 'sundaybot|close|2026-10-25');
  assert.equal(ch.sent[1].footer, undefined);
});

test('fin de stream : pas de « end » tant qu\'OBS diffuse, puis « end » avec la durée', async () => {
  const ch = fakeLogChannel();
  const st = { streaming: true };
  const bot = makeBot({ channel: ch, obsState: st, now: new Date(2026, 9, 25, 23, 12, 0) });
  bot.iLaunchedStream = true;
  bot.streamStartDt = new Date(2026, 9, 25, 21, 7, 0);
  await bot._postStreamEndIfNeeded();
  assert.equal(ch.sent.length, 0);
  st.streaming = false;
  await bot._postStreamEndIfNeeded();
  assert.equal(ch.sent[0].description, '⚪ Stream terminé à 23h12 (durée 2 h 05).');
  await bot._postStreamEndIfNeeded();
  assert.equal(ch.sent.length, 1);
});
