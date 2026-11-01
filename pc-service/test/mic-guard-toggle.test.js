import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUNDAY_DATA_DIR = mkdtempSync(join(tmpdir(), 'ss-mic2-'));
const { MicGuard } = await import('../src/discord/micGuard.js');
const { normalizeSettings } = await import('../src/discord/logic.js');

test('garde désactivée : aucune vérification ni réparation', async () => {
  const calls = [];
  const obs = Object.assign(new EventEmitter(), {
    connected: true,
    listAudioInputs: async () => { calls.push('list'); return []; },
  });
  let value = normalizeSettings({ stream: { micInput: 'Mic/Aux', micDeviceId: 'D', micGuard: false } });
  const guard = new MicGuard({ obs, settings: { get: () => value, update: () => value } });
  const s = await guard.check();
  assert.equal(s.enabled, false);
  assert.deepEqual(calls, []);
  value = normalizeSettings({ stream: { micInput: 'Mic/Aux', micDeviceId: 'D' } });
  assert.equal(guard.status().enabled, true); // activée par défaut
});
