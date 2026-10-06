import {
  AudioHistoryError,
  RecordingClipWindow,
  Session,
} from '../node/index.js';
import type { AudioHistory } from '../node/index.js';

async function waitReceived(
  history: AudioHistory,
  count: bigint,
): Promise<void> {
  const deadlineMs = Date.now() + 5000;
  while ((await history.observations()).receivedBuffersTotal < count) {
    expect(Date.now()).toBeLessThan(deadlineMs);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function pcm(wav: Buffer): number[] {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const tag = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    offset += 8;
    if (tag === 'data')
      return Array.from({ length: size / 4 }, (_, index) =>
        wav.readFloatLE(offset + index * 4),
      );
    offset += size + (size % 2);
  }
  throw new Error('No PCM data');
}

describe('Live history through the production native addon', () => {
  it('reads delayed trigger windows and preserves independent live stems', async () => {
    const session = new Session({ channels: 2, frameDurationMs: 20 });
    const history = session.audioHistory();
    const app = session.audioInput('app', { capacityFrames: 16 });
    const mic = session.audioInput('mic', { capacityFrames: 16 });
    app.output.retainAudio();
    mic.output.retainAudio();
    const running = await session.start();
    try {
      for (let index = 0; index < 5; index += 1) {
        await app.write(
          Float32Array.from(
            Array.from({ length: 960 }, () => [index / 8, -index / 8]).flat(),
          ),
        );
        await mic.write(new Float32Array(1920).fill(0.125));
        await waitReceived(history, BigInt(index + 1) * 2n);
      }
      const stem = (await history.getStems()).find(
        (value) => value.sourceId === app.sourceId,
      )!;
      const window = RecordingClipWindow.around(
        stem.firstTimestampNs + 40000000n,
        stem.firstTimestampNs + 60000000n,
        20000000n,
        60000000n,
      );
      await expect(history.readClip(stem.stemId, window)).rejects.toMatchObject(
        { code: 'recording.history_not_ready' },
      );
      await app.write(
        Float32Array.from(
          Array.from({ length: 960 }, () => [0.625, -0.625]).flat(),
        ),
      );
      await waitReceived(history, 11n);
      const clip = await history.readClip(stem.stemId, window);
      expect(clip.stem.sourceId).toBe(app.sourceId);
      expect(clip.stem.sessionId).toBe(running.sessionId);
      expect([clip.firstSampleFrame, clip.sampleFrames]).toEqual([960n, 4800n]);
      expect(pcm(clip.wav)).toEqual(
        Array.from({ length: 5 }, (_, i) =>
          Array.from({ length: 960 }, () => [(i + 1) / 8, -(i + 1) / 8]).flat(),
        ).flat(),
      );
      expect(clip.discontinuities).toEqual([]);
      let ticks = 0;
      await Promise.all([
        history.readClip(stem.stemId, window),
        (async () => {
          for (let i = 0; i < 20; i += 1) {
            await Promise.resolve();
            ticks += 1;
          }
        })(),
      ]);
      expect(ticks).toBe(20);
    } finally {
      app.close();
      mic.close();
      expect((await running.stop()).success).toBe(true);
    }
    expect((await history.observations()).state).toBe('complete');
  });

  it('evicts old context, clears without stopping capture and discards on cancellation', async () => {
    const session = new Session({ channels: 2, frameDurationMs: 20 });
    const history = session.audioHistory({
      retentionNs: 60000000n,
      maxPcmBytes: 23040,
      maxBuffers: 3,
    });
    const input = session.audioInput('app', { capacityFrames: 16 });
    input.output.retainAudio();
    const running = await session.start();
    try {
      for (let index = 0; index < 20; index += 1) {
        await input.write(new Float32Array(1920).fill(0.25));
        await waitReceived(history, BigInt(index + 1));
      }
      const stem = (await history.getStems())[0]!;
      expect(await history.observations()).toMatchObject({
        retainedBuffers: 3,
        retainedPcmBytes: 23040,
        evictedBuffersTotal: 17n,
      });
      await expect(
        history.readClip(
          stem.stemId,
          new RecordingClipWindow(
            stem.firstTimestampNs,
            stem.firstTimestampNs + 20000000n,
          ),
        ),
      ).rejects.toMatchObject({ code: 'recording.history_expired' });
      await history.clear();
      expect((await history.observations()).retainedPcmBytes).toBe(0);
      await input.write(new Float32Array(1920).fill(0.5));
      await waitReceived(history, 21n);
      expect((await history.observations()).retainedBuffers).toBe(1);
    } finally {
      input.close();
      await running.cancel();
    }
    expect(await history.observations()).toMatchObject({
      state: 'cancelled',
      retainedPcmBytes: 0,
    });
  });

  it.each([{ retentionNs: 0n }, { maxBuffers: 0 }, { maxPcmBytes: NaN }])(
    'rejects invalid limits %s',
    (config) => {
      expect(() => new Session().audioHistory(config)).toThrow(
        AudioHistoryError,
      );
    },
  );
});
