import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../paths.js';
import { loadSecrets, updateSecrets } from '../secureStore.js';
import { normalizeSettings } from './logic.js';

const FILE = join(DATA_DIR, 'discord.json');

// Réglages non secrets : discord.json dans le dossier de données. Le token du
// bot Discord est chiffré (DPAPI) dans secrets.dat, comme les jetons Twitch :
// il n'apparaît jamais dans un fichier lisible ni dans une réponse d'API.
export class SettingsStore {
  constructor() {
    this.value = this._read();
  }

  _read() {
    try {
      if (existsSync(FILE)) return normalizeSettings(JSON.parse(readFileSync(FILE, 'utf8')));
    } catch (err) {
      console.error('[discord] discord.json illisible, réglages par défaut:', err.message);
    }
    return normalizeSettings({});
  }

  get() {
    return this.value;
  }

  // Fusion profonde d'un patch partiel (modules / discord / clips), puis normalisation.
  update(patch) {
    const cur = this.value;
    const next = normalizeSettings({
      modules: { ...cur.modules, ...(patch.modules || {}) },
      discord: { ...cur.discord, ...(patch.discord || {}) },
      clips: { ...cur.clips, ...(patch.clips || {}) },
    });
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(next, null, 2));
    this.value = next;
    return next;
  }

  async hasToken() {
    return Boolean((await loadSecrets()).discordToken);
  }

  async getToken() {
    return (await loadSecrets()).discordToken || '';
  }

  async setToken(token) {
    await updateSecrets({ discordToken: String(token || '').trim() });
  }
}
