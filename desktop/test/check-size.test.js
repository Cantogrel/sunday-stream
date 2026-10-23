import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSize, BUDGET_MO } from '../scripts/check-size.mjs';

const MO = 1024 * 1024;

test('sous le budget : accepté', () => {
  assert.equal(checkSize(30_937_734).ok, true);
});

test('pile au budget : accepté, un octet de plus : refusé', () => {
  const limit = Math.floor(BUDGET_MO * MO);
  assert.equal(checkSize(limit).ok, true);
  assert.equal(checkSize(limit + 1).ok, false);
});

test('l\'installeur Couch v0.1.4 (40,18 Mo) dépasse le budget', () => {
  assert.equal(checkSize(42_130_295).ok, false);
});
