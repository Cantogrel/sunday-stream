import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUNDAY_DATA_DIR = mkdtempSync(join(tmpdir(), 'ss-data-'));
const { parseDuration, parseStreams, videoBitrate, FfmpegTool } = await import('../src/ffmpeg.js');

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
