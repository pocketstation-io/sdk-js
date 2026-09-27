import { SignalSpec } from '../node/graph.js';
import type { AudioWindow } from './audio-windows.js';

/** Private demo wire boundary: original lineage and finite mono 16 kHz PCM16. */
export const WINDOW_SIGNAL = SignalSpec.binary('raw', {
  role: 'transcription.window', schema: 'pks.demo.window.pcm16.v1',
});
const MAXIMUM_BYTES = 1_048_576;
const MAXIMUM_HEADER_BYTES = 8_192;
const INTEGER_FIELDS = [
  'sessionId', 'sourceId', 'streamId', 'policyEpoch', 'sequenceStart', 'sequenceEnd',
  'discontinuityEpoch', 'timestampStartNs', 'timestampEndNs', 'sourceTimestampStartNs',
  'sourceTimestampEndNs', 'sessionTimestampStartNs', 'sessionTimestampEndNs',
] as const;

export function encodeWindow(window: AudioWindow, audio: Float32Array): Uint8Array {
  const { samples, ...metadata } = window;
  const durationMs = Math.round(samples.length * 1_000 / (window.sampleRateHz * window.channelCount));
  const header = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries({ ...metadata, durationMs }).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value])),
    (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value));
  const size = 4 + header.length + audio.length * 2;
  if (header.length > MAXIMUM_HEADER_BYTES || size > MAXIMUM_BYTES) {
    throw new RangeError('transcription window exceeds its finite byte bound');
  }
  const output = Buffer.alloc(size);
  output.writeUInt32LE(header.length, 0);
  header.copy(output, 4);
  for (let index = 0; index < audio.length; index += 1) {
    const sample = audio[index]!;
    if (!Number.isFinite(sample)) throw new TypeError('transcription samples must be finite');
    output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), 4 + header.length + index * 2);
  }
  return output;
}

export function decodeWindow(data: Uint8Array): {
  readonly window: AudioWindow; readonly audio: Float32Array; readonly durationMs: number;
} {
  if (data.byteLength < 4 || data.byteLength > MAXIMUM_BYTES) throw new TypeError('invalid window bytes');
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const size = bytes.readUInt32LE(0);
  if (size < 1 || size > MAXIMUM_HEADER_BYTES || size + 4 > bytes.length || (bytes.length - size - 4) % 2 !== 0) {
    throw new TypeError('invalid transcription window framing');
  }
  const parsed = JSON.parse(bytes.subarray(4, size + 4).toString()) as Record<string, unknown>;
  const metadata = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()), value === null ? undefined : value]));
  for (const key of INTEGER_FIELDS) if (metadata[key] !== undefined) metadata[key] = BigInt(metadata[key] as string);
  const audio = new Float32Array((bytes.length - size - 4) / 2);
  for (let index = 0; index < audio.length; index += 1) audio[index] = decodeSample(bytes.readInt16LE(size + 4 + index * 2));
  const durationMs = metadata.durationMs as number;
  delete metadata.durationMs;
  return { window: { ...metadata, samples: new Float32Array() } as unknown as AudioWindow, audio, durationMs };
}

function decodeSample(value: number): number { return value / (value < 0 ? 32768 : 32767); }
