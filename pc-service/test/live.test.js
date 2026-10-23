import test from 'node:test';
import assert from 'node:assert/strict';
import { lockDetails, parseStreamer } from '../src/discord/logic.js';
import { buildLive } from '../src/live.js';

const msg = (footer, description, at) => ({ authorId: 'BOT', createdAt: new Date(at), footers: [footer], description });
const NOW = Date.UTC(2026, 9, 25, 20, 0, 0);

test('parseStreamer lit le nom dans le texte du marqueur', () => {
  assert.equal(parseStreamer('🔴 Stream lancé par **Bob** à 21h07.'), 'Bob');
  assert.equal(parseStreamer('⚪ Stream terminé'), null);
});

test('lockDetails : verrou tenu => qui et depuis quand', () => {
  const since = NOW - 3600_000;
  const d = lockDetails([msg('sundaybot|stream|2026-10-25', '🔴 Stream lancé par **Bob** à 20h00.', since)], 'BOT', NOW);
  assert.deepEqual(d, { held: true, by: 'Bob', since, lastEnd: null });
});

test('lockDetails : fin postée après => verrou libre, fin connue', () => {
  const d = lockDetails([
    msg('sundaybot|end|2026-10-25', '⚪ Stream terminé', NOW - 1000),
    msg('sundaybot|stream|2026-10-25', '🔴 Stream lancé par **Bob**', NOW - 7200_000),
  ], 'BOT', NOW);
  assert.equal(d.held, false);
  assert.equal(d.by, null);
  assert.equal(d.lastEnd, NOW - 1000);
});

test('lockDetails : marqueur périmé (> 12 h) ignoré', () => {
  const d = lockDetails([msg('sundaybot|stream|2026-10-24', '🔴 Stream lancé par **Bob**', NOW - 13 * 3600_000)], 'BOT', NOW);
  assert.equal(d.held, false);
});

function fakes({ streaming = true, lock = { available: true, held: true, by: 'Bob', since: 1000, lastEnd: null }, iLaunched = false } = {}) {
  return {
    obs: {
      connected: true,
      getState: async () => ({ currentScene: 'Jeu', scenes: ['Attente', 'Jeu'], streaming, streamDurationMs: 5000 }),
      getHealth: async () => ({ bitrateKbps: 6000, fps: 60, cpuPct: 10, droppedFrames: 0, totalFrames: 100 }),
    },
    discord: {
      settings: { get: () => ({ modules: { discord: true, clips: true } }) },
      bot: { ready: true, iLaunchedStream: iLaunched, liveLock: async () => lock },
      clips: { status: () => ({ recent: [{ id: 'a', file: '1.mp4' }, { id: 'b', file: '2.mp4' }] }) },
    },
    chat: { getHistory: () => [{ id: '1', displayName: 'Zoé', text: 'salut', timestamp: 1, isMod: false }, { id: '2', displayName: 'X', text: 'spam', deleted: true }] },
    viewers: { value: { live: true, viewers: 7, chatters: 9 } },
  };
}

test('buildLive : verrou Discord = streamer nommé, santé OBS, chat filtré, clips récents d\'abord', async () => {
  const f = fakes({ iLaunched: true });
  const s = await buildLive(f);
  assert.equal(s.live, true);
  assert.deepEqual(s.streamer, { name: 'Bob', since: 1000, here: true, source: 'discord' });
  assert.equal(s.obs.scene, 'Jeu');
  assert.equal(s.obs.health.bitrateKbps, 6000);
  assert.deepEqual(s.chat.map((m) => m.name), ['Zoé']);
  assert.deepEqual(s.clips.map((c) => c.id), ['b', 'a']);
  assert.ok(f.viewers.watchedAt > 0);
});

test('buildLive : un autre PC diffuse => here=false, OBS local à l\'arrêt', async () => {
  const s = await buildLive(fakes({ streaming: false }));
  assert.equal(s.streamer.here, false);
  assert.equal(s.obs.health, null);
});

test('buildLive : OBS diffuse sans marqueur Discord => streamer anonyme local', async () => {
  const s = await buildLive(fakes({ lock: { available: true, held: false, lastEnd: null } }));
  assert.equal(s.streamer.source, 'obs');
  assert.equal(s.streamer.name, null);
  assert.equal(s.streamer.here, true);
});

test('buildLive : tout hors service => réponse valide, hors ligne', async () => {
  const s = await buildLive({ obs: { connected: false }, discord: null, chat: null, viewers: null });
  assert.equal(s.live, false);
  assert.equal(s.streamer, null);
  assert.deepEqual(s.chat, []);
  assert.deepEqual(s.clips, []);
});
