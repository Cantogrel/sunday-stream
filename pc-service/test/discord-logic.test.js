import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOG_TEXT, markerFooter, findMarkers, lockState, isWindowActive, botShouldRun, stopAt, durationText,
  parseClipFooter, clipFooter, clipDescription, computeClipStatus, encodeInvite, decodeInvite, normalizeSettings,
} from '../src/discord/logic.js';

const cfg = { activeDay: 'Sunday', hourStart: 20, hourEnd: 23 };
// dimanche 25 octobre 2026
const at = (h, m = 0, day = 25) => new Date(2026, 9, day, h, m, 0);

test('textes de logs identiques au contrat', () => {
  assert.equal(LOG_TEXT.window(), '📅 **Session du dimanche** — la détection est ouverte.');
  assert.equal(LOG_TEXT.stream('Bob', at(22, 7)), '🔴 Stream lancé par **Bob** à 22h07.');
  assert.equal(LOG_TEXT.fail('Bob'), '⚠️ Bob : échec du lancement du stream (OBS injoignable).');
  assert.equal(LOG_TEXT.close(), '🌙 Détection fermée. Bonne nuit.');
  assert.equal(LOG_TEXT.end(at(23, 12), at(21, 7)), '⚪ Stream terminé à 23h12 (durée 2 h 05).');
  assert.equal(LOG_TEXT.end(at(23, 12), at(23, 0)), '⚪ Stream terminé à 23h12 (durée 12 min).');
  assert.equal(LOG_TEXT.end(at(23, 12), null), '⚪ Stream terminé à 23h12.');
  assert.equal(durationText(null, at(1)), '');
});

test('marqueur : 3 segments, date locale', () => {
  assert.equal(markerFooter('stream', at(22)), 'sundaybot|stream|2026-10-25');
});

test('fenêtre active et plage de fonctionnement du bot', () => {
  assert.ok(isWindowActive(at(20), cfg));
  assert.ok(isWindowActive(at(22, 59), cfg));
  assert.ok(!isWindowActive(at(23), cfg));
  assert.ok(!isWindowActive(at(21, 0, 26), cfg));
  assert.ok(!botShouldRun(at(19, 29), cfg));
  assert.ok(botShouldRun(at(19, 30), cfg));
  assert.ok(botShouldRun(at(23, 29), cfg));
  assert.ok(!botShouldRun(at(23, 30), cfg));
  assert.ok(!botShouldRun(at(21, 0, 26), cfg));
  assert.equal(stopAt(at(21), cfg).getHours(), 23);
  assert.equal(stopAt(at(21), cfg).getMinutes(), 30);
});

const msg = (authorId, createdAt, ...footers) => ({ authorId, createdAt, footers });

test('findMarkers : auteur, 3 segments, plus récent d\'abord, filtre de date', () => {
  const t1 = new Date('2026-10-25T20:00:00Z');
  const t2 = new Date('2026-10-25T21:00:00Z');
  const msgs = [
    msg('bot', t2, 'sundaybot|stream|2026-10-25'),
    msg('autre', t2, 'sundaybot|end|2026-10-25'),
    msg('bot', t1, 'sundaybot|stream|2026-10-25', 'sundaybot|clip|1|pending'),
    msg('bot', t1, 'sundaybot|end|2026-10-24'),
  ];
  const m = findMarkers(msgs, 'bot', new Set(['stream', 'end']));
  assert.equal(m.stream, t2);
  assert.equal(m.end, t1);
  const d = findMarkers(msgs, 'bot', new Set(['end']), '2026-10-25');
  assert.deepEqual(d, {});
});

test('verrou : libre / tenu / end plus récent / périmé > 12 h', () => {
  const now = new Date('2026-10-25T22:00:00Z').getTime();
  const s = new Date('2026-10-25T21:00:00Z');
  assert.equal(lockState({}, now).held, false);
  assert.equal(lockState({ stream: s }, now).held, true);
  assert.equal(lockState({ stream: s, end: new Date('2026-10-25T21:30:00Z') }, now).held, false);
  assert.equal(lockState({ stream: s, end: new Date('2026-10-25T20:30:00Z') }, now).held, true);
  const old = new Date(now - 13 * 3600e3);
  assert.deepEqual(lockState({ stream: old }, now).held, false);
});

test('footer de clip : 4 segments, statut illisible => pending', () => {
  assert.equal(clipFooter('42', 'validated'), 'sundaybot|clip|42|validated');
  assert.deepEqual(parseClipFooter('sundaybot|clip|42|vetoed'), { id: '42', status: 'vetoed' });
  assert.deepEqual(parseClipFooter('sundaybot|clip|42'), { id: '42', status: 'pending' });
  assert.deepEqual(parseClipFooter('sundaybot|clip|42|bidon'), { id: '42', status: 'pending' });
  assert.equal(parseClipFooter('sundaybot|stream|2026-10-25'), null);
  assert.equal(clipDescription({ score: 0.7, mic: 0.5, speech: 1, input: 0 }), 'Score composite : **70%**\nMicro 50% · Voix 100% · Inputs 0%');
});

test('vote : 2 ✅ valident, 1 ❌ refuse, monotone', () => {
  assert.equal(computeClipStatus('pending', { approvals: 1, vetoes: 0 }), 'pending');
  assert.equal(computeClipStatus('pending', { approvals: 2, vetoes: 0 }), 'validated');
  assert.equal(computeClipStatus('pending', { approvals: 5, vetoes: 1 }), 'vetoed');
  assert.equal(computeClipStatus('validated', { approvals: 0, vetoes: 0 }), 'validated');
  assert.equal(computeClipStatus('validated', { approvals: 0, vetoes: 1 }), 'vetoed');
  assert.equal(computeClipStatus('vetoed', { approvals: 9, vetoes: 0 }), 'vetoed');
});

test('code d\'invitation : IDs seulement, aller-retour et rejets', () => {
  const ids = { voiceChannelId: '111111111111', logChannelId: '222222222222', clipsChannelId: '' };
  const code = encodeInvite(ids);
  assert.match(code, /^SS1-/);
  assert.deepEqual(decodeInvite(code), ids);
  assert.throws(() => decodeInvite('n importe quoi'));
  const bad = 'SS1-' + Buffer.from(JSON.stringify({ v: 1, voice: 'abc', log: '', clips: '' })).toString('base64url');
  assert.throws(() => decodeInvite(bad));
});

test('réglages : heure 0 valide, bornes et défauts', () => {
  const s = normalizeSettings({ discord: { hourStart: 0, hourEnd: 5, userId: 'x' }, clips: { threshold: 3 } });
  assert.equal(s.discord.hourStart, 0);
  assert.equal(s.discord.hourEnd, 5);
  assert.equal(s.discord.userId, '');
  assert.equal(s.clips.threshold, 0.65);
  assert.equal(normalizeSettings({ discord: { hourStart: 22, hourEnd: 21 } }).discord.hourEnd, 23);
});
