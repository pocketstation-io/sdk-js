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
import { WINDOW_SIGNAL, encodeWindow, decodeWindow } from './window-signal.js';
import { TRANSCRIPT_SIGNAL, Transcript } from './transcript.js';

import { WhisperCliModel } from './whisper-cli-model.js';
export { WhisperCliModel, readUtf8WithLimit } from './whisper-cli-model.js';

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
  cancel?(): void | Promise<void>;
  close?(): void | Promise<void>;
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
  /** Enable the local whisper-cli GPU backend; false selects a reproducible CPU profile. */
  public readonly useGpu: boolean;
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
  /** Accept each source's channel layout by default; optionally constrain it. */
  public readonly inputChannels: 1 | 2 | 'any';
  public readonly inputFrameSamplesPerChannel: number;
  public readonly whisperCliExecutable: string;

  public constructor(options: {
    readonly model?: string;
    readonly useGpu?: boolean;
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
    readonly inputChannels?: 1 | 2 | 'any';
    readonly inputFrameSamplesPerChannel?: number;
    readonly whisperCliExecutable?: string;
  } = {}) {
    this.model = nonEmpty(options.model ?? 'models/ggml-base.bin', 'model');
    this.useGpu = options.useGpu ?? false;
    if (typeof this.useGpu !== 'boolean') throw new TypeError('useGpu must be boolean');
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
    this.inputChannels = options.inputChannels ?? 'any';
    if (![1, 2, 'any'].includes(this.inputChannels)) {
      throw new RangeError('inputChannels must be 1, 2, or any');
    }
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
      channelLayout: configuration.inputChannels === 'any'
        ? 'any' : configuration.inputChannels === 1 ? 'mono' : 'stereo',
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
    const selected = [...streams];
    if (selected.length === 0) throw new TypeError('transcription requires at least one input stream');
    if (selected.length > this.configuration.maximumSources) throw new RangeError('maximum transcription sources exceeded');
    const configuration = this.configuration;
    const windowRegistration = session.registerOperator(OperatorProvider.withNode(new OperatorManifest({
      operatorId: 'community.whisper.windows.v1',
      inputs: this.manifest.inputs,
      outputs: [PortSpec.output('window', WINDOW_SIGNAL)],
      queueCapacitySignals: configuration.queueCapacitySignals,
      drainQueued: false,
    }), () => new WindowNode(configuration, this.#audioConverter)));
    const windowsByStream = selected.map(() => windowRegistration.declare());
    const inference = session.registerOperator(OperatorProvider.withNode(new OperatorManifest({
      operatorId: 'community.whisper.inference.v1',
      inputs: [PortSpec.input('window', WINDOW_SIGNAL, { multiplicity: Multiplicity.MANY })],
      outputs: this.manifest.outputs,
      queueCapacitySignals: 8,
      processTimeoutMs: this.manifest.processTimeoutMs,
      filesystemAllowed: true,
      drainQueued: false,
      terminalRoles: this.manifest.terminalRoles,
    }), async () => new WindowInferenceNode(new WhisperTranscriberNode(
      configuration, await this.#modelFactory(configuration), this.#audioConverter,
    )), { deadlines: new OperatorDeadlines({
      createMs: Math.round(configuration.createTimeoutS * 1_000),
      processMs: Math.round((configuration.inferenceTimeoutS + 0.5) * 1_000),
      closeMs: 5_000,
    }) })).declare();
    for (const [index, stream] of selected.entries()) {
      const windows = windowsByStream[index]!;
      stream.connect(windows.input('audio'));
      windows.output('window').connect(inference.input('window'));
    }
    return session.subscribe(inference.output('transcript'), { signal: TRANSCRIPT_SIGNAL });
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

class WindowNode implements AuthoredOperatorNode {
  readonly #windows: AudioWindowBuffer;
  readonly #convert: AudioConverter;
  public constructor(configuration: WhisperTranscriberConfiguration, convert: AudioConverter) {
    this.#windows = new AudioWindowBuffer(configuration);
    this.#convert = convert;
  }
  public process(input: string, envelope: SignalEnvelope): readonly OperatorEmission[] {
    if (input !== 'audio') throw new TypeError('unexpected window input');
    return this.#emit(this.#windows.push(envelope));
  }
  public flush(): readonly OperatorEmission[] { return this.#emit(this.#windows.flush()); }
  public cancel(): void { this.#windows.clear(); }
  public close(): void { this.cancel(); }
  #emit(windows: readonly AudioWindow[]): readonly OperatorEmission[] {
    return windows.map((window) => OperatorEmission.bytes(encodeWindow(window, this.#convert(window)), { signal: WINDOW_SIGNAL }));
  }
}

class WindowInferenceNode implements AuthoredOperatorNode {
  readonly #node: WhisperTranscriberNode;
  public constructor(node: WhisperTranscriberNode) { this.#node = node; }
  public async process(input: string, envelope: SignalEnvelope): Promise<readonly OperatorEmission[]> {
    if (input !== 'window' || envelope.payload.kind !== 'bytes') throw new TypeError('invalid inference window input');
    const { window, audio, durationMs } = decodeWindow(envelope.payload.data);
    return [await this.#node.transcribeWindow(window, audio, durationMs)];
  }
  public async cancel(): Promise<void> { await this.#node.cancel(); }
  public async close(): Promise<void> { await this.#node.close(); }
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
    return await Promise.all(this.#windows.push(envelope).map((window) => this.transcribeWindow(window)));
  }

  public async flush(): Promise<readonly OperatorEmission[]> {
    if (this.#cancelled) {
      this.#windows.clear();
      return [];
    }
    return await Promise.all(this.#windows.flush().map((window) => this.transcribeWindow(window)));
  }

  public async cancel(): Promise<void> {
    this.#cancelled = true;
    this.#windows.clear();
    await this.#model.cancel?.();
  }

  public async close(): Promise<void> {
    await this.cancel();
    await this.#model.close?.();
  }

  public async transcribeWindow(window: AudioWindow, preparedAudio?: Float32Array, durationMs?: number): Promise<OperatorEmission> {
    if (this.#cancelled) throw new Error('transcription Operator is cancelled');
    const started = process.hrtime.bigint();
    const duration = durationMs ?? Math.round(window.samples.length * 1_000 / (window.sampleRateHz * window.channelCount));
    const tooShort = duration < Math.min(0.5, this.#configuration.windowSeconds) * 1_000;
    const result = tooShort ? { segments: [], info: { language: this.#configuration.language ?? 'unknown', languageProbability: 0 } }
      : await this.#model.transcribe(preparedAudio ?? this.#audioConverter(window), {
        beamSize: this.#configuration.beamSize,
        language: this.#configuration.language,
      });
    if (this.#cancelled) throw new Error('transcription Operator is cancelled');
    const transcript = {
      processing_outcome: tooShort ? 'skipped-short-window' : 'transcribed',
      channel_count: window.channelCount,
      clock_id: window.clockId,
      discontinuity_epoch: decimalInteger(window.discontinuityEpoch),
      discontinuity_reasons: window.discontinuityReasons,
      duration_ms: durationMs ?? Math.round(
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

