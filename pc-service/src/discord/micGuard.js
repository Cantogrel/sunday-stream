import { EventEmitter } from 'node:events';

const CHECK_EVERY_MS = 15_000;
const SILENCE_WARN_MS = 5 * 60_000;
const SIGNAL_MUL = 0.0005; // ≈ −66 dB : en dessous, le micro ne capte rien (même pas le bruit de fond)

const sameTracks = (a, b) => [1, 2, 3, 4, 5, 6].every((n) => Boolean(a?.[n]) === Boolean(b?.[n]));

// Garde du micro de stream : l'utilisateur désigne une fois son micro dans OBS ;
// Sunday Stream mémorise son périphérique et ses pistes audio, vérifie en continu
// qu'ils n'ont pas bougé (mise à jour d'OBS, branchement d'un autre périphérique…),
// les remet en place tout seul, et prévient s'il ne peut pas ou si le micro est
// muet pendant le direct. Il ne démute jamais : couper le micro est un choix.
export class MicGuard extends EventEmitter {
  constructor({ obs, settings, log = () => {} }) {
    super();
    this.obs = obs;
    this.settings = settings;
    this.log = log;
    this.state = { state: 'off', message: '', checkedAt: null };
    this._timer = null;
    this._busy = false;
    this._lastSignalAt = Date.now();
    this._streamSince = null;

    obs.on('volume-meters', (inputs) => this._onMeters(inputs));
    obs.on('status', ({ connected }) => { if (connected) this.check().catch(() => {}); });
    obs.on('event', (e) => {
      if (e.name !== 'obs.stream_state') return;
      this._streamSince = e.active ? Date.now() : null;
      this._lastSignalAt = Date.now();
      if (e.active) this.check().catch(() => {});
    });
  }

  get cfg() {
    return this.settings.get().stream;
  }

  status() {
    const { micInput } = this.cfg;
    return { enabled: this.cfg.micGuard, configured: Boolean(micInput), input: micInput || null, ...this.state };
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.check().catch(() => {}), CHECK_EVERY_MS);
    this._timer.unref();
  }

  _set(state, message) {
    const changed = state !== this.state.state || message !== this.state.message;
    this.state = { state, message, checkedAt: Date.now() };
    if (changed && message) {
      this.log(`(micro) ${message}`);
      this.emit('change', this.status());
    }
  }

  _onMeters(inputs) {
    const name = this.cfg.micInput;
    if (!name) return;
    const i = (inputs || []).find((x) => x.inputName === name);
    if (!i) return;
    const peak = Math.max(0, ...(i.inputLevelsMul || []).map((c) => c[1] || 0));
    if (peak > SIGNAL_MUL) this._lastSignalAt = Date.now();
  }

  // Mémorise le micro actuel d'OBS comme référence (périphérique + pistes).
  async remember(inputName) {
    const { deviceId } = await this.obs.getInputDevice(inputName);
    const micTracks = await this.obs.getInputTracks(inputName).catch(() => null);
    this.settings.update({ stream: { micInput: inputName, micDeviceId: deviceId, micTracks } });
    this._lastSignalAt = Date.now();
    this._set('ok', `Micro de référence : « ${inputName} ».`);
    return this.status();
  }

  forget() {
    this.settings.update({ stream: { micInput: '', micDeviceId: '', micTracks: null } });
    this.state = { state: 'off', message: '', checkedAt: null };
    return this.status();
  }

  async check() {
    const { micInput, micDeviceId, micTracks } = this.cfg;
    if (!this.cfg.micGuard || !micInput || !this.obs.connected || this._busy) return this.status();
    this._busy = true;
    try {
      const fixes = [];
      const inputs = await this.obs.listAudioInputs();
      if (!inputs.some((i) => i.name === micInput)) {
        if (!micDeviceId) return this._warn(`Le micro « ${micInput} » n'existe plus dans OBS et son périphérique n'est pas connu.`);
        await this.obs.createMicInput(micInput, micDeviceId);
        fixes.push('source recréée dans la scène en cours');
      } else {
        const dev = await this.obs.getInputDevice(micInput);
        if (micDeviceId && dev.deviceId !== micDeviceId) {
          await this.obs.setInputDevice(micInput, micDeviceId);
          fixes.push('périphérique remis');
        }
      }
      if (micTracks) {
        const cur = await this.obs.getInputTracks(micInput).catch(() => null);
        if (cur && !sameTracks(cur, micTracks)) {
          await this.obs.setInputTracks(micInput, micTracks);
          fixes.push('pistes audio remises');
        }
      }

      if (fixes.length) {
        this._lastSignalAt = Date.now();
        return this._ok('fixed', `Micro « ${micInput} » réparé : ${fixes.join(', ')}.`);
      }
      const silentFor = Date.now() - this._lastSignalAt;
      if (this._streamSince && silentFor > SILENCE_WARN_MS && !(await this.obs.isInputMuted(micInput).catch(() => true))) {
        return this._warn(`Aucun son sur « ${micInput} » depuis ${Math.round(silentFor / 60000)} min alors que tu diffuses : vérifie le micro dans OBS.`);
      }
      return this._ok('ok', `Micro « ${micInput} » en place.`);
    } catch (err) {
      return this._warn(`Vérification du micro impossible : ${err.message}`);
    } finally {
      this._busy = false;
    }
  }

  _ok(state, message) {
    // « ok » répété ne journalise rien ; « fixed » reste affiché jusqu'au prochain changement.
    if (state === 'ok' && this.state.state === 'fixed') this.state = { ...this.state, checkedAt: Date.now() };
    else this._set(state, message);
    return this.status();
  }

  _warn(message) {
    this._set('warning', message);
    return this.status();
  }
}
