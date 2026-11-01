import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUNDAY_DATA_DIR = mkdtempSync(join(tmpdir(), 'ss-mic-'));
const { MicGuard } = await import('../src/discord/micGuard.js');
const { normalizeSettings } = await import('../src/discord/logic.js');

function setup({ inputs = ['Mic/Aux'], device = 'DEV1', tracks = { 1: true, 2: false } } = {}) {
  const calls = [];
  const state = { inputs: [...inputs], device, tracks };
  const obs = Object.assign(new EventEmitter(), {
    connected: true,
    listAudioInputs: async () => state.inputs.map((name) => ({ name })),
    getInputDevice: async () => ({ deviceId: state.device }),
    setInputDevice: async (n, d) => { calls.push(['device', d]); state.device = d; },
    createMicInput: async (n, d) => { calls.push(['create', n, d]); state.inputs.push(n); state.device = d; },
    getInputTracks: async () => state.tracks,
    setInputTracks: async (n, t) => { calls.push(['tracks', t]); state.tracks = t; },
    isInputMuted: async () => false,
  });
  let value = normalizeSettings({});
  const settings = {
    get: () => value,
    update: (p) => { value = normalizeSettings({ ...value, stream: { ...value.stream, ...p.stream } }); return value; },
  };
  const guard = new MicGuard({ obs, settings });
  return { guard, state, calls };
}

test('micro intact : état « en place », aucune réparation', async () => {
  const { guard, calls } = setup();
  await guard.remember('Mic/Aux');
  assert.equal((await guard.check()).state, 'ok');
  assert.equal(calls.length, 0);
});

test('périphérique changé par une mise à jour d\'OBS : remis en place', async () => {
  const { guard, state, calls } = setup();
  await guard.remember('Mic/Aux');
  state.device = 'AUTRE';
  const s = await guard.check();
  assert.equal(s.state, 'fixed');
  assert.deepEqual(calls, [['device', 'DEV1']]);
  assert.equal(state.device, 'DEV1');
});

test('source disparue : recréée avec le bon périphérique', async () => {
  const { guard, state, calls } = setup();
  await guard.remember('Mic/Aux');
  state.inputs = [];
  assert.equal((await guard.check()).state, 'fixed');
  assert.deepEqual(calls[0], ['create', 'Mic/Aux', 'DEV1']);
});

test('pistes audio modifiées : remises', async () => {
  const { guard, state, calls } = setup();
  await guard.remember('Mic/Aux');
  state.tracks = { 1: false, 2: false };
  assert.equal((await guard.check()).state, 'fixed');
  assert.equal(calls[0][0], 'tracks');
});

test('aucun micro mémorisé : rien à vérifier ; échec OBS : avertissement', async () => {
  const { guard } = setup();
  assert.equal((await guard.check()).configured, false);
  await guard.remember('Mic/Aux');
  guard.obs.listAudioInputs = async () => { throw new Error('boum'); };
  const s = await guard.check();
  assert.equal(s.state, 'warning');
});
