import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RecordedAudio, RecordingClipError, RecordingClipWindow,
  RuntimeSessionId, Session, StemId,
} from '../node/index.js';
import type { RecordingOutcome } from '../node/observations.js';

function pcm(wav: Buffer): number[] {
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const tag = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    offset += 8;
    if (tag === 'data') {
      return Array.from({ length: size / 4 }, (_, index) => wav.readFloatLE(offset + index * 4));
    }
    offset += size + size % 2;
  }
  throw new Error('No WAV data chunk');
}

async function recordingFixture() {
  const root = mkdtempSync(join(tmpdir(), 'pks-js-recording-clips-'));
  try {
    const session = new Session({ recordingRoot: root, channels: 2, frameDurationMs: 20 });
    const application = session.audioInput('application', { capacityFrames: 16 });
    const microphone = session.audioInput('microphone', { capacityFrames: 16 });
    application.output.record('application');
    microphone.output.record('microphone');
    const running = await session.start();
    let outcome: RecordingOutcome | undefined;
    try {
      for (let index = 0; index < 8; index += 1) {
        const samples = new Float32Array(1920);
        for (let frame = 0; frame < 960; frame += 1) {
          const value = (index * 960 + frame) / 10000;
          samples[frame * 2] = value;
          samples[frame * 2 + 1] = -value;
        }
        await application.write(samples, { timeoutMs: 1000 });
        await microphone.write(new Float32Array(1920).fill(0.125), { timeoutMs: 1000 });
      }
      application.close();
      microphone.close();
    } finally {
      const stop = await running.stop();
      expect(stop.success).toBe(true);
      outcome = stop.recording;
    }
    expect(outcome?.complete).toBe(true);
    if (!outcome) throw new Error('Missing recording outcome');
    expect(outcome.stems.map((stem) => stem.framesWrittenTotal)).toEqual([8n, 8n]);
    expect(outcome.stems.every((stem) => stem.framesDroppedTotal === 0n)).toBe(true);
    const reader = await RecordedAudio.fromOutcome(outcome);
    return { root, reader, outcome, sourceId: application.sourceId };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

describe('Finalized recording clips through the production native addon', () => {
  it('preserves independently recorded stereo samples and exact provenance', async () => {
    const { root, reader, outcome, sourceId } = await recordingFixture();
    try {
      expect(reader.stems.map((stem) => stem.label).sort()).toEqual(['application', 'microphone']);
      const stem = reader.stems.find((item) => item.label === 'application')!;
      expect(stem.sourceId).toBe(sourceId);
      expect(stem.sessionId).toBe(outcome.sessionId);
      expect(stem.sampleRateHz).toBe(48000);
      expect(stem.channels).toBe(2);
      const origin = stem.firstTimestampNs;
      const window = RecordingClipWindow.around(origin + 60000000n, origin + 100000000n, 20000000n, 20000000n);
      const clip = await reader.readClip(stem.stemId, window);
      expect([clip.firstSampleFrame, clip.sampleFrames]).toEqual([1920n, 3840n]);
      expect(pcm(clip.wav).slice(0, 4)).toEqual(Array.from(new Float32Array([0.192, -0.192, 0.1921, -0.1921])));
      expect(pcm(clip.wav).slice(-2)).toEqual(Array.from(new Float32Array([0.5759, -0.5759])));
      expect(clip.discontinuities).toEqual([]);
      const repeated = await reader.readClip(stem.stemId, window);
      expect(repeated.wav.equals(clip.wav)).toBe(true);
      clip.wav.fill(0);
      expect(repeated.wav.subarray(0, 4).toString()).toBe('RIFF');
      const mic = reader.stems.find((item) => item.label === 'microphone')!;
      const micClip = await reader.readClip(mic.stemId, new RecordingClipWindow(mic.firstTimestampNs, mic.finalTimestampNs));
      expect(new Set(pcm(micClip.wav))).toEqual(new Set([0.125]));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('reports actual sample-rounded bounds and explicit missing audio', async () => {
    const { root, reader } = await recordingFixture();
    try {
      const stem = reader.stems[0]!;
      const origin = stem.firstTimestampNs;
      const clip = await reader.readClip(stem.stemId, new RecordingClipWindow(origin + 20834n, origin + 41665n));
      expect([clip.firstSampleFrame, clip.sampleFrames]).toEqual([1n, 1n]);
      expect([clip.actual.startNs, clip.actual.endNs]).toEqual([origin + 20833n, origin + 41666n]);
      const bounded = await reader.readClip(stem.stemId, new RecordingClipWindow(0n, stem.finalTimestampNs + 1000000000n));
      expect(bounded.actual.startNs).toBe(origin);
      expect(bounded.sampleFrames).toBe(7680n);
      await expect(reader.readClip(stem.stemId, new RecordingClipWindow(stem.finalTimestampNs + 1n, stem.finalTimestampNs + 2n)))
        .rejects.toMatchObject({ code: 'recording.clip_no_audio' });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([[0n, 0n], [3n, 2n], [-1n, 1n], [0n, 120000000001n], [0n, 2n ** 64n]])(
    'rejects an invalid window (%s,%s) with a stable Core error code', (start, end) => {
      try { new RecordingClipWindow(start, end); throw new Error('Unexpected success'); }
      catch (error) {
        expect(error).toBeInstanceOf(RecordingClipError);
        expect(error).toMatchObject({ code: 'recording.clip_invalid_window' });
      }
    },
  );

  it('retains exact u64 windows above the JavaScript integer limit', () => {
    const origin = 2n ** 53n + 17n;
    const window = RecordingClipWindow.around(origin, origin + 100n, 3n, 5n);
    expect([window.startNs, window.endNs]).toEqual([origin - 3n, origin + 105n]);
    expect(RecordingClipWindow.around(2n, 4n, 9n, 0n).startNs).toBe(0n);
    expect(() => RecordingClipWindow.around(2n ** 64n - 3n, 2n ** 64n - 1n, 0n, 9n)).toThrow(RecordingClipError);
  });

  it('rejects wrong ownership, unknown stems and incomplete outcomes', async () => {
    const { root, reader, outcome } = await recordingFixture();
    try {
      await expect(RecordedAudio.open(outcome.sessionDirectory, RuntimeSessionId(outcome.sessionId + 1n)))
        .rejects.toMatchObject({ code: 'recording.clip_invalid_recording' });
      const stem = reader.stems[0]!;
      await expect(reader.readClip(StemId(2n ** 64n - 1n), new RecordingClipWindow(stem.firstTimestampNs, stem.finalTimestampNs)))
        .rejects.toMatchObject({ code: 'recording.clip_unknown_stem' });
      await expect(RecordedAudio.fromOutcome({ ...outcome, complete: false }))
        .rejects.toMatchObject({ code: 'recording.clip_invalid_recording' });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each(['manifest', 'wav'])('fails closed after changing the %s', async (changed) => {
    const { root, reader, outcome } = await recordingFixture();
    try {
      const stem = reader.stems[0]!;
      if (changed === 'manifest') writeFileSync(outcome.manifestPath, `${readFileSync(outcome.manifestPath, 'utf8')} `);
      else {
        const path = join(outcome.sessionDirectory, 'stems', `${stem.label}.wav`);
        const bytes = readFileSync(path);
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
        writeFileSync(path, bytes);
      }
      await expect(reader.readClip(stem.stemId, new RecordingClipWindow(stem.firstTimestampNs, stem.finalTimestampNs)))
        .rejects.toBeInstanceOf(RecordingClipError);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('keeps native file reads off the event loop', async () => {
    const { root, reader } = await recordingFixture();
    try {
      const stem = reader.stems[0]!;
      const window = new RecordingClipWindow(stem.firstTimestampNs, stem.finalTimestampNs);
      let heartbeat = false;
      const scheduled = new Promise<void>((resolve) => setImmediate(() => { heartbeat = true; resolve(); }));
      const clips = await Promise.all(Array.from({ length: 4 }, () => reader.readClip(stem.stemId, window)));
      await scheduled;
      expect(heartbeat).toBe(true);
      expect(clips.every((clip) => clip.wav.equals(clips[0]!.wav))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
