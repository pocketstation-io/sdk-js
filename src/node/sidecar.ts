import {
  StreamInUseError,
  StreamModeError,
  SidecarProtocolError,
  nativeCall,
} from './errors.js';
import {
  RuntimeSessionId,
  SidecarId,
  StreamId,
} from './identity.js';
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
export const SidecarMessageKind = Object.freeze({
  SIGNAL: 'signal',
  READY: 'ready',
  ERROR: 'error',
  CANCEL: 'cancel',
  CLOSE: 'close',
  HELLO: 'hello',
  MANIFEST: 'manifest',
  CONFIGURE: 'configure',
  OBSERVATION: 'observation',
  CLOSED: 'closed',
} as const);

export type SidecarMessageKind =
  (typeof SidecarMessageKind)[keyof typeof SidecarMessageKind];

/** Session-owned child process state. */
export const SidecarState = Object.freeze({
  SPAWNED: 'spawned',
  HELLO: 'hello',
  MANIFEST: 'manifest',
  CONFIGURE: 'configure',
  READY: 'ready',
  RUNNING: 'running',
  CANCELLING: 'cancelling',
  CLOSING: 'closing',
  CLOSED: 'closed',
  REAPED: 'reaped',
  FAILED: 'failed',
} as const);

export type SidecarState =
  (typeof SidecarState)[keyof typeof SidecarState];

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

/** Construction options for finite PKSS field and payload bounds. */
export interface SidecarProtocolLimitsOptions {
  readonly maxSignalIdBytes?: number;
  readonly maxRoleBytes?: number;
  readonly maxSchemaBytes?: number;
  readonly maxPayloadBytes?: number;
}

/** Maximum encoded field and payload sizes, measured in bytes. */
export class SidecarProtocolLimits {
  public readonly maxSignalIdBytes: number;
  public readonly maxRoleBytes: number;
  public readonly maxSchemaBytes: number;
  public readonly maxPayloadBytes: number;

  public constructor(options: SidecarProtocolLimitsOptions = {}) {
    this.maxSignalIdBytes = options.maxSignalIdBytes ?? 256;
    this.maxRoleBytes = options.maxRoleBytes ?? 256;
    this.maxSchemaBytes = options.maxSchemaBytes ?? 1_024;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 1_048_576;
    for (const [name, value] of [
      ['maxSignalIdBytes', this.maxSignalIdBytes],
      ['maxRoleBytes', this.maxRoleBytes],
      ['maxSchemaBytes', this.maxSchemaBytes],
      ['maxPayloadBytes', this.maxPayloadBytes],
    ] as const) {
      requirePositiveInteger(name, value);
    }
    Object.freeze(this);
  }
}

/** Construction options for finite sidecar lifecycle deadlines. */
export interface SidecarDeadlinesOptions {
  readonly readyS?: number;
  readonly processingS?: number;
  readonly shutdownS?: number;
  /** @deprecated Use `readyS`. */
  readonly readyMs?: number;
  /** @deprecated Use `processingS`. */
  readonly processingMs?: number;
  /** @deprecated Use `shutdownS`. */
  readonly shutdownMs?: number;
}

/** Startup, message-processing, and shutdown deadlines in seconds. */
export class SidecarDeadlines {
  public readonly readyS: number;
  public readonly processingS: number;
  public readonly shutdownS: number;

  public constructor(options: SidecarDeadlinesOptions = {}) {
    this.readyS = resolveDeadlineSeconds('ready', options.readyS, options.readyMs, 5);
    this.processingS = resolveDeadlineSeconds(
      'processing',
      options.processingS,
      options.processingMs,
      5,
    );
    this.shutdownS = resolveDeadlineSeconds(
      'shutdown',
      options.shutdownS,
      options.shutdownMs,
      2,
    );
    Object.freeze(this);
  }

  /** Ready deadline converted to the native millisecond unit. */
  public get readyMs(): number {
    return secondsToMilliseconds('readyS', this.readyS);
  }

  /** Processing deadline converted to the native millisecond unit. */
  public get processingMs(): number {
    return secondsToMilliseconds('processingS', this.processingS);
  }

  /** Shutdown deadline converted to the native millisecond unit. */
  public get shutdownMs(): number {
    return secondsToMilliseconds('shutdownS', this.shutdownS);
  }
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
  readonly protocolLimits?: SidecarProtocolLimits | SidecarProtocolLimitsOptions;
  /** Finite lifecycle deadlines. */
  readonly deadlines?: SidecarDeadlines | SidecarDeadlinesOptions;
}

/** One process started, supervised, stopped, and reaped by a Session. */
export class SidecarProcessSpec {
  readonly #native: NativeSidecarProcessSpec;
  readonly #configuration: Uint8Array;
  public readonly id: SidecarId;
  public readonly program: string;
  public readonly arguments: readonly string[];
  public readonly dataCapacityMessages: number;
  public readonly protocolLimits: SidecarProtocolLimits;
  public readonly deadlines: SidecarDeadlines;

  public constructor(options: SidecarProcessOptions) {
    requirePositiveBigInt('id', options.id);
    requireText('program', options.program);
    this.id = SidecarId(options.id);
    this.program = options.program;
    this.arguments = Object.freeze([...(options.arguments ?? [])]);
    this.#configuration = Uint8Array.from(options.configuration ?? []);
    this.dataCapacityMessages = options.dataCapacityMessages ?? 64;
    requirePositiveInteger('dataCapacityMessages', this.dataCapacityMessages);
    this.protocolLimits = options.protocolLimits instanceof SidecarProtocolLimits
      ? options.protocolLimits
      : new SidecarProtocolLimits(options.protocolLimits);
    this.deadlines = options.deadlines instanceof SidecarDeadlines
      ? options.deadlines
      : new SidecarDeadlines(options.deadlines);
    this.#native = {
      id: this.id.toString(),
      program: this.program,
      arguments: [...this.arguments],
      configuration: Buffer.from(this.#configuration),
      dataCapacityMessages: this.dataCapacityMessages,
      maxSignalIdBytes: this.protocolLimits.maxSignalIdBytes,
      maxRoleBytes: this.protocolLimits.maxRoleBytes,
      maxSchemaBytes: this.protocolLimits.maxSchemaBytes,
      maxPayloadBytes: this.protocolLimits.maxPayloadBytes,
      readyTimeoutMs: this.deadlines.readyMs,
      processingTimeoutMs: this.deadlines.processingMs,
      shutdownTimeoutMs: this.deadlines.shutdownMs,
    };
    Object.freeze(this);
  }

  /** Copied bytes sent in the PKSS configure message. */
  public get configuration(): Uint8Array {
    return Uint8Array.from(this.#configuration);
  }

  /** @internal */
  public _nativeSpec(): NativeSidecarProcessSpec {
    return {
      ...this.#native,
      arguments: [...this.#native.arguments],
      configuration: Buffer.from(this.#native.configuration),
    };
  }
}

/** @deprecated Use `SidecarProcessSpec`. */
export class SidecarProcess extends SidecarProcessSpec {}

/** Session-scoped reference returned when a child process is registered. */
export class SidecarHandle {
  /** Process identity declared by the application. */
  public readonly id: SidecarId;
  /** Native Session that owns this process. */
  public readonly sessionId: RuntimeSessionId;

  /** @internal */
  public constructor(id: SidecarId, sessionId: RuntimeSessionId) {
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
  public readonly streamId: StreamId;
  public readonly sequenceNumber: bigint;
  public readonly timestampNs: bigint;
  public readonly signalId: string;
  public readonly payload: Buffer;
  public readonly terminal: boolean;
  public readonly role: string | undefined;
  public readonly schema: string | undefined;

  private constructor(native: NativeSidecarMessage) {
    this.kind = native.kind as SidecarMessageKind;
    this.streamId = StreamId(BigInt(native.streamId));
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
      streamId: StreamId(options.streamId).toString(),
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
  public readonly sidecarId: SidecarId;
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
    this.sidecarId = SidecarId(BigInt(native.sidecarId));
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
  readonly #sidecarId: SidecarId;
  #activeReader = false;
  #readerMode: 'sidecar_read' | 'sidecar' | undefined;
  #closed = false;

  /** @internal */
  public constructor(native: NativeRunningSessionHandle, sidecarId: SidecarId) {
    this.#native = native;
    this.#sidecarId = sidecarId;
  }

  /** Whether this sidecar stream has reached a terminal state. */
  public get isClosed(): boolean {
    return this.#closed;
  }

  /** Permanently selected consumption mode, once reading begins. */
  public get readerMode(): 'sidecar_read' | 'sidecar' | undefined {
    return this.#readerMode;
  }

  /** Read immediately with distinct empty and end-of-stream outcomes. */
  public async poll(
    options: Omit<StreamReadOptions, 'timeoutMs'> = {},
  ): Promise<SidecarReadResult> {
    const release = this.#claim('sidecar_read');
    try {
      return await this.#readOnce({ ...options, timeoutMs: 0 });
    } finally {
      release();
    }
  }

  /** Read one message, return `undefined` at timeout, or return `END_OF_STREAM`. */
  public async read(options: StreamReadOptions = {}): Promise<SidecarReadResult> {
    const release = this.#claim('sidecar_read');
    try {
      return await this.#readOnce(options);
    } finally {
      release();
    }
  }

  /** Read messages until the Session closes or the reader is aborted. */
  public async *messages(
    options: StreamReadOptions = {},
  ): AsyncGenerator<SidecarMessage> {
    const timeoutMs = options.timeoutMs ?? 100;
    validateTimeout(timeoutMs, true);
    const release = this.#claim('sidecar');
    try {
      while (true) {
        const result = await this.#readOnce(options);
        if (result instanceof EndOfStream) return;
        if (result !== undefined) yield result;
      }
    } finally {
      release();
    }
  }

  public [Symbol.asyncIterator](): AsyncGenerator<SidecarMessage> {
    return this.messages();
  }

  /** @internal */
  public _close(): void {
    this.#closed = true;
  }

  #claim(mode: 'sidecar_read' | 'sidecar'): () => void {
    if (this.#readerMode !== undefined && this.#readerMode !== mode) {
      throw new StreamModeError(this.#readerMode, mode);
    }
    if (this.#activeReader) {
      throw new StreamInUseError(mode);
    }
    this.#readerMode = mode;
    this.#activeReader = true;
    return () => {
      this.#activeReader = false;
    };
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
        throw new SidecarProtocolError(
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
    throw new SidecarProtocolError(
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

function resolveDeadlineSeconds(
  name: string,
  seconds: number | undefined,
  milliseconds: number | undefined,
  defaultSeconds: number,
): number {
  if (seconds !== undefined && milliseconds !== undefined) {
    throw new TypeError(`${name} deadline cannot specify both seconds and milliseconds`);
  }
  const value = seconds ?? (milliseconds === undefined ? defaultSeconds : milliseconds / 1_000);
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} deadline must be a finite number greater than zero`);
  }
  secondsToMilliseconds(`${name}S`, value);
  return value;
}

function secondsToMilliseconds(name: string, seconds: number): number {
  const milliseconds = Math.max(1, Math.round(seconds * 1_000));
  if (!Number.isSafeInteger(milliseconds)) {
    throw new RangeError(`${name} is too large to represent in milliseconds`);
  }
  return milliseconds;
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
