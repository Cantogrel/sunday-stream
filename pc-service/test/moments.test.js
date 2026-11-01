import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmotionDetector, activityLevel, dbOf } from '../src/discord/moments.js';

// Voix habituelle : ~ −30 dB avec une petite variation syllabique irrégulière.
function speak(det, t, seconds, db = -30) {
  for (let k = 0; k < seconds * 20; k++) {
    t += 50;
    det.push(t, db + ((k * 7) % 5) - 2);
  }
  return t;
}

test('dbOf : 1 → 0 dB, 0.1 → −20 dB, silence plafonné', () => {
  assert.ok(Math.abs(dbOf(1)) < 1e-9);
  assert.ok(Math.abs(dbOf(0.1) + 20) < 1e-9);
  assert.equal(dbOf(0), -100);
});

test('pas de score tant que la référence de la voix n\'est pas établie', () => {
  const d = new EmotionDetector();
  let t = speak(d, 0, 5);
  t = speak(d, t, 2, -8);
  assert.equal(d.score(t).value, 0);
});

test('voix habituelle : score nul', () => {
  const d = new EmotionDetector();
  const t = speak(d, 0, 40);
  assert.ok(d.score(t).value < 0.2);
});

test('exclamation : montée brutale bien au-dessus du niveau habituel', () => {
  const d = new EmotionDetector();
  let t = speak(d, 0, 40);
  t = speak(d, t, 0.5, -8);
  const s = d.score(t);
  assert.ok(s.exclaim > 0.6, JSON.stringify(s));
});

test('cri : niveau très élevé tenu plus d\'une seconde', () => {
  const d = new EmotionDetector();
  let t = speak(d, 0, 40);
  t = speak(d, t, 1.6, -10);
  assert.ok(d.score(t).scream > 0.8);
});

test('rire : rafales régulières de 5 par seconde', () => {
  const d = new EmotionDetector();
  let t = speak(d, 0, 40);
  // période 200 ms = 4 mesures : 2 hautes (−18) puis 2 basses (−34)
  for (let k = 0; k < 60; k++) {
    t += 50;
    d.push(t, k % 4 < 2 ? -18 : -34);
  }
  const s = d.score(t);
  assert.ok(s.laugh > 0.6, JSON.stringify(s));
});

test('parole rapide mais irrégulière : pas confondue avec un rire', () => {
  const d = new EmotionDetector();
  let t = speak(d, 0, 40);
  const pattern = [-18, -34, -34, -18, -18, -34, -34, -34, -34, -18, -34, -18, -18, -34, -34, -34, -34, -34, -18, -34];
  for (let k = 0; k < 60; k++) {
    t += 50;
    d.push(t, pattern[k % pattern.length]);
  }
  assert.ok(d.score(t).laugh < 0.4);
});

test('silence : score nul', () => {
  const d = new EmotionDetector();
  let t = speak(d, 0, 40);
  t = speak(d, t, 3, -80);
  assert.equal(d.score(t).value, 0);
});

test('activityLevel : touches, souris (pixels) et manette s\'additionnent', () => {
  assert.equal(activityLevel({ keys: 2, mouse: 600, pad: 1 }), 5);
  assert.equal(activityLevel({}), 0);
});
