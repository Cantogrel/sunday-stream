import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const DIR = join(import.meta.dirname, '..', 'public');

// Une erreur de syntaxe dans le script d'une page la rend entièrement inerte (boutons morts) :
// toute page et tout script de public/ doit au moins se compiler.
test('pages et scripts de public/ : syntaxe valide', () => {
  for (const f of readdirSync(DIR)) {
    const text = readFileSync(join(DIR, f), 'utf8');
    const scripts = f.endsWith('.html')
      ? [...text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
      : f.endsWith('.js') ? [text] : [];
    scripts.forEach((code, i) => assert.doesNotThrow(() => new vm.Script(code, { filename: `${f}#${i}` }), `${f} (script ${i})`));
  }
});

test('page Discord sans réglages de clips ni micro ; ils sont sur leurs pages', () => {
  const read = (f) => readFileSync(join(DIR, f), 'utf8');
  for (const id of ['hotkey', 'c_folder', 'micSel', 'voiceList']) assert.ok(!read('discord.html').includes(`id="${id}"`), `discord.html contient ${id}`);
  for (const id of ['hotkey', 'c_folder', 'voiceList', 'c_auto', 'c_keep', 'btnLearnReset', 'histTable']) assert.ok(read('clips.html').includes(`id="${id}"`), `clips.html sans ${id}`);
  assert.ok(read('desktop.html').includes('id="micSel"'));
});

test('pages à boutons : retour visuel commun (ui.css / ui.js) chargé avant les scripts de la page', () => {
  for (const f of ['desktop', 'settings', 'discord', 'clips', 'setup', 'live']) {
    const t = readFileSync(join(DIR, `${f}.html`), 'utf8');
    assert.ok(t.includes('href="ui.css"') && t.includes('src="ui.js"'), `${f}.html sans ui.css/ui.js`);
    assert.ok(t.indexOf('src="ui.js"') < t.search(/<script(?![^>]*src="ui\.js")/), `${f}.html : ui.js doit précéder les autres scripts`);
  }
});
