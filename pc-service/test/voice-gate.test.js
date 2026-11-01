import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceGate } from '../src/discord/moments.js';

function likeness(fn, seconds = 4) {
  const g = new VoiceGate();
  let t = 0;
  for (let k = 0; k < seconds * 20; k++) { t += 50; g.push(t, fn(k)); }
  return g.likeness(t);
}

test('filtre de voix : parole (syllabes irrégulières, creux marqués) reconnue', () => {
  const lengths = [3, 4, 2, 8, 6, 3, 3, 6, 8, 2, 2, 5, 4, 4]; // durées en mesures de 50 ms, alternant fort / creux
  const seq = [];
  lengths.forEach((n, i) => { for (let j = 0; j < n; j++) seq.push(i % 2 ? -42 : -20 + (j % 2)); });
  assert.ok(likeness((k) => seq[k % seq.length]) > 0.6);
});

test('filtre de voix : musique stable, silence, explosion isolée et battue lente rejetées', () => {
  assert.equal(likeness((k) => -25 + ((k * 3) % 3)), 0);
  assert.equal(likeness(() => -80), 0);
  assert.equal(likeness((k) => (k === 40 ? -5 : -45)), 0);
  assert.ok(likeness((k) => (k % 10 < 3 ? -15 : -40)) < 0.4); // 2 Hz régulier
});
