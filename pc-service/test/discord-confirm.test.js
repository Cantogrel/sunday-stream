import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Le dossier de données est lu à l'import : on le fixe avant.
const dir = mkdtempSync(join(tmpdir(), 'ss-confirm-'));
process.env.SUNDAY_DATA_DIR = dir;
const { ConfirmDialog } = await import('../src/discord/confirm.js');

test('la fenêtre dépose une demande et renvoie le choix répondu', async () => {
  const c = new ConfirmDialog();
  const p = c.ask(5000);
  assert.ok(existsSync(join(dir, 'confirm-request.json')));
  const { id, timeoutMs } = JSON.parse(readFileSync(join(dir, 'confirm-request.json'), 'utf8'));
  assert.equal(timeoutMs, 5000);
  assert.equal(c.open, true);
  assert.equal(c.answer('mauvais-id', 0), false);
  assert.equal(c.answer(id, 0), true);
  assert.equal(await p, 0);
  assert.equal(c.open, false);
});

test('aucune réponse = Non (2) ; choix invalide = Non ; deux demandes = même fenêtre', async () => {
  const c = new ConfirmDialog();
  assert.equal(await c.ask(50), 2);
  const p1 = c.ask(5000);
  assert.equal(c.ask(5000), p1);
  c.answer(null, 9);
  assert.equal(await p1, 2);
});
