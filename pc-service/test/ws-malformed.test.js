import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LocalWsServer } from '../src/wsServer.js';

// Régression : le JSON `null` (ou un nombre, une chaîne, un tableau) faisait planter tout le service.
function setup() {
  const server = new LocalWsServer({ port: 0, token: 'tok', devices: { verify: () => null } });
  const ws = new EventEmitter();
  ws.OPEN = 1;
  ws.readyState = 1;
  ws.sent = [];
  ws.send = (s) => ws.sent.push(JSON.parse(s));
  ws.close = () => { ws.readyState = 3; };
  server._handleConnection(ws);
  return { ws };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test('messages JSON valides mais pas des objets : erreur renvoyée, service vivant', async () => {
  const { ws } = setup();
  for (const raw of ['null', '5', '"texte"', '[1,2]', 'true']) ws.emit('message', Buffer.from(raw));
  await tick();
  assert.equal(ws.sent.length, 5);
  assert.ok(ws.sent.every((m) => m.type === 'error' && m.error === 'message invalide'));
});

test('une erreur dans un message ne bloque pas les suivants', async () => {
  const { ws } = setup();
  ws.emit('message', Buffer.from('{"type":"auth","token":"mauvais"}')); // fermeture 4003
  ws.emit('message', Buffer.from('pas du json'));
  await tick();
  assert.equal(ws.readyState, 3);
  assert.equal(ws.sent.at(-1).error, 'JSON invalide');
});
