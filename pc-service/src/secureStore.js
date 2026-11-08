import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.js';

// Secrets (tokens Twitch) chiffrés avec DPAPI, portée « utilisateur Windows
// courant » : le fichier ne se déchiffre ni sur un autre PC ni sous un autre
// compte, et n'est plus lisible en clair dans %APPDATA% comme l'était le .env.
// DPAPI est appelé via PowerShell (aucun module natif à embarquer) ; le contenu
// passe par stdin, jamais par la ligne de commande.
const SECRETS_FILE = join(DATA_DIR, 'secrets.dat');

const PS = (body) => ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.Security; $in = [Console]::In.ReadToEnd().Trim(); ${body}`];

function runPs(body, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('powershell', PS(body), { windowsHide: true, timeout: 20_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
    child.stdin.end(input);
  });
}

const BACKUP_FILE = `${SECRETS_FILE}.bak`;

async function readBlob(file) {
  const blob = readFileSync(file, 'utf8').trim();
  const json = await runPs("$b = [Convert]::FromBase64String($in); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))", blob);
  return JSON.parse(json);
}

// Fichier illisible (écriture interrompue, corruption) : repli sur la copie précédente.
export async function loadSecrets() {
  for (const file of [SECRETS_FILE, BACKUP_FILE]) {
    if (!existsSync(file)) continue;
    try {
      return await readBlob(file);
    } catch (err) {
      console.error(`[secrets] lecture impossible (${file}):`, err.message);
    }
  }
  return {};
}

export async function saveSecrets(data) {
  mkdirSync(DATA_DIR, { recursive: true });
  const blob = await runPs("$b = [Text.Encoding]::UTF8.GetBytes($in); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))", JSON.stringify(data));
  // Écriture atomique : jamais de fichier à moitié écrit si le service est coupé en plein enregistrement.
  const tmp = `${SECRETS_FILE}.tmp`;
  writeFileSync(tmp, blob);
  if (existsSync(SECRETS_FILE)) copyFileSync(SECRETS_FILE, BACKUP_FILE);
  renameSync(tmp, SECRETS_FILE);
}

// Mise à jour partielle : fusionne avec l'existant.
export async function updateSecrets(patch) {
  await saveSecrets({ ...(await loadSecrets()), ...patch });
}
