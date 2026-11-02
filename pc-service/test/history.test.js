import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUNDAY_DATA_DIR = mkdtempSync(join(tmpdir(), 'ss-hist-'));
const { StreamHistory } = await import('../src/discord/history.js');

const noTypes = { mic: { exclaim: 0, scream: 0, laugh: 0 }, voice: { exclaim: 0, scream: 0, laugh: 0 } };

// Simule `seconds` secondes de stream où l'on parle ; `score(i)` donne le score de la seconde i.
function stream(h, clock, seconds, score, types = () => noTypes) {
  h.begin({ threshold: 0.75 });
  for (let i = 0; i < seconds; i++) {
    clock.t += 1000;
    h.tick({ score: score(i), micDb: -25, voiceDb: -30, types: types(i) });
  }
  h.end();
}

test('une session enregistre durée, secondes de parole, score max, niveaux et événements d’émotion', () => {
  const clock = { t: 1_000_000 };
  const h = new StreamHistory({ file: null, clock: () => clock.t });
  const laugh = { mic: { exclaim: 0, scream: 0, laugh: 0.9 }, voice: noTypes.voice };
  stream(h, clock, 600, (i) => (i % 100 === 0 ? 0.8 : 0.1), (i) => (i % 100 < 3 ? laugh : noTypes));
  const [s] = h.summary().sessions;
  assert.equal(s.talkMinutes, 10);
  assert.equal(s.maxScore, 0.8);
  assert.equal(s.events['mic.laugh'], 6); // un événement par rafale, pas par seconde
  assert.equal(s.micP95, -25);
});

test('un stream de moins de 2 minutes n’est pas gardé', () => {
  const clock = { t: 0 };
  const h = new StreamHistory({ file: null, clock: () => clock.t });
  stream(h, clock, 60, () => 0.5);
  assert.equal(h.summary().sessions.length, 0);
});

test('on ne garde que les 20 derniers streams', () => {
  const clock = { t: 0 };
  const h = new StreamHistory({ file: null, clock: () => clock.t });
  for (let i = 0; i < 25; i++) stream(h, clock, 130, () => 0.3);
  assert.equal(h.summary().sessions.length, 20);
});

test('norme : sans assez de données le seuil réglé s’applique tel quel', () => {
  const clock = { t: 0 };
  const h = new StreamHistory({ file: null, clock: () => clock.t });
  stream(h, clock, 300, () => 0.9);
  assert.equal(h.adaptiveThreshold(0.75), 0.75);
});

test('norme : une bande dont les « moments forts » sont banals voit le seuil relevé, de +0,12 au plus', () => {
  const clock = { t: 0 };
  const h = new StreamHistory({ file: null, clock: () => clock.t });
  for (let i = 0; i < 6; i++) stream(h, clock, 1000, (k) => (k % 10 === 0 ? 0.95 : 0.4)); // 10 % de pics à 0,95 : banal
  const t = h.adaptiveThreshold(0.75);
  assert.ok(t > 0.75 && t <= 0.87 + 1e-9, `seuil ${t}`);
});

test('norme : une bande calme (pics rares) garde le seuil réglé', () => {
  const clock = { t: 0 };
  const h = new StreamHistory({ file: null, clock: () => clock.t });
  for (let i = 0; i < 6; i++) stream(h, clock, 1000, (k) => (k % 500 === 0 ? 0.95 : 0.3));
  assert.equal(h.adaptiveThreshold(0.75), 0.75);
});

test('verdict attribué à la session qui a produit le clip, même plus tard ; persistance et session restée ouverte', () => {
  const file = join(process.env.SUNDAY_DATA_DIR, 'h.json');
  const clock = { t: 5_000_000 };
  const a = new StreamHistory({ file, clock: () => clock.t });
  a.begin({});
  for (let i = 0; i < 200; i++) { clock.t += 1000; a.tick({ score: 0.2, micDb: -25 }); }
  a.clip('auto', 'm1');
  a.end();
  a.begin({});
  clock.t += 1000;
  a.vote('m1', 'validated');
  a.save(); // arrêt brutal : la session en cours reste « ouverte » dans le fichier
  const b = new StreamHistory({ file, clock: () => clock.t });
  const list = b.summary().sessions;
  assert.equal(list.length, 2);
  assert.equal(list.find((x) => x.clips.auto === 1).clips.approved, 1);
  assert.ok(list.every((x) => x.end != null));
});

test('reset efface l’historique', () => {
  const clock = { t: 0 };
  const h = new StreamHistory({ file: null, clock: () => clock.t });
  stream(h, clock, 300, () => 0.5);
  h.reset();
  assert.equal(h.summary().sessions.length, 0);
  assert.equal(h.summary().norm.ready, false);
});
