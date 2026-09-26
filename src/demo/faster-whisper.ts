import { execFile } from 'node:child_process';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Capture } from '../node/capture.js';
import {
  MediaCaps,
  Multiplicity,
  PortSpec,
  SignalSpec,
} from '../node/graph.js';
import {
  OperatorDeadlines,
  OperatorManifest,
  OperatorProvider,
  type AuthoredOperatorNode,
} from '../node/operator.js';
import { OperatorEmission } from '../node/provider.js';
import {
  type DerivedStream,
  type Session,
  type SourceOutput,
  type Stem,
} from '../node/session.js';
import type { BusSubscription, SignalEnvelope } from '../node/signals.js';
import {
  AudioWindowBuffer,
  mono16Khz,
  type AudioWindow,
} from './audio-windows.js';
import { TRANSCRIPT_SIGNAL, Transcript } from './transcript.js';

const executeFile = promisify(execFile);

/** One segment returned by a local Whisper implementation. */
export interface WhisperSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Language information returned with one transcription. */
export interface WhisperInfo {
  readonly language: string;
  readonly languageProbability: number;
}

/** Result from one bounded local transcription call. */
export interface WhisperResult {
  readonly segments: readonly WhisperSegment[];
  readonly info: WhisperInfo;
}

/** Interface used by the demo-owned batch transcription adapter. */
export interface WhisperModel {
  transcribe(
    audio: Float32Array,
    options: {
      readonly beamSize: number;
      readonly language: string | undefined;
    },
  ): WhisperResult | Promise<WhisperResult>;
}

/** Validated finite policy for the explicit local `whisper-cli` adapter. */
export class WhisperTranscriberConfiguration {
  public readonly model: string;
  public readonly cpuThreads: number;
  public readonly numWorkers: number;
  public readonly language: string | undefined;
  public readonly beamSize: number;
  public readonly windowSeconds: number;
  public readonly queueCapacitySignals: number;
  public readonly maximumSources: number;
  public readonly maximumOutputBytes: number;
  public readonly createTimeoutS: number;
  public readonly inferenceTimeoutS: number;
  public readonly inputSampleRateHz: number;
  public readonly inputChannels: 1 | 2;
  public readonly inputFrameSamplesPerChannel: number;
  public readonly whisperCliExecutable: string;

  public constructor(options: {
    readonly model?: string;
    readonly cpuThreads?: number;
    readonly numWorkers?: number;
    readonly language?: string;
    readonly beamSize?: number;
    readonly windowSeconds?: number;
    readonly queueCapacitySignals?: number;
    readonly maximumSources?: number;
    readonly maximumOutputBytes?: number;
    readonly createTimeoutS?: number;
    readonly inferenceTimeoutS?: number;
    readonly inputSampleRateHz?: number;
    readonly inputChannels?: 1 | 2;
    readonly inputFrameSamplesPerChannel?: number;
    readonly whisperCliExecutable?: string;
  } = {}) {
    this.model = nonEmpty(options.model ?? 'models/ggml-base.bin', 'model');
    this.cpuThreads = integer(options.cpuThreads ?? 4, 'cpuThreads', 1, 64);
    this.numWorkers = integer(options.numWorkers ?? 1, 'numWorkers', 1, 16);
    this.language = optionalAscii(options.language, 'language');
    this.beamSize = integer(options.beamSize ?? 5, 'beamSize', 1, 32);
    this.windowSeconds = finite(options.windowSeconds ?? 5, 'windowSeconds', 0.1, 30);
    this.queueCapacitySignals = integer(
      options.queueCapacitySignals ?? 512,
      'queueCapacitySignals',
      8,
      4_096,
    );
    this.maximumSources = integer(options.maximumSources ?? 8, 'maximumSources', 1, 64);
    this.maximumOutputBytes = integer(
      options.maximumOutputBytes ?? 1_048_576,
      'maximumOutputBytes',
      1_024,
      16_777_216,
    );
    this.createTimeoutS = finite(options.createTimeoutS ?? 120, 'createTimeoutS', 1, 600);
    this.inferenceTimeoutS = finite(
      options.inferenceTimeoutS ?? 120,
      'inferenceTimeoutS',
      1,
      600,
    );
    this.inputSampleRateHz = integer(
      options.inputSampleRateHz ?? 48_000,
      'inputSampleRateHz',
      8_000,
      384_000,
    );
    this.inputChannels = options.inputChannels ?? 1;
    this.inputFrameSamplesPerChannel = integer(
      options.inputFrameSamplesPerChannel ?? 960,
      'inputFrameSamplesPerChannel',
      1,
      262_144,
    );
    this.whisperCliExecutable = nonEmpty(
      options.whisperCliExecutable ?? 'whisper-cli',
      'whisperCliExecutable',
    );
    Object.freeze(this);
  }
}

export type WhisperModelFactory = (
  configuration: WhisperTranscriberConfiguration,
) => WhisperModel | Promise<WhisperModel>;

export type AudioConverter = (window: AudioWindow) => Float32Array;

/**
 * Real local Whisper model backed by the installed `whisper-cli` executable.
 *
 * The model path is explicit. This adapter never downloads a model or mutates
 * the application's model cache.
 */
export class WhisperCliModel implements WhisperModel {
  readonly #configuration: WhisperTranscriberConfiguration;

  public constructor(configuration: WhisperTranscriberConfiguration) {
    this.#configuration = configuration;
  }

  public async transcribe(
    audio: Float32Array,
    options: {
      readonly beamSize: number;
      readonly language: string | undefined;
    },
  ): Promise<WhisperResult> {
    const directory = await mkdtemp(join(tmpdir(), 'pks-whisper-'));
    const input = join(directory, 'input.wav');
    const output = join(directory, 'transcript');
    try {
      await writeFile(input, pcm16Wave(audio, 16_000));
      const argumentsList = [
        '-m', this.#configuration.model,
        '-f', input,
        '-oj',
        '-of', output,
        '-np',
        '-t', String(this.#configuration.cpuThreads),
        '-p', String(this.#configuration.numWorkers),
        '-bs', String(options.beamSize),
        '-l', options.language ?? 'auto',
      ];
      await executeFile(this.#configuration.whisperCliExecutable, argumentsList, {
        timeout: Math.round(this.#configuration.inferenceTimeoutS * 1_000),
        maxBuffer: this.#configuration.maximumOutputBytes,
      });
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

/** Demo-owned source-aware local `whisper-cli` transcription integration. */
export class WhisperTranscriber {
  public readonly configuration: WhisperTranscriberConfiguration;
  public readonly manifest: OperatorManifest;
  readonly #modelFactory: WhisperModelFactory;
  readonly #audioConverter: AudioConverter;

  public constructor(
    configuration: WhisperTranscriberConfiguration = new WhisperTranscriberConfiguration(),
    options: {
      readonly modelFactory?: WhisperModelFactory;
      readonly audioConverter?: AudioConverter;
    } = {},
  ) {
    this.configuration = configuration;
    this.#modelFactory = options.modelFactory ?? ((value) => new WhisperCliModel(value));
    this.#audioConverter = options.audioConverter ?? mono16Khz;
    const audioSignal = SignalSpec.audio();
    const audioMedia = MediaCaps.audio({
      sampleRateHz: configuration.inputSampleRateHz,
      frameSamples: configuration.inputFrameSamplesPerChannel,
      channelLayout: configuration.inputChannels === 1 ? 'mono' : 'stereo',
    });
    this.manifest = new OperatorManifest({
      operatorId: 'community.whisper.stt.v1',
      inputs: [PortSpec.input('audio', audioSignal, {
        media: audioMedia,
        multiplicity: Multiplicity.MANY,
      })],
      outputs: [PortSpec.output('transcript', TRANSCRIPT_SIGNAL)],
      queueCapacitySignals: configuration.queueCapacitySignals,
      processTimeoutMs: Math.round((configuration.inferenceTimeoutS + 1) * 1_000),
      networkAllowed: false,
      filesystemAllowed: true,
      terminalRoles: ['transcript.final'],
    });
  }

  public provider(): OperatorProvider {
    const configuration = this.configuration;
    const modelFactory = this.#modelFactory;
    const audioConverter = this.#audioConverter;
    return OperatorProvider.withNode(this.manifest, async () => new WhisperTranscriberNode(
      configuration,
      await modelFactory(configuration),
      audioConverter,
    ), {
      deadlines: new OperatorDeadlines({
        createMs: Math.round(configuration.createTimeoutS * 1_000),
        prepareMs: 5_000,
        processMs: Math.round((configuration.inferenceTimeoutS + 0.5) * 1_000),
        closeMs: 5_000,
      }),
    });
  }

  public attach(
    session: Session,
    stream: Stem | SourceOutput | DerivedStream,
  ): BusSubscription {
    return this.attachMany(session, [stream]);
  }

  public attachMany(
    session: Session,
    streams: Iterable<Stem | SourceOutput | DerivedStream>,
  ): BusSubscription {
    const instance = session.registerOperator(this.provider()).declare();
    const input = instance.input('audio');
    let attached = 0;
    for (const stream of streams) {
      stream.connect(input);
      attached += 1;
    }
    if (attached === 0) throw new TypeError('transcription requires at least one input stream');
    return session.subscribe(instance.output('transcript'), { signal: TRANSCRIPT_SIGNAL });
  }

  public transcribe(capture: Capture): AsyncGenerator<Transcript> {
    const subscription = this.attachMany(capture.session, capture.stems);
    return decodeTranscripts(capture, subscription);
  }
}

async function* decodeTranscripts(
  capture: Capture,
  subscription: BusSubscription,
): AsyncGenerator<Transcript> {
  for await (const envelope of capture.signals(subscription)) {
    if (envelope.payload.kind !== 'text') {
      throw new TypeError('transcription Operator emitted a non-text signal');
    }
    yield Transcript.fromJson(envelope.payload.text);
  }
}

class WhisperTranscriberNode implements AuthoredOperatorNode {
  readonly #configuration: WhisperTranscriberConfiguration;
  readonly #model: WhisperModel;
  readonly #audioConverter: AudioConverter;
  readonly #windows: AudioWindowBuffer;
  #cancelled = false;

  public constructor(
    configuration: WhisperTranscriberConfiguration,
    model: WhisperModel,
    audioConverter: AudioConverter,
  ) {
    this.#configuration = configuration;
    this.#model = model;
    this.#audioConverter = audioConverter;
    this.#windows = new AudioWindowBuffer({
      windowSeconds: configuration.windowSeconds,
      maximumSources: configuration.maximumSources,
    });
  }

  public async process(
    inputPort: string,
    envelope: SignalEnvelope,
  ): Promise<readonly OperatorEmission[]> {
    if (inputPort !== 'audio') throw new TypeError(`unexpected input port: ${inputPort}`);
    if (this.#cancelled) throw new Error('transcription Operator is cancelled');
    return await Promise.all(this.#windows.push(envelope).map((window) => this.#transcribe(window)));
  }

  public async flush(): Promise<readonly OperatorEmission[]> {
    if (this.#cancelled) {
      this.#windows.clear();
      return [];
    }
    return await Promise.all(this.#windows.flush().map((window) => this.#transcribe(window)));
  }

  public cancel(): void {
    this.#cancelled = true;
    this.#windows.clear();
  }

  public close(): void {
    this.cancel();
  }

  async #transcribe(window: AudioWindow): Promise<OperatorEmission> {
    const started = process.hrtime.bigint();
    const result = await this.#model.transcribe(this.#audioConverter(window), {
      beamSize: this.#configuration.beamSize,
      language: this.#configuration.language,
    });
    const transcript = {
      channel_count: window.channelCount,
      clock_id: window.clockId,
      discontinuity_epoch: decimalInteger(window.discontinuityEpoch),
      discontinuity_reasons: window.discontinuityReasons,
      duration_ms: Math.round(
        window.samples.length * 1_000 / (window.sampleRateHz * window.channelCount),
      ),
      inference_duration_ns: decimalInteger(process.hrtime.bigint() - started),
      language: result.info.language,
      language_probability: result.info.languageProbability,
      policy_epoch: decimalInteger(window.policyEpoch),
      sample_rate_hz: window.sampleRateHz,
      session_id: decimalInteger(window.sessionId),
      session_timestamp_end_ns: optionalDecimalInteger(window.sessionTimestampEndNs),
      session_timestamp_start_ns: optionalDecimalInteger(window.sessionTimestampStartNs),
      segments: result.segments.map((segment) => ({
        end_s: segment.end,
        start_s: segment.start,
        text: segment.text.trim(),
      })),
      sequence_end: decimalInteger(window.sequenceEnd),
      sequence_start: decimalInteger(window.sequenceStart),
      source_id: decimalInteger(window.sourceId),
      source_generation: window.sourceGeneration,
      source_timestamp_end_ns: optionalDecimalInteger(window.sourceTimestampEndNs),
      source_timestamp_start_ns: optionalDecimalInteger(window.sourceTimestampStartNs),
      stream_id: decimalInteger(window.streamId),
      text: result.segments.map((segment) => segment.text.trim()).join(' ').trim(),
      timestamp_end_ns: decimalInteger(window.timestampEndNs),
      timestamp_start_ns: decimalInteger(window.timestampStartNs),
    };
    const encoded = JSON.stringify(transcript);
    if (Buffer.byteLength(encoded) > this.#configuration.maximumOutputBytes) {
      throw new RangeError('transcript envelope exceeds maximumOutputBytes');
    }
    return OperatorEmission.text(encoded, { signal: TRANSCRIPT_SIGNAL });
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

function decimalInteger(value: bigint): string {
  return value.toString(10);
}

function optionalDecimalInteger(value: bigint | undefined): string | undefined {
  return value === undefined ? undefined : decimalInteger(value);
}

function nonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) throw new TypeError(`${name} must not be empty`);
  return value;
}

function optionalAscii(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || /[^\x00-\x7f]/.test(value)) {
    throw new TypeError(`${name} must be undefined or non-empty ASCII`);
  }
  return value;
}

function integer(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function finite(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
