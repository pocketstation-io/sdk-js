import { Buffer } from 'node:buffer';

import { PocketStationError } from '../errors.js';
import { PortSpec, SignalSpec } from './graph.js';
import { defineSource, type SourceEmission } from './provider.js';
import type { Session, SourceOutput } from './session.js';

const OUTPUT_PORT = 'events';
const MAXIMUM_CAPACITY_EVENTS = 65_536;
const MAXIMUM_EVENT_BYTES_LIMIT = 1_048_576;
const SOURCE_NEXT_DEADLINE_MS = 30_000;
const MAXIMUM_TIMESTAMP_NS = (1n << 64n) - 1n;

interface QueuedEvent {
  readonly payload: Uint8Array;
  readonly timestampNs: bigint;
}

interface PendingRead {
  readonly resolve: (value: SourceEmission | undefined) => void;
  readonly signal: AbortSignal;
  readonly abort: () => void;
}

/** Current finite capacity and delivery counters for one EventInput. */
export interface EventInputObservations {
  /** Maximum number of events retained before Core accepts them. */
  readonly capacityEvents: number;
  /** Events currently waiting for the Source worker. */
  readonly depthEvents: number;
  /** Events accepted from the application. */
  readonly acceptedTotal: bigint;
  /** Events rejected because the bounded input was full. */
  readonly fullTotal: bigint;
  /** Whether this input permanently stopped accepting events. */
  readonly closed: boolean;
}

/** Construction settings for application-owned JSON event ingress. */
export interface EventInputOptions {
  /** Typed signal emitted by this input. Defaults to a JSON event with role `name`. */
  readonly signal?: SignalSpec;
  /** Maximum retained events. Defaults to 256; maximum 65,536. */
  readonly capacityEvents?: number;
  /** Maximum UTF-8 bytes in one canonical JSON event. Defaults to 16,384. */
  readonly maximumEventBytes?: number;
}

/** Timestamp options for one non-blocking event write. */
export interface EventInputWriteOptions {
  /** Source timestamp in monotonic nanoseconds. Defaults to the Node monotonic clock. */
  readonly timestampNs?: bigint;
}

/** Base failure for bounded typed-event ingress. */
export class EventInputError extends PocketStationError {
  public constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.name = 'EventInputError';
  }
}

/** The bounded EventInput has no free capacity. */
export class EventInputFullError extends EventInputError {
  public constructor(message = 'event input is full') {
    super('event_input.full', message);
    this.name = 'EventInputFullError';
  }
}

/** The EventInput no longer accepts writes. */
export class EventInputClosedError extends EventInputError {
  public constructor(message = 'event input is closed') {
    super('event_input.closed', message);
    this.name = 'EventInputClosedError';
  }
}

/**
 * Push application-owned JSON events into one normal source-aware Session path.
 *
 * The application thread owns serialization and the bounded pre-Core queue.
 * Core owns routing, source identity, sequence, timing translation, and
 * downstream backpressure after the Source worker accepts an event.
 */
export class EventInput implements AsyncDisposable {
  public readonly name: string;
  public readonly signal: SignalSpec;
  public readonly capacityEvents: number;
  public readonly maximumEventBytes: number;
  public readonly output: SourceOutput;

  readonly #queue: QueuedEvent[] = [];
  #pendingRead: PendingRead | undefined;
  #acceptedTotal = 0n;
  #fullTotal = 0n;
  #closed = false;

  /** Create directly or through `Session.eventInput()`. */
  public constructor(
    session: Session,
    name: string,
    options: EventInputOptions = {},
  ) {
    this.name = validateName(name);
    this.signal = options.signal ?? SignalSpec.event('json', { role: name });
    this.capacityEvents = options.capacityEvents ?? 256;
    this.maximumEventBytes = options.maximumEventBytes ?? 16_384;
    requireIntegerRange(
      'capacityEvents',
      this.capacityEvents,
      1,
      MAXIMUM_CAPACITY_EVENTS,
    );
    requireIntegerRange(
      'maximumEventBytes',
      this.maximumEventBytes,
      1,
      MAXIMUM_EVENT_BYTES_LIMIT,
    );

    const source = defineSource({
      id: sourceTypeId(this.name),
      outputs: [
        PortSpec.output(OUTPUT_PORT, this.signal, { multiplicity: 'many' }),
      ],
      deadlineMs: SOURCE_NEXT_DEADLINE_MS,
      create: () => ({
        next: ({ signal }) => this.#next(signal),
        close: () => this.close(),
      }),
    });
    this.output = session.source(source).output(OUTPUT_PORT);
  }

  /** Serialize and enqueue one JSON object without waiting. */
  public tryWrite(
    event: Readonly<Record<string, unknown>>,
    options: EventInputWriteOptions = {},
  ): void {
    if (this.#closed) throw new EventInputClosedError();
    const payload = canonicalJsonBytes(event);
    if (payload.byteLength > this.maximumEventBytes) {
      throw new RangeError(
        `event is ${payload.byteLength} bytes; maximum is ${this.maximumEventBytes}`,
      );
    }
    const timestampNs = options.timestampNs ?? process.hrtime.bigint();
    if (timestampNs < 0n || timestampNs > MAXIMUM_TIMESTAMP_NS) {
      throw new RangeError('timestampNs must be an unsigned 64-bit integer');
    }
    const queued = Object.freeze({ payload, timestampNs });
    const pending = this.#pendingRead;
    if (pending !== undefined) {
      this.#pendingRead = undefined;
      pending.signal.removeEventListener('abort', pending.abort);
      this.#acceptedTotal += 1n;
      pending.resolve(emission(queued));
      return;
    }
    if (this.#queue.length >= this.capacityEvents) {
      this.#fullTotal += 1n;
      throw new EventInputFullError();
    }
    this.#queue.push(queued);
    this.#acceptedTotal += 1n;
  }

  /** Stop accepting writes after every already accepted event is delivered. */
  public async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#queue.length !== 0) return;
    this.#resolvePending(undefined);
  }

  /** Current queue state and cumulative acceptance/rejection counters. */
  public observations(): EventInputObservations {
    return Object.freeze({
      capacityEvents: this.capacityEvents,
      depthEvents: this.#queue.length,
      acceptedTotal: this.#acceptedTotal,
      fullTotal: this.#fullTotal,
      closed: this.#closed,
    });
  }

  /** Close this input when leaving an `await using` scope. */
  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async #next(signal: AbortSignal): Promise<SourceEmission | undefined> {
    const value = this.#queue.shift();
    if (value !== undefined) return emission(value);
    if (this.#closed || signal.aborted) return undefined;
    if (this.#pendingRead !== undefined) {
      throw new Error('EventInput Source already has one pending read');
    }
    return await new Promise<SourceEmission | undefined>((resolve) => {
      const abort = (): void => {
        if (this.#pendingRead?.resolve !== resolve) return;
        this.#pendingRead = undefined;
        resolve(undefined);
      };
      this.#pendingRead = { resolve, signal, abort };
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  #resolvePending(value: SourceEmission | undefined): void {
    const pending = this.#pendingRead;
    if (pending === undefined) return;
    this.#pendingRead = undefined;
    pending.signal.removeEventListener('abort', pending.abort);
    pending.resolve(value);
  }
}

function emission(value: QueuedEvent): SourceEmission {
  return Object.freeze({
    output: OUTPUT_PORT,
    data: value.payload,
    sourceTimestampNs: value.timestampNs,
    observedTimestampNs: value.timestampNs,
  });
}

function validateName(name: string): string {
  if (name.trim().length === 0) throw new RangeError('name must not be empty');
  sourceTypeId(name);
  return name;
}

function sourceTypeId(name: string): string {
  const normalized = name.trim().toLowerCase().replaceAll('_', '-').split(/\s+/u).join('-');
  if (!/^[a-z0-9-]+$/u.test(normalized)) {
    throw new RangeError(
      "name must contain only letters, numbers, spaces, '_' or '-'",
    );
  }
  return `io.pocketstation.source.event-input.${normalized}.v1`;
}

function requireIntegerRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
}

function canonicalJsonBytes(event: Readonly<Record<string, unknown>>): Uint8Array {
  if (event === null || Array.isArray(event) || typeof event !== 'object') {
    throw new TypeError('event must be a JSON object');
  }
  const normalized = normalizeJson(event, new Set<object>());
  return Buffer.from(JSON.stringify(normalized), 'utf8');
}

function normalizeJson(value: unknown, ancestors: Set<object>): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('event numbers must be finite');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('event contains a value that JSON cannot encode');
  }
  if (ancestors.has(value)) throw new TypeError('event must not contain cycles');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeJson(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('event objects must be plain JSON records');
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          normalizeJson((value as Record<string, unknown>)[key], ancestors),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}
