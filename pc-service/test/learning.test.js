import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUNDAY_DATA_DIR = mkdtempSync(join(tmpdir(), 'ss-learn-'));
const { ClipLearner } = await import('../src/discord/learning.js');
const { EmotionDetector } = await import('../src/discord/moments.js');

const laughClip = { types: { mic: { exclaim: 0, scream: 0, laugh: 0.9 }, voice: { exclaim: 0, scream: 0, laugh: 0 } }, score: 0.8 };
const exclaimClip = { types: { mic: { exclaim: 0.7, scream: 0, laugh: 0 }, voice: { exclaim: 0, scream: 0, laugh: 0 } }, score: 0.8 };

test('clip refusé : la confiance dans le type fautif baisse, le seuil monte ; compté une seule fois', () => {
  const l = new ClipLearner({ file: null });
  l.remember('1', exclaimClip);
  assert.equal(l.vote('1', 'refused'), true);
  assert.ok(l.weight('mic', 'exclaim') < 1);
  assert.equal(l.weight('mic', 'laugh'), 1);
  assert.ok(l.offset > 0);
  const w = l.weight('mic', 'exclaim');
  assert.equal(l.vote('1', 'refused'), false);
  assert.equal(l.weight('mic', 'exclaim'), w);
  assert.equal(l.vote('inconnu', 'validated'), false);
});

test('clip validé : la confiance monte, le seuil se relâche un peu ; toujours borné', () => {
  const l = new ClipLearner({ file: null });
  for (let i = 0; i < 50; i++) { l.remember(`v${i}`, laughClip); l.vote(`v${i}`, 'validated'); }
  assert.ok(l.weight('mic', 'laugh') > 1 && l.weight('mic', 'laugh') <= 1.3);
  assert.ok(l.offset < 0 && l.offset >= -0.1);
  for (let i = 0; i < 80; i++) { l.remember(`r${i}`, laughClip); l.vote(`r${i}`, 'refused'); }
  assert.ok(l.weight('mic', 'laugh') >= 0.5);
  assert.ok(l.offset <= 0.15);
});

test('confiance appliquée aux scores : un type déprécié pèse moins', () => {
  const l = new ClipLearner({ file: null });
  const s = { exclaim: 0.8, scream: 0, laugh: 0 };
  assert.equal(l.apply('mic', s), 0.8);
  for (let i = 0; i < 4; i++) { l.remember(`e${i}`, exclaimClip); l.vote(`e${i}`, 'refused'); }
  assert.ok(l.apply('mic', s) < 0.8);
});

test('clip manuel : renforce ce que les détecteurs voyaient et abaisse le seuil s’il était passé sous le radar', () => {
  const l = new ClipLearner({ file: null });
  l.manual({ ...laughClip, score: 0.4 }, 0.75);
  assert.ok(l.weight('mic', 'laugh') > 1);
  assert.ok(l.offset < 0);
  const before = l.offset;
  l.manual({ ...laughClip, score: 0.9 }, 0.75); // déjà détecté : le seuil ne bouge pas
  assert.equal(l.offset, before);
  l.manual({ types: { mic: { exclaim: 0, scream: 0, laugh: 0 }, voice: { exclaim: 0, scream: 0, laugh: 0 } }, score: 0 }, 0.75); // rien vu : rien à apprendre
  assert.equal(l.offset, before);
});

test('persistance : poids, seuil et niveaux habituels survivent au redémarrage ; reset garde le niveau de voix', () => {
  const file = join(process.env.SUNDAY_DATA_DIR, 'l.json');
  const a = new ClipLearner({ file });
  a.remember('9', exclaimClip); a.vote('9', 'refused'); a.setBaseline('mic', -22);
  const b = new ClipLearner({ file });
  assert.equal(b.weight('mic', 'exclaim'), a.weight('mic', 'exclaim'));
  assert.equal(b.offset, a.offset);
  assert.equal(b.baseline('mic'), -22);
  b.reset();
  assert.equal(b.weight('mic', 'exclaim'), 1);
  assert.equal(b.offset, 0);
  assert.equal(b.baseline('mic'), -22);
});

test('fichier corrompu : départ à zéro sans lever', () => {
  const file = join(process.env.SUNDAY_DATA_DIR, 'bad.json');
  writeFileSync(file, '{pas du json');
  const l = new ClipLearner({ file });
  assert.equal(l.offset, 0);
  assert.equal(l.weight('mic', 'laugh'), 1);
});

test('détecteur d’émotion amorcé avec un niveau mémorisé : prêt tout de suite, se recale vite', () => {
  const d = new EmotionDetector();
  d.seed(-30);
  assert.equal(d.warm, true);
  let t = 0;
  for (let i = 0; i < 20 * 60; i++) { d.push(t, -38); t += 50; } // la voix est en fait plus basse : 60 s
  assert.ok(d.baseline < -33, `baseline ${d.baseline}`);
});
