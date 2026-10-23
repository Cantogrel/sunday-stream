import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from '../paths.js';
import { CHOICE, CONFIRM_TIMEOUT_MS } from './logic.js';

// Fenêtre « Lancer le stream ? » : le service dépose confirm-request.json,
// l'app Windows (Tauri) ouvre une petite fenêtre toujours au premier plan sur
// /confirm, et la page renvoie le choix par POST /api/discord/confirm.
// Aucune réponse en 2 min, ou fenêtre fermée = « Non ».
export class ConfirmDialog {
  constructor() {
    this.pending = null;
  }

  get open() {
    return this.pending !== null;
  }

  info() {
    return this.pending ? { id: this.pending.id, deadline: this.pending.deadline } : null;
  }

  ask(timeoutMs = CONFIRM_TIMEOUT_MS) {
    if (this.pending) return this.pending.promise;
    const id = randomUUID();
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const finish = (choice) => {
      if (!this.pending || this.pending.id !== id) return;
      clearTimeout(this.pending.timer);
      this.pending = null;
      resolve(choice);
    };
    this.pending = { id, promise, finish, deadline: Date.now() + timeoutMs, timer: setTimeout(() => finish(CHOICE.NO), timeoutMs) };
    try {
      writeFileSync(join(DATA_DIR, 'confirm-request.json'), JSON.stringify({ id, timeoutMs }));
    } catch (err) {
      console.error('[discord] demande de fenêtre impossible:', err.message);
    }
    return promise;
  }

  answer(id, choice) {
    if (!this.pending || (id && this.pending.id !== id)) return false;
    const c = Number(choice);
    this.pending.finish(Number.isInteger(c) && c >= 0 && c <= 3 ? c : CHOICE.NO);
    return true;
  }
}
