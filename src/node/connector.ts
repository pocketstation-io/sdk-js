import type {
  NativeProviderAudio,
  NativeProviderCall,
  NativeProviderResult,
} from './native.js';

/** Source-aware PCM delivered to an application Connector. */
export interface ConnectorAudioFrame {
  /** Interleaved float32 samples. */
  readonly samples: Float32Array;
  /** Sample rate in hertz. */
  readonly sampleRateHz: number;
  /** Channel count. */
  readonly channels: number;
  /** Core Source identity. */
  readonly sourceId: bigint;
  /** Core stream identity. */
  readonly streamId: bigint;
  /** Monotonic frame sequence within the stream. */
  readonly sequenceNumber: bigint;
  /** Source timestamp in nanoseconds. */
  readonly timestampNs: bigint;
  /** Time Core accepted the frame into this route, in nanoseconds. */
  readonly routeEnqueuedAtNs: bigint;
  /** Time the Connector worker received the frame, in nanoseconds. */
  readonly routeReceivedAtNs: bigint;
  /** Output operation that owns generated audio, when present. */
  readonly outputGenerationId?: bigint;
}

/** Context supplied to every Connector lifecycle method. */
export interface ConnectorContext {
  /** Cancels promptly when the running Session is cancelled. */
  readonly signal: AbortSignal;
}

/** Finite native-to-JavaScript dispatch settings. */
export interface ConnectorOptions {
  /** Maximum duration of each lifecycle call in milliseconds. Defaults to 5,000. */
  readonly deadlineMs?: number;
}

/** Function accepted by the concise Connector form. */
export type ConnectorSend = (
  frame: ConnectorAudioFrame,
  context: ConnectorContext,
) => void | Promise<void>;

/**
 * Sends source-aware audio from a Core Session to application-owned code.
 *
 * Extend this class when the destination owns resources such as a socket,
 * file, encoder, or provider client. Core retains route queues, source
 * identity, delivery accounting, and Session shutdown.
 */
export abstract class Connector {
  readonly #deadlineMs: number;
  #sessionId: bigint | undefined;
  #controller = new AbortController();
  #state: 'new' | 'starting' | 'running' | 'stopping' | 'closed' = 'new';

  protected constructor(options: ConnectorOptions = {}) {
    this.#deadlineMs = options.deadlineMs ?? 5_000;
    if (
      !Number.isInteger(this.#deadlineMs) ||
      this.#deadlineMs < 1 ||
      this.#deadlineMs > 60_000
    ) {
      throw new RangeError('deadlineMs must be an integer from 1 through 60000');
    }
  }

  /** Open destination resources. Successful completion means delivery may begin. */
  public start(_context: ConnectorContext): void | Promise<void> {}

  /** Deliver one source-aware PCM frame. */
  public abstract send(
    frame: ConnectorAudioFrame,
    context: ConnectorContext,
  ): void | Promise<void>;

  /** Close destination resources exactly once. */
  public stop(
    _mode: 'drain' | 'abort',
    _context: ConnectorContext,
  ): void | Promise<void> {}

  /** @internal */
  public _bind(sessionId: bigint): void {
    if (this.#sessionId !== undefined && this.#sessionId !== sessionId) {
      throw new TypeError('A Connector object cannot be shared by different Sessions');
    }
    if (this.#state === 'closed') {
      throw new TypeError('A closed Connector cannot be registered again');
    }
    this.#sessionId = sessionId;
  }

  /** @internal */
  public _deadline(): number {
    return this.#deadlineMs;
  }

  /** @internal */
  public _abort(reason?: unknown): void {
    if (!this.#controller.signal.aborted) {
      this.#controller.abort(reason);
    }
  }

  /** @internal */
  public readonly _dispatch = async (
    request: NativeProviderCall,
  ): Promise<NativeProviderResult> => {
    const context = Object.freeze({ signal: this.#controller.signal });
    switch (request.operation) {
      case 'start':
        if (this.#state !== 'new') {
          throw new Error(`Connector cannot start while ${this.#state}`);
        }
        this.#state = 'starting';
        try {
          await this.start(context);
          this.#state = 'running';
          return {};
        } catch (failure) {
          this.#state = 'stopping';
          this._abort(failure);
          try {
            await this.stop('abort', context);
          } finally {
            this.#state = 'closed';
          }
          throw failure;
        }
      case 'send':
        if (this.#state !== 'running' || request.audio == null) {
          throw new Error('Connector received audio outside its running lifetime');
        }
        await this.send(_audioFrameFromNative(request.audio), context);
        return { outcome: 'delivered' };
      case 'stop': {
        if (this.#state === 'closed') return {};
        const mode = this.#controller.signal.aborted ? 'abort' : 'drain';
        this.#state = 'stopping';
        if (mode === 'abort') this._abort();
        try {
          await this.stop(mode, context);
        } finally {
          this.#state = 'closed';
        }
        return {};
      }
      default:
        throw new Error(`Unsupported Connector operation: ${request.operation}`);
    }
  };
}

/** Create a Connector from one delivery function. */
export function connector(
  send: ConnectorSend,
  options: ConnectorOptions = {},
): Connector {
  return new (class extends Connector {
    public constructor() {
      super(options);
    }

    public send(
      frame: ConnectorAudioFrame,
      context: ConnectorContext,
    ): void | Promise<void> {
      return send(frame, context);
    }
  })();
}

/** @internal */
export function _audioFrameFromNative(value: NativeProviderAudio): ConnectorAudioFrame {
  const bytes = value.samplesF32Le;
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const frame: ConnectorAudioFrame = {
    samples: new Float32Array(copy),
    sampleRateHz: value.sampleRateHz,
    channels: value.channelCount,
    sourceId: BigInt(value.sourceId),
    streamId: BigInt(value.streamId),
    sequenceNumber: BigInt(value.sequenceNumber),
    timestampNs: BigInt(value.timestampNs),
    routeEnqueuedAtNs: BigInt(value.routeEnqueuedAtNs),
    routeReceivedAtNs: BigInt(value.routeReceivedAtNs),
    ...(value.outputGenerationId == null
      ? {}
      : { outputGenerationId: BigInt(value.outputGenerationId) }),
  };
  return Object.freeze(frame);
}
