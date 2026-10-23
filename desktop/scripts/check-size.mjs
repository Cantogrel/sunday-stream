// Contrôle de taille de l'installeur : échoue (code 1) s'il dépasse le budget.
// Usage : node check-size.mjs [budget en Mo, défaut 39.8] [dossier de l'installeur]
// « Mo » = mébioctet (1 048 576 o), comme dans docs/BASELINE.md.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUDGET_MO = 39.8;
const MO = 1024 * 1024;

export function checkSize(bytes, budgetMo = BUDGET_MO) {
  const mo = bytes / MO;
  return { ok: bytes <= Math.floor(budgetMo * MO), mo, budgetMo };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const budget = Number(process.argv[2] || BUDGET_MO);
  const dir = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  if (!Number.isFinite(budget) || budget <= 0) {
    console.error(`Budget invalide : ${process.argv[2]}`);
    process.exit(2);
  }
  const exe = readdirSync(dir).find((f) => f.endsWith('-setup.exe'));
  if (!exe) {
    console.error(`Aucun installeur dans ${dir}`);
    process.exit(2);
  }
  const r = checkSize(statSync(join(dir, exe)).size, budget);
  const line = `${exe} : ${r.mo.toFixed(2)} Mo (budget ≤ ${r.budgetMo} Mo)`;
  if (!r.ok) {
    console.error(`::error::Installeur trop gros — ${line}`);
    process.exit(1);
  }
  console.log(`OK — ${line}`);
}
