import { PocketStationError, nativeCall } from './errors.js';
import type {
  NativeRunningSessionHandle,
  NativeSidecarMessage,
  NativeSidecarProcessSpec,
  NativeSidecarRead,
  NativeSidecarSnapshot,
} from './native.js';
import {
  END_OF_STREAM,
  EndOfStream,
  StreamAbortError,
  type StreamReadOptions,
} from './streams.js';

/** Messages defined by PocketStation Sidecar Protocol 1.0. */
export type SidecarMessageKind =
  | 'signal'
  | 'ready'
  | 'error'
  | 'cancel'
  | 'close'
  | 'hello'
  | 'manifest'
  | 'configure'
  | 'observation'
  | 'closed';

/** Session-owned child process state. */
export type SidecarState =
  | 'spawned'
  | 'hello'
  | 'manifest'
  | 'configure'
  | 'ready'
  | 'running'
  | 'cancelling'
  | 'closing'
  | 'closed'
  | 'reaped'
  | 'failed';

const STATES: readonly SidecarState[] = [
  'spawned',
  'hello',
  'manifest',
  'configure',
  'ready',
  'running',
  'cancelling',
  'closing',
  'closed',
  'reaped',
  'failed',
];

/** Maximum encoded field and payload sizes, measured in bytes. */
export interface SidecarProtocolLimits {
  readonly maxSignalIdBytes?: number;
  readonly maxRoleBytes?: number;
  readonly maxSchemaBytes?: number;
  readonly maxPayloadBytes?: number;
}

/** Startup, message-processing, and shutdown deadlines in milliseconds. */
export interface SidecarDeadlines {
  readonly readyMs?: number;
  readonly processingMs?: number;
  readonly shutdownMs?: number;
}

/** Configuration for one Session-owned child process. */
export interface SidecarProcessOptions {
  /** Non-zero identity unique within the Session. */
  readonly id: bigint;
  /** Executable passed directly to the operating system. No shell is used. */
  readonly program: string;
  /** Exact process arguments. */
  readonly arguments?: readonly string[];
  /** Copied bytes sent in the PKSS configure message. */
  readonly configuration?: Uint8Array;
  /** Number of application messages accepted by each data queue. Defaults to 64. */
  readonly dataCapacityMessages?: number;
  /** Maximum accepted PKSS field and payload sizes. */
  readonly protocolLimits?: SidecarProtocolLimits;
  /** Finite lifecycle deadlines. */
  readonly deadlines?: SidecarDeadlines;
}

/** One process started, supervised, stopped, and reaped by a Session. */
export class SidecarProcess {
  readonly #native: NativeSidecarProcessSpec;

  public constructor(options: SidecarProcessOptions) {
    requirePositiveBigInt('id', options.id);
    requireText('program', options.program);
    const limits = options.protocolLimits ?? {};
    const deadlines = options.deadlines ?? {};
    const dataCapacityMessages = options.dataCapacityMessages ?? 64;
    const maxSignalIdBytes = limits.maxSignalIdBytes ?? 256;
    const maxRoleBytes = limits.maxRoleBytes ?? 256;
    const maxSchemaBytes = limits.maxSchemaBytes ?? 1_024;
    const maxPayloadBytes = limits.maxPayloadBytes ?? 1_048_576;
    const readyTimeoutMs = deadlines.readyMs ?? 5_000;
    const processingTimeoutMs = deadlines.processingMs ?? 5_000;
    const shutdownTimeoutMs = deadlines.shutdownMs ?? 2_000;
    for (const [name, value] of [
      ['dataCapacityMessages', dataCapacityMessages],
      ['maxSignalIdBytes', maxSignalIdBytes],
      ['maxRoleBytes', maxRoleBytes],
      ['maxSchemaBytes', maxSchemaBytes],
      ['maxPayloadBytes', maxPayloadBytes],
      ['readyMs', readyTimeoutMs],
      ['processingMs', processingTimeoutMs],
      ['shutdownMs', shutdownTimeoutMs],
    ] as const) {
      requirePositiveInteger(name, value);
    }
    this.#native = {
      id: options.id.toString(),
      program: options.program,
      arguments: [...(options.arguments ?? [])],
      configuration: Buffer.from(options.configuration ?? []),
      dataCapacityMessages,
      maxSignalIdBytes,
      maxRoleBytes,
      maxSchemaBytes,
      maxPayloadBytes,
      readyTimeoutMs,
      processingTimeoutMs,
      shutdownTimeoutMs,
    };
  }

  /** Process identity declared by the application. */
  public get id(): bigint {
    return BigInt(this.#native.id);
  }

  /** @internal */
  public _nativeSpec(): NativeSidecarProcessSpec {
    return this.#native;
  }
}

/** Session-scoped reference returned when a child process is registered. */
export class SidecarHandle {
  /** Process identity declared by the application. */
  public readonly id: bigint;
  /** Native Session that owns this process. */
  public readonly sessionId: bigint;

  /** @internal */
  public constructor(id: bigint, sessionId: bigint) {
    this.id = id;
    this.sessionId = sessionId;
    Object.freeze(this);
  }
}

/** Metadata assigned to one signal sent through a sidecar. */
export interface SidecarSignalOptions {
  readonly signalId: string;
  readonly streamId: bigint;
  readonly sequenceNumber: bigint;
  readonly timestampNs: bigint;
  readonly role?: string;
  readonly schema?: string;
  readonly terminal?: boolean;
}

/** One owned PKSS message. Payload bytes are copied before native enqueue. */
export class SidecarMessage {
  public readonly kind: SidecarMessageKind;
  public readonly streamId: bigint;
  public readonly sequenceNumber: bigint;
  public readonly timestampNs: bigint;
  public readonly signalId: string;
  public readonly payload: Buffer;
  public readonly terminal: boolean;
  public readonly role: string | undefined;
  public readonly schema: string | undefined;

  private constructor(native: NativeSidecarMessage) {
    this.kind = native.kind as SidecarMessageKind;
    this.streamId = BigInt(native.streamId);
    this.sequenceNumber = BigInt(native.sequenceNumber);
    this.timestampNs = BigInt(native.timestampNs);
    this.signalId = native.signalId;
    this.payload = Buffer.from(native.payload);
    this.terminal = native.terminal;
    this.role = native.role;
    this.schema = native.schema;
    Object.freeze(this);
  }

  /** Create one application signal for a sidecar. */
  public static signal(
    payload: Uint8Array,
    options: SidecarSignalOptions,
  ): SidecarMessage {
    requireText('signalId', options.signalId);
    requireUnsignedBigInt('streamId', options.streamId);
    requireUnsignedBigInt('sequenceNumber', options.sequenceNumber);
    requireUnsignedBigInt('timestampNs', options.timestampNs);
    return new SidecarMessage({
      kind: 'signal',
      streamId: options.streamId.toString(),
      sequenceNumber: options.sequenceNumber.toString(),
      timestampNs: options.timestampNs.toString(),
      signalId: options.signalId,
      payload: Buffer.from(payload),
      terminal: options.terminal ?? false,
      role: options.role,
      schema: options.schema,
    });
  }

  /** @internal */
  public static _fromNative(native: NativeSidecarMessage): SidecarMessage {
    return new SidecarMessage(native);
  }

  /** @internal */
  public _nativeMessage(): NativeSidecarMessage {
    return {
      kind: this.kind,
      streamId: this.streamId.toString(),
      sequenceNumber: this.sequenceNumber.toString(),
      timestampNs: this.timestampNs.toString(),
      signalId: this.signalId,
      payload: Buffer.from(this.payload),
      terminal: this.terminal,
      role: this.role,
      schema: this.schema,
    };
  }
}

/** Process state and queue counters at one instant. */
export class SidecarSnapshot {
  public readonly sidecarId: bigint;
  public readonly state: SidecarState;
  public readonly stateTransitions: bigint;
  public readonly dataEnqueuedTotal: bigint;
  public readonly dataReceivedTotal: bigint;
  public readonly dataDroppedTotal: bigint;
  public readonly protocolFailuresTotal: bigint;
  public readonly timeoutsTotal: bigint;
  public readonly forcedKillsTotal: bigint;
  public readonly reapsTotal: bigint;

  /** @internal */
  public constructor(native: NativeSidecarSnapshot) {
    this.sidecarId = BigInt(native.sidecarId);
    this.state = native.state as SidecarState;
    this.stateTransitions = BigInt(native.stateTransitions);
    this.dataEnqueuedTotal = BigInt(native.dataEnqueuedTotal);
    this.dataReceivedTotal = BigInt(native.dataReceivedTotal);
    this.dataDroppedTotal = BigInt(native.dataDroppedTotal);
    this.protocolFailuresTotal = BigInt(native.protocolFailuresTotal);
    this.timeoutsTotal = BigInt(native.timeoutsTotal);
    this.forcedKillsTotal = BigInt(native.forcedKillsTotal);
    this.reapsTotal = BigInt(native.reapsTotal);
    Object.freeze(this);
  }

  /** Whether this process entered the selected state before this snapshot. */
  public visited(state: SidecarState): boolean {
    const position = STATES.indexOf(state);
    return position >= 0 && (this.stateTransitions & (1n << BigInt(position))) !== 0n;
  }
}

/** Result of one sidecar read. `undefined` means that the wait expired. */
export type SidecarReadResult = SidecarMessage | EndOfStream | undefined;

/** Async message reader for one running sidecar. */
export class SidecarStream implements AsyncIterable<SidecarMessage> {
  readonly #native: NativeRunningSessionHandle;
  readonly #sidecarId: bigint;
  #activeReader = false;
  #readInProgress = false;
  #closed = false;

  /** @internal */
  public constructor(native: NativeRunningSessionHandle, sidecarId: bigint) {
    this.#native = native;
    this.#sidecarId = sidecarId;
  }

  /** Read one message, return `undefined` at timeout, or return `END_OF_STREAM`. */
  public async read(options: StreamReadOptions = {}): Promise<SidecarReadResult> {
    if (this.#activeReader || this.#readInProgress) {
      throw new PocketStationError(
        'stream.in_use',
        'Sidecar stream already has an active reader',
      );
    }
    this.#readInProgress = true;
    try {
      return await this.#readOnce(options);
    } finally {
      this.#readInProgress = false;
    }
  }

  /** Read messages until the Session closes or the reader is aborted. */
  public async *messages(
    options: StreamReadOptions = {},
  ): AsyncGenerator<SidecarMessage> {
    const timeoutMs = options.timeoutMs ?? 100;
    validateTimeout(timeoutMs, true);
    if (this.#activeReader || this.#readInProgress) {
      throw new PocketStationError(
        'stream.in_use',
        'Sidecar stream already has an active reader',
      );
    }
    this.#activeReader = true;
    try {
      while (true) {
        const result = await this.#readOnce(options);
        if (result instanceof EndOfStream) return;
        if (result !== undefined) yield result;
      }
    } finally {
      this.#activeReader = false;
    }
  }

  public [Symbol.asyncIterator](): AsyncGenerator<SidecarMessage> {
    return this.messages();
  }

  /** @internal */
  public _close(): void {
    this.#closed = true;
  }

  async #readOnce(options: StreamReadOptions): Promise<SidecarReadResult> {
    throwIfAborted(options.signal);
    const timeoutMs = options.timeoutMs ?? 100;
    validateTimeout(timeoutMs, false);
    if (this.#closed) return END_OF_STREAM;
    const deadline = performance.now() + timeoutMs;
    let firstRead = true;
    while (firstRead || performance.now() < deadline) {
      firstRead = false;
      throwIfAborted(options.signal);
      const remainingMs = Math.max(0, Math.ceil(deadline - performance.now()));
      const nativeWaitMs = timeoutMs === 0 ? 0 : Math.min(20, remainingMs);
      const result = await nativeCall(() =>
        this.#native.readSidecar(this.#sidecarId.toString(), nativeWaitMs),
      );
      const decoded = this.#decode(result);
      throwIfAborted(options.signal);
      if (decoded !== undefined) return decoded;
    }
    return undefined;
  }

  #decode(read: NativeSidecarRead): SidecarReadResult {
    if (read.status === 'item') {
      if (read.message == null) {
        throw new PocketStationError(
          'sidecar.invalid_read',
          'Native sidecar read omitted its message',
        );
      }
      return SidecarMessage._fromNative(read.message);
    }
    if (read.status === 'empty') return undefined;
    if (read.status === 'closed') {
      this.#closed = true;
      return END_OF_STREAM;
    }
    throw new PocketStationError(
      'sidecar.invalid_read',
      `Native sidecar read returned unknown status ${JSON.stringify(read.status)}`,
    );
  }
}

/** Running view of one Session-owned child process. */
export class SidecarConnection {
  public readonly handle: SidecarHandle;
  public readonly messages: SidecarStream;
  readonly #native: NativeRunningSessionHandle;

  /** @internal */
  public constructor(native: NativeRunningSessionHandle, handle: SidecarHandle) {
    this.#native = native;
    this.handle = handle;
    this.messages = new SidecarStream(native, handle.id);
  }

  /** Try one immediate native enqueue. Queue saturation throws a typed error. */
  public async send(message: SidecarMessage): Promise<void> {
    await nativeCall(() =>
      this.#native.sendSidecar(this.handle.id.toString(), message._nativeMessage()),
    );
  }

  /** Read native process state and queue counters. */
  public async snapshot(): Promise<SidecarSnapshot> {
    return new SidecarSnapshot(
      await nativeCall(() =>
        this.#native.sidecarSnapshot(this.handle.id.toString()),
      ),
    );
  }

  /** @internal */
  public _close(): void {
    this.messages._close();
  }
}

function requireText(name: string, value: string): void {
  if (value.length === 0) throw new TypeError(`${name} must not be empty`);
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function requireUnsignedBigInt(name: string, value: bigint): void {
  if (typeof value !== 'bigint' || value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`${name} must be an unsigned 64-bit bigint`);
  }
}

function requirePositiveBigInt(name: string, value: bigint): void {
  requireUnsignedBigInt(name, value);
  if (value === 0n) throw new RangeError(`${name} must be non-zero`);
}

function validateTimeout(timeoutMs: number, requireWait: boolean): void {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < (requireWait ? 1 : 0) ||
    timeoutMs > 1_000
  ) {
    throw new RangeError(
      requireWait
        ? 'timeoutMs must be an integer between 1 and 1000'
        : 'timeoutMs must be an integer between 0 and 1000',
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new StreamAbortError(signal.reason);
}
