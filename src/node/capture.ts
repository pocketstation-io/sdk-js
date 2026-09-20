import type { RecordingOutcome, SessionMetrics } from './observations.js';
import {
  Session,
  type RunningSession,
  type SessionOptions,
  type StopResult,
  type Stem,
} from './session.js';
import type { EventReadOptions, EventStream, SessionEvent } from './events.js';
import type { BusSubscription, SignalStream } from './signals.js';
import { Source, type ApplicationSelection } from './sources.js';
import {
  EndOfStream,
  type AudioFrame,
  type AudioStream,
  type StreamReadOptions,
} from './streams.js';

/** Options for a finite concise audio wait. */
export interface CaptureAudioWaitOptions {
  /** Maximum wait in milliseconds. Defaults to 100. */
  readonly timeoutMs?: number;
  /** Stops this read without stopping the Capture. */
  readonly signal?: AbortSignal;
}

/** Options for the concise audio iterator. */
export interface CaptureAudioBatchOptions {
  /** Maximum wait per native read in milliseconds. Defaults to 100. */
  readonly waitTimeoutMs?: number;
  /** Stops this iterator without stopping the Capture. */
  readonly signal?: AbortSignal;
}

/** Options for the concise application-capture workflow. */
export interface CaptureOptions
  extends Pick<
    SessionOptions,
    'sampleRateHz' | 'channels' | 'frameDurationMs' | 'trace'
  > {
  /** Application display name, application ID, process ID, or discovered identity. */
  readonly application: ApplicationSelection;
  /** Open no microphone by default, the default microphone with `true`, or one device ID. */
  readonly microphone?: boolean | string;
  /** Write each requested Source to a separate WAV Stem in this directory. */
  readonly recordTo?: string;
  /** Expose both Sources through `audio`. Defaults to `true`. */
  readonly streamAudio?: boolean;
}

/** Optional settings when the application selection is the first argument. */
export type CaptureSettings = Omit<CaptureOptions, 'application'>;

/** One application and an optional microphone composed over a normal Session. */
export class Capture implements AsyncDisposable, AsyncIterable<AudioFrame> {
  /** The same explicit Session available to advanced applications. */
  public readonly session: Session;
  /** Application Stem selected by `options.application`. */
  public readonly application: Stem;
  /** Microphone Stem, present only when requested. */
  public readonly microphone: Stem | undefined;
  /** Requested Stems in stable application-then-microphone order. */
  public readonly stems: readonly Stem[];
  /** Route to the Node audio stream, when streaming was requested. */
  public readonly applicationRouteId: bigint | undefined;
  /** Microphone route to the Node audio stream, when both were requested. */
  public readonly microphoneRouteId: bigint | undefined;

  #running: RunningSession | undefined;
  #stopResult: StopResult | undefined;
  readonly #streamAudio: boolean;

  public constructor(options: CaptureOptions) {
    const microphone = options.microphone ?? false;
    if (typeof microphone !== 'boolean' && typeof microphone !== 'string') {
      throw new TypeError('microphone must be true, false, or a device ID');
    }
    if (typeof microphone === 'string' && microphone.trim().length === 0) {
      throw new RangeError('microphone device ID cannot be empty');
    }
    validateApplicationSelection(options.application);

    this.session = new Session({
      sampleRateHz: options.sampleRateHz,
      channels: options.channels,
      frameDurationMs: options.frameDurationMs,
      recordingRoot: options.recordTo,
      trace: options.trace,
    });
    this.application = this.session.capture(Source.application(options.application));
    this.microphone = microphone === false
      ? undefined
      : this.session.capture(
          microphone === true
            ? Source.defaultMicrophone()
            : Source.microphone(microphone),
        );
    this.stems = Object.freeze(
      this.microphone === undefined
        ? [this.application]
        : [this.application, this.microphone],
    );

    this.#streamAudio = options.streamAudio ?? true;
    if (this.#streamAudio) {
      const output = this.session.audio();
      this.applicationRouteId = this.application.send(output);
      this.microphoneRouteId = this.microphone?.send(output);
    }
    if (options.recordTo !== undefined) {
      this.application.record('application');
      this.microphone?.record('microphone');
    }
  }

  /** Whether this Capture owns a running Session. */
  public get isRunning(): boolean {
    return this.#running !== undefined && this.#stopResult === undefined;
  }

  /** Final result after `stop()`, `cancel()`, or async disposal. */
  public get stopResult(): StopResult | undefined {
    return this.#stopResult;
  }

  /** Final recording result when recording was requested and shutdown completed. */
  public get recording(): RecordingOutcome | undefined {
    return this.#stopResult?.recording;
  }

  /** Final recording result using the shared cross-SDK property name. */
  public get recordingOutcome(): RecordingOutcome | undefined {
    return this.recording;
  }

  /** Application Stem using the shared cross-SDK property name. */
  public get applicationStem(): Stem {
    return this.application;
  }

  /** Optional microphone Stem using the shared cross-SDK property name. */
  public get microphoneStem(): Stem | undefined {
    return this.microphone;
  }

  /** Source-aware PCM from the running Session. */
  public get audio(): AudioStream {
    if (!this.#streamAudio) {
      throw new Error('Capture audio is disabled because streamAudio is false');
    }
    return this.#requireRunning().audio;
  }

  /** Lifecycle and failure events from the running Session. */
  public get events(): EventStream {
    return this.#requireRunning().events;
  }

  /** Validate the declaration, open the requested Sources, and begin capture. */
  public async start(): Promise<this> {
    if (this.#running !== undefined) {
      throw new Error('Capture has already started');
    }
    this.#running = await this.session.start();
    return this;
  }

  /** Read one immutable snapshot of the running Session. */
  public metrics(): Promise<SessionMetrics> {
    return this.#requireRunning().metrics();
  }

  /** Open one typed subscription declared through the underlying Session. */
  public signals(subscription: BusSubscription): SignalStream {
    return this.#requireRunning().signals(subscription);
  }

  /** Poll one source-aware audio frame without waiting. */
  public async pollAudio(): Promise<AudioFrame | undefined> {
    const result = await this.audio.read({ timeoutMs: 0 });
    return result === undefined || result instanceof EndOfStream
      ? undefined
      : result;
  }

  /** Wait finitely for one source-aware audio frame. */
  public async waitAudio(
    options: CaptureAudioWaitOptions = {},
  ): Promise<AudioFrame | undefined> {
    const result = await this.audio.read({
      timeoutMs: options.timeoutMs ?? 100,
      signal: options.signal,
    });
    return result === undefined || result instanceof EndOfStream
      ? undefined
      : result;
  }

  /** Iterate source-aware audio with a finite native read deadline. */
  public audioBatches(
    options: CaptureAudioBatchOptions = {},
  ): AsyncGenerator<AudioFrame> {
    return this.audio.frames({
      timeoutMs: options.waitTimeoutMs ?? 100,
      signal: options.signal,
    });
  }

  /** Poll one lifecycle or failure event without waiting. */
  public async pollEvent(): Promise<SessionEvent | undefined> {
    return await this.events.read({ timeoutMs: 0 });
  }

  /** Wait finitely for one lifecycle or failure event. */
  public async waitEvent(
    options: EventReadOptions = {},
  ): Promise<SessionEvent | undefined> {
    return await this.events.read({
      timeoutMs: options.timeoutMs ?? 100,
      signal: options.signal,
    });
  }

  /**
   * Read source-aware frames and finish this concise Capture when iteration ends.
   *
   * Use `audio` directly when application code owns stream and Session shutdown
   * separately.
   */
  public async *frames(
    options: StreamReadOptions = {},
  ): AsyncGenerator<AudioFrame> {
    try {
      yield* this.audio.frames(options);
    } finally {
      if (this.isRunning) {
        if (options.signal?.aborted === true) {
          await this.cancel();
        } else {
          await this.stop();
        }
      }
    }
  }

  /** Iterate source-aware frames with automatic Session cleanup. */
  public [Symbol.asyncIterator](): AsyncGenerator<AudioFrame> {
    return this.frames();
  }

  /** Finish accepted work and close every Session resource. */
  public async stop(): Promise<StopResult> {
    return this.#finish('stop');
  }

  /** Stop promptly without draining pending work. */
  public async cancel(): Promise<StopResult> {
    return this.#finish('cancel');
  }

  /** Finish accepted work when started; otherwise leave the declaration closed. */
  public async close(): Promise<void> {
    if (this.#running !== undefined && this.#stopResult === undefined) {
      await this.stop();
    }
  }

  /** Finish accepted work when used with `await using`. */
  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async #finish(operation: 'stop' | 'cancel'): Promise<StopResult> {
    if (this.#stopResult !== undefined) return this.#stopResult;
    const running = this.#requireRunning();
    this.#stopResult = await running[operation]();
    return this.#stopResult;
  }

  #requireRunning(): RunningSession {
    if (this.#running === undefined) {
      throw new Error('Capture has not started');
    }
    if (this.#stopResult !== undefined) {
      throw new Error('Capture has stopped');
    }
    return this.#running;
  }
}

/** Open one application with optional microphone, recording, and format settings. */
export function capture(
  application: ApplicationSelection,
  settings?: CaptureSettings,
): Promise<Capture>;
/** Open one application from a named options object. */
export function capture(options: CaptureOptions): Promise<Capture>;
export async function capture(
  applicationOrOptions: ApplicationSelection | CaptureOptions,
  settings: CaptureSettings = {},
): Promise<Capture> {
  const options = isCaptureOptions(applicationOrOptions)
    ? applicationOrOptions
    : { ...settings, application: applicationOrOptions };
  const live = new Capture(options);
  await live.start();
  return live;
}

function isCaptureOptions(
  value: ApplicationSelection | CaptureOptions,
): value is CaptureOptions {
  return typeof value === 'object' && value !== null && 'application' in value;
}

function validateApplicationSelection(selection: ApplicationSelection): void {
  if (typeof selection === 'string') {
    if (selection.trim().length === 0) {
      throw new RangeError('application cannot be empty');
    }
    return;
  }
  if (typeof selection === 'number') {
    if (!Number.isInteger(selection) || selection <= 0 || selection > 0xffff_ffff) {
      throw new RangeError(
        'application process ID must be an integer from 1 through 4294967295',
      );
    }
    return;
  }
  if (typeof selection !== 'object' || selection === null) {
    throw new TypeError(
      'application must be a display name, process ID, or discovered identity',
    );
  }
}
