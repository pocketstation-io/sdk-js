import { encodeWindow, decodeWindow } from '../demo/window-signal.js';
import type { AudioWindow } from '../demo/audio-windows.js';

const window: AudioWindow = {
  sampleRateHz: 48000, channelCount: 1, sessionId: 18446744073709551615n,
  sourceId: 9007199254740993n, streamId: 3n, clockId: 1, sourceGeneration: 1,
  policyEpoch: 0n, sequenceStart: 0n, sequenceEnd: 49n, discontinuityEpoch: 0n,
  timestampStartNs: 0n, timestampEndNs: 980000000n,
  sourceTimestampStartNs: undefined, sourceTimestampEndNs: undefined,
  sessionTimestampStartNs: 0n, sessionTimestampEndNs: 980000000n,
  discontinuityReasons: ['sequence-gap'], samples: new Float32Array(48000),
};

test('bounded window codec preserves u64 lineage, original duration and clipped PCM16', () => {
  const bytes = encodeWindow(window, new Float32Array([-2, -.5, 0, .5, 2]));
  const result = decodeWindow(bytes);
  expect(result.window.sourceId).toBe(window.sourceId);
  expect(result.window.sessionId).toBe(window.sessionId);
  expect(result.window.discontinuityReasons).toEqual(['sequence-gap']);
  expect(result.window.sourceTimestampStartNs).toBeUndefined();
  expect(result.durationMs).toBe(1000);
  expect(Array.from(result.audio)).toEqual([-1, -.5, 0, expect.closeTo(.5, 4), 1]);
  const headerBytes = Buffer.from(bytes).readUInt32LE();
  const header = JSON.parse(Buffer.from(bytes).subarray(4, 4 + headerBytes).toString()) as Record<string, unknown>;
  expect(header.source_id).toBe('9007199254740993');
  expect(header.duration_ms).toBe(1000);
});

test('window codec rejects truncation, oversized windows and nonfinite PCM', () => {
  const bytes = encodeWindow(window, new Float32Array([.1]));
  expect(() => decodeWindow(bytes.subarray(0, bytes.length - 1))).toThrow();
  expect(() => decodeWindow(new Uint8Array(3))).toThrow();
  expect(() => encodeWindow(window, new Float32Array(524288))).toThrow('bound');
  expect(() => encodeWindow(window, new Float32Array([NaN]))).toThrow('finite');
});
