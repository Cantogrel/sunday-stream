// Retour visuel commun : tout bouton dont le gestionnaire `onclick` renvoie une promesse passe en
// « action en cours » (indicateur, bouton inactif, texte `data-doing` si présent) pendant l'exécution,
// et une erreur levée devient une notification au lieu de disparaître en silence.
(() => {
  const MIN_BUSY_MS = 450; // une action instantanée doit quand même se voir

  const toast = (text, kind = 'info', ms = 4500) => {
    let el = document.getElementById('ui-toast');
    if (!el) { el = document.createElement('div'); el.id = 'ui-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = text;
    el.className = kind === 'info' ? '' : kind;
    void el.offsetWidth; // relance la transition
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), ms);
  };

  const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onclick');
  Object.defineProperty(HTMLElement.prototype, 'onclick', {
    configurable: true,
    get() { return orig.get.call(this); },
    set(fn) {
      if (!(this instanceof HTMLButtonElement) || typeof fn !== 'function') return orig.set.call(this, fn);
      orig.set.call(this, function wrapped(ev) {
        if (this.classList.contains('ui-busy')) return undefined;
        let result;
        try { result = fn.call(this, ev); } catch (e) { toast(e.message || String(e), 'err'); return undefined; }
        if (!result || typeof result.then !== 'function') return result;
        const btn = this, label = btn.textContent, started = Date.now();
        btn.classList.add('ui-busy');
        if (btn.dataset.doing) btn.textContent = btn.dataset.doing;
        const done = () => setTimeout(() => {
          btn.classList.remove('ui-busy');
          if (btn.dataset.doing && btn.textContent === btn.dataset.doing) btn.textContent = label;
        }, Math.max(0, MIN_BUSY_MS - (Date.now() - started)));
        return result.then((v) => { done(); return v; }, (e) => { done(); toast(e.message || String(e), 'err'); });
      });
    },
  });

  // Recherche de mise à jour avec un résultat visible : lance, attend la réponse du service, annonce.
  const checkUpdate = async () => {
    const get = async () => (await fetch('/api/update', { cache: 'no-store' })).json().catch(() => ({}));
    const before = await get();
    const r = await (await fetch('/api/update/check', { method: 'POST' })).json().catch(() => ({ ok: false, error: 'Service injoignable.' }));
    if (r.ok === false) { toast(r.error || 'Recherche impossible.', 'err'); return; }
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      await new Promise((res) => setTimeout(res, 700));
      const u = await get();
      if (u.state === 'checking') continue;
      if (u.state === 'available') return toast(`Mise à jour disponible : version ${u.version}.`, 'ok', 7000);
      if (u.state === 'error') return toast(u.message || 'Vérification impossible.', 'err', 7000);
      if (u.state === 'unknown') return toast('Les mises à jour sont gérées par l’application installée.', 'info');
      if (u.checkedAt && u.checkedAt !== before.checkedAt) return toast(`Vous avez la dernière version${u.current ? ` (${u.current})` : ''}.`, 'ok');
    }
    toast('Pas de réponse du serveur de mises à jour. Réessayez dans un instant.', 'err');
  };

  // Confirmation par modale accessible (jamais de popup native) : Échap ou clic hors boîte = Annuler, focus piégé, focus rendu.
  const confirmDialog = (message, { ok = 'Confirmer', cancel = 'Annuler', danger = false } = {}) => new Promise((resolve) => {
    const previous = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal';
    overlay.innerHTML = '<div class="ui-modal-box" role="alertdialog" aria-modal="true" aria-describedby="ui-modal-msg"><p id="ui-modal-msg"></p><div class="ui-modal-actions"><button type="button" data-v="0"></button><button type="button" data-v="1"></button></div></div>';
    const box = overlay.firstChild;
    box.querySelector('#ui-modal-msg').textContent = message;
    const [btnCancel, btnOk] = box.querySelectorAll('button');
    btnCancel.textContent = cancel;
    btnOk.textContent = ok;
    if (danger) btnOk.classList.add('danger');
    const close = (value) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); previous?.focus?.(); resolve(value); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === btnCancel ? btnOk : btnCancel).focus(); }
    };
    btnCancel.addEventListener('click', () => close(false));
    btnOk.addEventListener('click', () => close(true));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    btnCancel.focus(); // action sûre par défaut
  });

  window.ui = { toast, checkUpdate, confirm: confirmDialog };
})();
