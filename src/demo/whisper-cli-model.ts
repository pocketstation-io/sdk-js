import { execFile } from 'node:child_process';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { WhisperModel, WhisperResult, WhisperSegment, WhisperTranscriberConfiguration } from './faster-whisper.js';
const executeFile = promisify(execFile);

/**
 * Real local Whisper model backed by the installed `whisper-cli` executable.
 *
 * The model path is explicit. This adapter never downloads a model or mutates
 * the application's model cache.
 */
export class WhisperCliModel implements WhisperModel {
  readonly #configuration: WhisperTranscriberConfiguration;
  readonly #active = new Map<AbortController, Promise<WhisperResult>>();
  #closed = false;

  public constructor(configuration: WhisperTranscriberConfiguration) {
    this.#configuration = configuration;
  }

  public transcribe(audio: Float32Array, options: {
    readonly beamSize: number; readonly language: string | undefined;
  }): Promise<WhisperResult> {
    if (this.#closed) return Promise.reject(new Error('Whisper model is closed'));
    const abort = new AbortController();
    const task = this.#transcribe(audio, options, abort.signal).finally(() => this.#active.delete(abort));
    this.#active.set(abort, task);
    return task;
  }

  public cancel(): void {
    for (const abort of this.#active.keys()) abort.abort(new Error('Whisper inference cancelled'));
  }

  public async close(): Promise<void> {
    this.#closed = true;
    this.cancel();
    await Promise.allSettled([...this.#active.values()]);
  }

  async #transcribe(audio: Float32Array, options: {
    readonly beamSize: number; readonly language: string | undefined;
  }, signal: AbortSignal): Promise<WhisperResult> {
    const directory = await mkdtemp(join(tmpdir(), 'pks-whisper-'));
    const input = join(directory, 'input.wav');
    const output = join(directory, 'transcript');
    try {
      signal.throwIfAborted();
      await writeFile(input, pcm16Wave(audio, 16_000));
      signal.throwIfAborted();
      const argumentsList = [
        '-m', this.#configuration.model,
        '-f', input,
        '-oj',
        '-of', output,
        '-np',
        ...(this.#configuration.useGpu ? [] : ['-ng']),
        '-t', String(this.#configuration.cpuThreads),
        '-p', String(this.#configuration.numWorkers),
        '-bs', String(options.beamSize),
        '-l', options.language ?? 'auto',
      ];
      const execution = executeFile(this.#configuration.whisperCliExecutable, argumentsList, {
        signal, killSignal: 'SIGKILL',
        timeout: Math.round(this.#configuration.inferenceTimeoutS * 1_000),
        maxBuffer: this.#configuration.maximumOutputBytes,
      });
      const closed = new Promise<void>((resolve) => execution.child.once('close', () => resolve()));
      try { await execution; } finally { await closed; }
      signal.throwIfAborted();
      const encoded = await readUtf8WithLimit(
        `${output}.json`,
        this.#configuration.maximumOutputBytes,
      );
      const value = JSON.parse(encoded) as unknown;
      return whisperCliResult(value);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export async function readUtf8WithLimit(path: string, maximumBytes: number): Promise<string> {
  const file = await open(path, 'r');
  try {
    const metadata = await file.stat();
    if (metadata.size > maximumBytes) {
      throw new RangeError('whisper-cli transcript exceeds maximumOutputBytes');
    }

    const bytes = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumBytes) {
      throw new RangeError('whisper-cli transcript exceeds maximumOutputBytes');
    }
    return bytes.subarray(0, offset).toString('utf8');
  } finally {
    await file.close();
  }
}

function pcm16Wave(samples: Float32Array, sampleRateHz: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  ascii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(bytes, 8, 'WAVE');
  ascii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(bytes, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32_768 : 32_767)), true);
  }
  return bytes;
}

function ascii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function whisperCliResult(value: unknown): WhisperResult {
  if (value === null || typeof value !== 'object') throw new TypeError('whisper-cli returned invalid JSON');
  const record = value as Record<string, unknown>;
  const transcription = record.transcription;
  if (!Array.isArray(transcription)) throw new TypeError('whisper-cli JSON has no transcription array');
  const segments = transcription.map((item): WhisperSegment => {
    if (item === null || typeof item !== 'object') throw new TypeError('invalid whisper-cli segment');
    const segment = item as Record<string, unknown>;
    const offsets = segment.offsets;
    const timing = offsets !== null && typeof offsets === 'object'
      ? offsets as Record<string, unknown>
      : {};
    return {
      start: finiteNumber(timing.from, 'segment offset from') / 1_000,
      end: finiteNumber(timing.to, 'segment offset to') / 1_000,
      text: typeof segment.text === 'string' ? segment.text : '',
    };
  });
  const result = record.result;
  const resultRecord = result !== null && typeof result === 'object'
    ? result as Record<string, unknown>
    : {};
  return {
    segments,
    info: {
      language: typeof resultRecord.language === 'string' ? resultRecord.language : 'unknown',
      languageProbability: typeof resultRecord.language_probability === 'number'
        ? resultRecord.language_probability
        : 0,
    },
  };
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
