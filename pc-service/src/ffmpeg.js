import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR } from './paths.js';

// ffmpeg n'est pas embarqué (installeur léger) : il est téléchargé au premier
// besoin (clip plus gros que la limite Discord), comme VB-Cable. Build
// « essentials » de gyan.dev, vérifié par le SHA-256 que le site publie.
const BASE_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
export const FFMPEG_DIR = join(DATA_DIR, 'ffmpeg');
const AUDIO_BPS = 96_000;
const MIN_VIDEO_BPS = 150_000;

export const run = (file, args, timeout) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) =>
      err ? reject(Object.assign(new Error(errOut?.trim().split('\n').slice(-3).join(' ') || err.message), { stderr: errOut || '' })) : resolve({ out, err: errOut })));

const sha256 = (path) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });

// Durée en secondes lue dans la sortie de `ffmpeg -i` ("Duration: 00:00:30.04").
export function parseDuration(text) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text || '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

// Codecs et durée lus dans la sortie de `ffmpeg -i`. audio : 'aac' | 'other' | null (pas de piste).
export function parseStreams(text) {
  const v = /Video:\s*(\w+)/.exec(text || '');
  const a = /Audio:\s*(\w+)/.exec(text || '');
  return { video: v ? v[1].toLowerCase() : null, audio: a ? (a[1].toLowerCase() === 'aac' ? 'aac' : 'other') : null, duration: parseDuration(text) };
}

// Débit vidéo (bit/s) pour tenir sous `limitBytes` avec une marge de 8 %, ou
// null si le clip est trop long pour que l'image reste exploitable.
export function videoBitrate(durationSec, limitBytes) {
  if (!durationSec || durationSec <= 0) return null;
  const bps = Math.floor((limitBytes * 0.92 * 8) / durationSec) - AUDIO_BPS;
  return bps >= MIN_VIDEO_BPS ? bps : null;
}

export class FfmpegTool {
  constructor({ dir = FFMPEG_DIR, log = () => {}, runner = run } = {}) {
    this.run = runner;
    this.dir = dir;
    this.log = log;
    this.state = { step: 'idle', message: '' }; // idle | downloading | verifying | extracting | done | error
    this._pending = null;
  }

  status() {
    return this.state;
  }

  get exe() {
    return join(this.dir, 'ffmpeg.exe');
  }

  isInstalled() {
    return existsSync(this.exe);
  }

  _set(step, message = '') {
    this.state = { step, message };
  }

  // Télécharge ffmpeg si absent ; les appels simultanés partagent le même téléchargement.
  ensure() {
    if (this.isInstalled()) return Promise.resolve(this.exe);
    this._pending ??= this._download().finally(() => { this._pending = null; });
    return this._pending;
  }

  async _download() {
    const work = mkdtempSync(join(tmpdir(), 'sundaystream-ffmpeg-'));
    try {
      this._set('downloading', 'Téléchargement de ffmpeg…');
      this.log('(ffmpeg) téléchargement de ffmpeg (premier usage)…');
      const [zipRes, hashRes] = await Promise.all([fetch(BASE_URL), fetch(`${BASE_URL}.sha256`)]);
      if (!zipRes.ok || !hashRes.ok) throw new Error(`téléchargement refusé (HTTP ${zipRes.ok ? hashRes.status : zipRes.status})`);
      const expected = (await hashRes.text()).trim().split(/\s+/)[0].toLowerCase();
      const zip = join(work, 'ffmpeg.zip');
      await pipeline(Readable.fromWeb(zipRes.body), createWriteStream(zip));

      this._set('verifying', "Vérification de l'empreinte SHA-256…");
      if ((await sha256(zip)) !== expected) throw new Error('empreinte SHA-256 invalide — téléchargement rejeté par sécurité');

      this._set('extracting', 'Installation de ffmpeg…');
      await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${work}\\x' -Force`], 180_000);
      const root = readdirSync(join(work, 'x')).find((n) => existsSync(join(work, 'x', n, 'bin', 'ffmpeg.exe')));
      if (!root) throw new Error("ffmpeg.exe introuvable dans l'archive");
      mkdirSync(this.dir, { recursive: true });
      renameSync(join(work, 'x', root, 'bin', 'ffmpeg.exe'), this.exe + '.part');
      renameSync(this.exe + '.part', this.exe);
      this._set('done', 'ffmpeg est installé.');
      this.log('(ffmpeg) installé.');
      return this.exe;
    } catch (err) {
      this._set('error', err.message);
      this.log(`(ffmpeg) échec : ${err.message}`);
      throw err;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  // Rend `input` lisible dans Discord : MP4 + H.264 + AAC, sous `limitBytes`.
  // Renvoie { path, cleanup } pour le fichier à joindre, ou null si l'original convient
  // déjà (ou si la préparation est impossible : on retombe alors sur l'original).
  async prepare(input, limitBytes) {
    const size = statSync(input).size;
    let exe;
    try {
      exe = await this.ensure();
    } catch {
      return null;
    }
    // `ffmpeg -i` sans sortie se termine toujours en erreur : les infos du clip sont dans son stderr complet.
    const probe = await this.run(exe, ['-hide_banner', '-i', input], 30_000).catch((e) => ({ err: e.stderr || e.message }));
    const info = parseStreams(probe.err);
    const isMp4 = extname(input).toLowerCase() === '.mp4';
    const video = info.video === 'h264';
    if (isMp4 && video && info.audio !== 'other' && size < limitBytes) return null;

    const outDir = mkdtempSync(join(tmpdir(), 'sundaystream-clip-'));
    const path = join(outDir, 'clip.mp4');
    const cleanup = () => rmSync(outDir, { recursive: true, force: true });
    const audio = info.audio === 'aac' || info.audio === null ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', String(AUDIO_BPS)];
    try {
      // 1) simple changement de conteneur (sans perte, quasi instantané) si le contenu est déjà compatible
      if (video && size < limitBytes) {
        await this.run(exe, ['-y', '-hide_banner', '-i', input, '-c:v', 'copy', ...audio, '-movflags', '+faststart', path], 5 * 60_000);
        if (statSync(path).size < limitBytes) {
          this.log(`(ffmpeg) clip converti en MP4 (${(statSync(path).size / 1048576).toFixed(1)} Mo).`);
          return { path, cleanup };
        }
      }
      // 2) réencodage H.264 : au débit qui tient sous la limite, ou en qualité normale si seul le codec posait problème
      const fit = size >= limitBytes;
      const bps = fit ? videoBitrate(info.duration, limitBytes) : null;
      if (fit && !bps) {
        this.log('(ffmpeg) clip trop long pour être compressé sous la limite.');
        cleanup();
        return null;
      }
      const rate = bps ? ['-b:v', String(bps), '-maxrate', String(Math.floor(bps * 1.2)), '-bufsize', String(bps * 2)] : ['-crf', '23'];
      const scale = bps && bps < 1_200_000 ? ['-vf', "scale=-2:'min(720,ih)'"] : [];
      await this.run(exe, ['-y', '-hide_banner', '-i', input, ...scale, '-c:v', 'libx264', '-preset', 'veryfast', ...rate, '-c:a', 'aac', '-b:a', String(AUDIO_BPS), '-movflags', '+faststart', path], 10 * 60_000);
      if (statSync(path).size >= limitBytes) throw new Error('sortie encore trop volumineuse');
      this.log(`(ffmpeg) clip réencodé : ${(statSync(path).size / 1048576).toFixed(1)} Mo.`);
      return { path, cleanup };
    } catch (err) {
      this.log(`(ffmpeg) préparation du clip impossible : ${err.message}`);
      cleanup();
      return null;
    }
  }
}
