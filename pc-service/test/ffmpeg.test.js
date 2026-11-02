import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUNDAY_DATA_DIR = mkdtempSync(join(tmpdir(), 'ss-data-'));
const { parseDuration, parseStreams, videoBitrate, FfmpegTool, run } = await import('../src/ffmpeg.js');

const MB = 1024 * 1024;

test('durée lue dans la sortie de ffmpeg -i', () => {
  assert.equal(parseDuration('  Duration: 00:00:30.04, start: 0.0'), 30.04);
  assert.equal(parseDuration('Duration: 01:02:03.50'), 3723.5);
  assert.equal(parseDuration('rien'), null);
});

test('codecs lus dans la sortie de ffmpeg -i', () => {
  const t = ['Duration: 00:00:30.00', '  Stream #0:0: Video: hevc (Main), yuv420p, 1920x1080', '  Stream #0:1: Audio: aac (LC), 48000 Hz'].join(' ');
  assert.deepEqual(parseStreams(t), { video: 'hevc', audio: 'aac', duration: 30 });
  assert.equal(parseStreams('Stream #0:1: Audio: opus, 48000 Hz').audio, 'other');
  assert.equal(parseStreams('rien').video, null);
});

test('débit vidéo : tient sous la limite avec marge, refuse un clip trop long', () => {
  const bps = videoBitrate(60, 10 * MB);
  assert.ok(bps > 0);
  assert.ok(((bps + 96_000) * 60) / 8 < 10 * MB * 0.93);
  assert.equal(videoBitrate(3600, 10 * MB), null);
  assert.equal(videoBitrate(null, 10 * MB), null);
});

test('prepare : ffmpeg indisponible -> null sans lever', async () => {
  const tool = new FfmpegTool({ dir: join(tmpdir(), 'ss-absent-ffmpeg') });
  tool.ensure = async () => { throw new Error('hors ligne'); };
  const input = join(mkdtempSync(join(tmpdir(), 'ss-in-')), 'x.mkv');
  writeFileSync(input, 'x');
  assert.equal(await tool.prepare(input, 10 * MB), null);
});

test('ensure : déjà installé -> pas de téléchargement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-ff-'));
  writeFileSync(join(dir, 'ffmpeg.exe'), '');
  const tool = new FfmpegTool({ dir });
  assert.equal(await tool.ensure(), join(dir, 'ffmpeg.exe'));
});

test('prepare : durée lue dans le stderr de `ffmpeg -i` (qui échoue toujours sans sortie) -> réencodage, pas « trop long »', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-prep-'));
  const input = join(dir, 'clip.mp4');
  writeFileSync(input, Buffer.alloc(11 * MB));
  const calls = [];
  const runner = async (exe, args) => {
    calls.push(args);
    if (args.includes('-b:v')) { writeFileSync(args.at(-1), Buffer.alloc(5 * MB)); return { err: '' }; }
    throw Object.assign(new Error('At least one output file must be specified'), {
      stderr: ['Duration: 00:01:00.00', '  Stream #0:0: Video: h264, 1920x1080', '  Stream #0:1: Audio: aac', 'At least one output file must be specified'].join(' | '),
    });
  };
  const tool = new FfmpegTool({ dir, runner });
  tool.ensure = async () => 'ffmpeg';
  const out = await tool.prepare(input, 10 * MB);
  assert.ok(out, 'un fichier compressé doit être produit');
  assert.ok(calls.some((a) => a.includes('libx264')));
  out.cleanup();
});

test('run : un processus qui échoue transmet son stderr complet (ffmpeg -i y écrit la durée)', async () => {
  const err = await run(process.execPath, ['-e', "console.error('Duration: 00:00:59.12'); console.error('x'); console.error('y'); console.error('z'); process.exit(1)"], 10_000).catch((e) => e);
  assert.match(err.stderr, /Duration: 00:00:59\.12/);
});

test('prepare : clip beaucoup trop long -> rogné à la fin au lieu d’être abandonné', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-trim-'));
  const input = join(dir, 'long.mp4');
  writeFileSync(input, Buffer.alloc(50 * MB));
  const calls = [];
  const runner = async (exe, args) => {
    calls.push(args);
    if (args.includes('-b:v')) { writeFileSync(args.at(-1), Buffer.alloc(5 * MB)); return { err: '' }; }
    throw Object.assign(new Error('x'), { stderr: 'Duration: 00:20:00.00 | Stream #0:0: Video: h264 | Stream #0:1: Audio: aac' });
  };
  const tool = new FfmpegTool({ dir, runner });
  tool.ensure = async () => 'ffmpeg';
  const out = await tool.prepare(input, 10 * MB);
  assert.ok(out && out.trimmed > 0 && out.trimmed < 200);
  const enc = calls.find((a) => a.includes('-b:v'));
  assert.equal(enc[enc.indexOf('-sseof') + 1], String(-out.trimmed));
  out.cleanup();
});

test('trimClip : garde les N dernières secondes avant la fin du moment, écarte le silence final', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-tc-'));
  const input = join(dir, 'Replay.mp4');
  writeFileSync(input, Buffer.alloc(2048));
  let cut;
  const runner = async (exe, args) => {
    if (args.includes('-t')) { cut = args; writeFileSync(args.at(-1), Buffer.alloc(2048, 1)); return { err: '' }; }
    throw Object.assign(new Error('x'), { stderr: 'Duration: 00:01:00.00 | Video: h264 | Audio: aac' });
  };
  const tool = new FfmpegTool({ dir, runner });
  tool.ensure = async () => 'ffmpeg';
  // 60 s de clip, fin du moment 8 s avant la fin : fenêtre de 45 s terminée à 52 s -> début à 7 s
  assert.equal(await tool.trimClip(input, { keepSec: 45, tailSec: 8 }), 45);
  assert.equal(cut[cut.indexOf('-ss') + 1], '7.00');
  assert.equal(await tool.trimClip(input, { keepSec: 45, tailSec: 0 }), 45);
  assert.equal(cut[cut.indexOf('-ss') + 1], '15.00');
});

test('trimClip : clip déjà assez court -> rien', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-tc2-'));
  const input = join(dir, 'Replay.mp4');
  writeFileSync(input, Buffer.alloc(2048));
  const tool = new FfmpegTool({ dir, runner: async () => { throw Object.assign(new Error('x'), { stderr: 'Duration: 00:00:40.00 | Video: h264' }); } });
  tool.ensure = async () => 'ffmpeg';
  assert.equal(await tool.trimClip(input, { keepSec: 45 }), null);
});
