import type { Configuration, PortSpec } from './graph.js';
import { EndpointDefinition, Operator } from './graph.js';
import { _envelopeFromNative, type SignalEnvelope } from './signals.js';
import {
  _audioFrameFromNative,
  type ConnectorAudioFrame,
} from './connector.js';
import type {
  NativeConfigurationEntry,
  NativeProviderCall,
  NativeProviderEmission,
  NativeProviderResult,
  NativeSessionHandle,
  NativeSourceContext,
} from './native.js';

/** String configuration supplied when a Source is declared. */
export type SourceConfiguration = Readonly<Record<string, string>>;

/** Context supplied while one Source instance is running. */
export interface SourceContext {
  /** Stops when the owning Session is cancelled. */
  readonly signal: AbortSignal;
}

/** Source and stream identities assigned by Core before production begins. */
export interface SourcePrepareContext extends SourceContext {
  readonly sourceTypeId: string;
  readonly sessionId?: bigint;
  readonly sourceId?: bigint;
  readonly outputs: readonly {
    readonly name: string;
    readonly streamId: bigint;
  }[];
}

/** One typed value emitted by an application-owned Source. */
export interface SourceEmission {
  /** Declared output name. */
  readonly output: string;
  /** UTF-8 text or opaque bytes. PCM belongs in `Session.audioInput()`. */
  readonly data: string | Uint8Array;
  readonly sourceTimestampNs?: bigint;
  readonly observedTimestampNs?: bigint;
  readonly durationNs?: bigint;
  readonly sourceGeneration?: number;
  readonly discontinuityEpoch?: bigint;
  readonly policyEpoch?: bigint;
  readonly clockId?: number;
  readonly terminal?: boolean;
}

/** State created for one declared Source instance. */
export interface SourceDriver {
  prepare?(context: SourcePrepareContext): void | Promise<void>;
  next(context: SourceContext): SourceEmission | undefined | Promise<SourceEmission | undefined>;
  close?(): void | Promise<void>;
}

/** Defines one reusable Source implementation. */
export interface SourceFactoryOptions {
  /** Portable reverse-domain identity ending in `.source.<name>.vN`. */
  readonly id: string;
  /** Typed non-PCM outputs produced by each instance. */
  readonly outputs: readonly PortSpec[];
  /** Create independent state for one Session declaration. */
  readonly create: (configuration: SourceConfiguration) => SourceDriver;
  /** Reject invalid configuration before any Source resource starts. */
  readonly validate?: (configuration: SourceConfiguration) => void | Promise<void>;
  /** Additive declaration revision. Defaults to one. */
  readonly revision?: number;
  /** Implementation generation. Defaults to one. */
  readonly generation?: number;
  /** Maximum duration of each JavaScript lifecycle call. Defaults to 5,000 ms. */
  readonly deadlineMs?: number;
}

interface ActiveSource {
  readonly driver: SourceDriver;
  readonly controller: AbortController;
}

/** Reusable registration produced by `defineSource()`. */
export class SourceFactory {
  public readonly id: string;
  public readonly outputs: readonly PortSpec[];
  public readonly revision: number;
  public readonly generation: number;
  public readonly deadlineMs: number;
  readonly #options: SourceFactoryOptions;
  readonly #instances = new Map<string, ActiveSource>();
  #sessionId: bigint | undefined;

  public constructor(options: SourceFactoryOptions) {
    this.#options = options;
    this.id = options.id;
    this.outputs = Object.freeze([...options.outputs]);
    this.revision = options.revision ?? 1;
    this.generation = options.generation ?? 1;
    this.deadlineMs = options.deadlineMs ?? 5_000;
    requirePositiveInteger('revision', this.revision);
    requirePositiveInteger('generation', this.generation);
    if (!Number.isInteger(this.deadlineMs) || this.deadlineMs < 1 || this.deadlineMs > 60_000) {
      throw new RangeError('deadlineMs must be an integer from 1 through 60000');
    }
    if (this.outputs.length === 0) {
      throw new TypeError('A Source needs at least one output');
    }
    if (this.outputs.some((output) => output.direction !== 'output' || output.signal.isAudio)) {
      throw new TypeError(
        'JavaScript Sources emit typed non-PCM signals; use Session.audioInput() for application-owned PCM',
      );
    }
  }

  /** @internal */
  public _bind(sessionId: bigint): void {
    if (this.#sessionId !== undefined && this.#sessionId !== sessionId) {
      throw new TypeError('A Source factory cannot be shared by different Sessions');
    }
    this.#sessionId = sessionId;
  }

  /** @internal */
  public _register(native: NativeSessionHandle): void {
    native.registerSource(
      this.id,
      this.revision,
      this.generation,
      this.outputs.map((output) => output._nativeHandle()),
      this._dispatch,
      this.deadlineMs,
    );
  }

  /** @internal */
  public _abort(reason?: unknown): void {
    for (const active of this.#instances.values()) {
      if (!active.controller.signal.aborted) active.controller.abort(reason);
    }
  }

  /** @internal */
  public readonly _dispatch = async (
    request: NativeProviderCall,
  ): Promise<NativeProviderResult> => {
    const configuration = configurationFromNative(request.configuration);
    switch (request.operation) {
      case 'source.validate':
        await this.#options.validate?.(configuration);
        return {};
      case 'source.create': {
        const instanceId = required(request.instanceId, 'instanceId');
        if (this.#instances.has(instanceId)) throw new Error('Source instance already exists');
        const driver = this.#options.create(configuration);
        this.#instances.set(instanceId, { driver, controller: new AbortController() });
        return {};
      }
      case 'source.prepare': {
        const active = this.#active(request);
        await active.driver.prepare?.(sourceContext(request.sourceContext, active.controller.signal));
        return {};
      }
      case 'source.next': {
        const active = this.#active(request);
        if (request.cancelled === true && !active.controller.signal.aborted) {
          active.controller.abort();
        }
        const emission = await active.driver.next({ signal: active.controller.signal });
        return emission === undefined ? {} : { emission: emissionToNative(emission) };
      }
      case 'source.close': {
        const instanceId = required(request.instanceId, 'instanceId');
        const active = this.#instances.get(instanceId);
        if (active === undefined) return {};
        this.#instances.delete(instanceId);
        if (!active.controller.signal.aborted) active.controller.abort();
        await active.driver.close?.();
        return {};
      }
      default:
        throw new Error(`Unsupported Source operation: ${request.operation}`);
    }
  };

  #active(request: NativeProviderCall): ActiveSource {
    const instanceId = required(request.instanceId, 'instanceId');
    const active = this.#instances.get(instanceId);
    if (active === undefined) throw new Error('Source instance is no longer active');
    return active;
  }
}

/** Define a reusable Source with a normal object or class as its driver. */
export function defineSource(options: SourceFactoryOptions): SourceFactory {
  return new SourceFactory(options);
}

/** Context supplied to one running Operator. */
export interface OperatorContext {
  /** Stops when the owning Session is cancelled or the Operator is stopped. */
  readonly signal: AbortSignal;
}

/** One value emitted by an application-owned Operator. */
export interface OperatorEmission {
  /** Declared output name. */
  readonly output: string;
  /** Text, opaque bytes, or one complete interleaved float32 PCM frame. */
  readonly data: string | Uint8Array | Float32Array;
}

/** State created for one configured Operator instance. */
export interface OperatorNode {
  prepare?(context: OperatorContext): void | Promise<void>;
  process(
    input: SignalEnvelope,
    inputPort: string,
    context: OperatorContext,
  ): readonly OperatorEmission[] | Promise<readonly OperatorEmission[]>;
  flush?(context: OperatorContext): readonly OperatorEmission[] | Promise<readonly OperatorEmission[]>;
  cancel?(context: OperatorContext): void | Promise<void>;
  close?(): void | Promise<void>;
}

/** Defines one reusable off-realtime Operator implementation. */
export interface OperatorFactoryOptions {
  readonly id: string;
  readonly inputs: readonly PortSpec[];
  readonly outputs: readonly PortSpec[];
  readonly create: (configuration: SourceConfiguration) => OperatorNode;
  readonly validate?: (configuration: SourceConfiguration) => void | Promise<void>;
  readonly revision?: number;
  readonly generation?: number;
  /** Maximum signals retained by each Core Operator queue. Defaults to eight. */
  readonly queueCapacity?: number;
  /** Maximum duration of each JavaScript lifecycle call. Defaults to 5,000 ms. */
  readonly deadlineMs?: number;
}

interface ActiveOperator {
  readonly node: OperatorNode;
  readonly controller: AbortController;
}

/** Reusable registration produced by `defineOperator()`. */
export class OperatorFactory {
  public readonly id: string;
  public readonly inputs: readonly PortSpec[];
  public readonly outputs: readonly PortSpec[];
  public readonly revision: number;
  public readonly generation: number;
  public readonly queueCapacity: number;
  public readonly deadlineMs: number;
  readonly #options: OperatorFactoryOptions;
  readonly #instances = new Map<string, ActiveOperator>();
  #sessionId: bigint | undefined;

  public constructor(options: OperatorFactoryOptions) {
    this.#options = options;
    this.id = options.id;
    this.inputs = Object.freeze([...options.inputs]);
    this.outputs = Object.freeze([...options.outputs]);
    this.revision = options.revision ?? 1;
    this.generation = options.generation ?? 1;
    this.queueCapacity = options.queueCapacity ?? 8;
    this.deadlineMs = options.deadlineMs ?? 5_000;
    requirePositiveInteger('revision', this.revision);
    requirePositiveInteger('generation', this.generation);
    requirePositiveInteger('queueCapacity', this.queueCapacity);
    if (this.queueCapacity > 1024) throw new RangeError('queueCapacity cannot exceed 1024');
    if (!Number.isInteger(this.deadlineMs) || this.deadlineMs < 1 || this.deadlineMs > 60_000) {
      throw new RangeError('deadlineMs must be an integer from 1 through 60000');
    }
    if (this.inputs.length === 0 || this.outputs.length === 0) {
      throw new TypeError('An Operator needs at least one input and one output');
    }
    if (this.inputs.some((port) => port.direction !== 'input')) {
      throw new TypeError('Operator inputs must be input PortSpecs');
    }
    if (this.outputs.some((port) => port.direction !== 'output')) {
      throw new TypeError('Operator outputs must be output PortSpecs');
    }
  }

  /** Create a Session declaration for this implementation. */
  public configured(configuration: Configuration = {}): Operator {
    return new Operator(this.id, configuration);
  }

  /** @internal */
  public _bind(sessionId: bigint): void {
    if (this.#sessionId !== undefined && this.#sessionId !== sessionId) {
      throw new TypeError('An Operator factory cannot be shared by different Sessions');
    }
    this.#sessionId = sessionId;
  }

  /** @internal */
  public _register(native: NativeSessionHandle): void {
    native.registerOperator(
      this.id,
      this.revision,
      this.generation,
      this.inputs.map((port) => port._nativeHandle()),
      this.outputs.map((port) => port._nativeHandle()),
      this.queueCapacity,
      this._dispatch,
      this.deadlineMs,
    );
  }

  /** @internal */
  public _abort(reason?: unknown): void {
    for (const active of this.#instances.values()) {
      if (!active.controller.signal.aborted) active.controller.abort(reason);
    }
  }

  /** @internal */
  public readonly _dispatch = async (request: NativeProviderCall): Promise<NativeProviderResult> => {
    const configuration = configurationFromNative(request.configuration);
    switch (request.operation) {
      case 'operator.validate':
        await this.#options.validate?.(configuration);
        return {};
      case 'operator.create': {
        const instanceId = required(request.instanceId, 'instanceId');
        if (this.#instances.has(instanceId)) throw new Error('Operator instance already exists');
        this.#instances.set(instanceId, {
          node: this.#options.create(configuration),
          controller: new AbortController(),
        });
        return {};
      }
      case 'operator.prepare': {
        const active = this.#active(request);
        await active.node.prepare?.({ signal: active.controller.signal });
        return {};
      }
      case 'operator.process': {
        const active = this.#active(request);
        if (request.signal == null) throw new Error('Operator input is unavailable');
        const emissions = await active.node.process(
          _envelopeFromNative(request.signal),
          request.inputPort ?? 'input',
          { signal: active.controller.signal },
        );
        return { emissions: emissions.map(operatorEmissionToNative) };
      }
      case 'operator.flush': {
        const active = this.#active(request);
        const emissions = (await active.node.flush?.({ signal: active.controller.signal })) ?? [];
        return { emissions: emissions.map(operatorEmissionToNative) };
      }
      case 'operator.cancel': {
        const active = this.#active(request);
        if (!active.controller.signal.aborted) active.controller.abort();
        await active.node.cancel?.({ signal: active.controller.signal });
        return {};
      }
      case 'operator.close': {
        const instanceId = required(request.instanceId, 'instanceId');
        const active = this.#instances.get(instanceId);
        if (active === undefined) return {};
        this.#instances.delete(instanceId);
        if (!active.controller.signal.aborted) active.controller.abort();
        await active.node.close?.();
        return {};
      }
      default:
        throw new Error(`Unsupported Operator operation: ${request.operation}`);
    }
  };

  #active(request: NativeProviderCall): ActiveOperator {
    const instanceId = required(request.instanceId, 'instanceId');
    const active = this.#instances.get(instanceId);
    if (active === undefined) throw new Error('Operator instance is no longer active');
    return active;
  }
}

/** Define a reusable off-realtime Operator with a normal object or class. */
export function defineOperator(options: OperatorFactoryOptions): OperatorFactory {
  return new OperatorFactory(options);
}

/** Context supplied to an application-owned Endpoint. */
export interface EndpointContext {
  /** Stops when the owning Session is cancelled or this Endpoint instance is aborted. */
  readonly signal: AbortSignal;
}

/** Audio delivered to one named Endpoint input. */
export interface EndpointAudioItem {
  readonly kind: 'audio';
  readonly input: string;
  readonly endpointId: bigint;
  readonly routeId: bigint;
  readonly frame: ConnectorAudioFrame;
}

/** Typed data delivered to one named Endpoint input. */
export interface EndpointSignalItem {
  readonly kind: 'signal';
  readonly input: string;
  readonly endpointId: bigint;
  readonly routeId: bigint;
  readonly signal: SignalEnvelope;
}

/** One value delivered to an application-owned Endpoint. */
export type EndpointItem = EndpointAudioItem | EndpointSignalItem;

/** Function accepted by the concise Endpoint form. */
export type EndpointReceive = (
  item: EndpointItem,
  context: EndpointContext,
) => void | Promise<void>;

/** State created for one prepared Endpoint instance. */
export interface EndpointNode {
  prepare?(context: EndpointContext): void | Promise<void>;
  start?(context: EndpointContext): void | Promise<void>;
  receive(item: EndpointItem, context: EndpointContext): void | Promise<void>;
  stop?(mode: 'drain' | 'abort', context: EndpointContext): void | Promise<void>;
  close?(): void | Promise<void>;
}

/** Settings shared by class-based and function-based Endpoint implementations. */
export interface EndpointProviderOptions {
  /** Stable reverse-domain identity for this Endpoint implementation. */
  readonly id: string;
  /** Stable node type used by Core's graph compiler. */
  readonly nodeType?: string;
  /** Named typed inputs accepted by this Endpoint. */
  readonly inputs: readonly PortSpec[];
  /** Maximum duration of each JavaScript lifecycle call. Defaults to 5,000 ms. */
  readonly deadlineMs?: number;
}

/** Defines one application-owned Endpoint implementation. */
export interface EndpointFactoryOptions extends EndpointProviderOptions {
  /** Create independent state for the inputs Core starts together. */
  readonly create: (configuration: SourceConfiguration) => EndpointNode;
  /** Reject invalid configuration before any Endpoint resource starts. */
  readonly validate?: (configuration: SourceConfiguration) => void | Promise<void>;
}

interface ActiveEndpoint {
  readonly node: EndpointNode;
  readonly controller: AbortController;
  state: 'new' | 'preparing' | 'prepared' | 'running' | 'stopping' | 'closed';
}

/**
 * Reusable registration for a destination with named audio or signal inputs.
 *
 * Use `Connector` when a destination only needs source-aware PCM. Use an
 * Endpoint when the destination has several typed inputs or consumes signals.
 */
export class EndpointFactory {
  public readonly id: string;
  public readonly nodeType: string;
  public readonly inputs: readonly PortSpec[];
  public readonly deadlineMs: number;
  readonly #options: EndpointFactoryOptions;
  readonly #instances = new Map<string, ActiveEndpoint>();
  #sessionId: bigint | undefined;

  public constructor(options: EndpointFactoryOptions) {
    this.#options = options;
    this.id = options.id;
    this.nodeType = options.nodeType ?? `${options.id}.node`;
    this.inputs = Object.freeze([...options.inputs]);
    this.deadlineMs = options.deadlineMs ?? 5_000;
    if (this.id.trim().length === 0 || this.nodeType.trim().length === 0) {
      throw new TypeError('Endpoint id and nodeType cannot be empty');
    }
    if (this.inputs.length === 0 || this.inputs.some((input) => input.direction !== 'input')) {
      throw new TypeError('An Endpoint needs at least one input PortSpec');
    }
    if (!Number.isInteger(this.deadlineMs) || this.deadlineMs < 1 || this.deadlineMs > 60_000) {
      throw new RangeError('deadlineMs must be an integer from 1 through 60000');
    }
  }

  /** @internal */
  public _bind(sessionId: bigint): void {
    if (this.#sessionId !== undefined && this.#sessionId !== sessionId) {
      throw new TypeError('An Endpoint factory cannot be shared by different Sessions');
    }
    this.#sessionId = sessionId;
  }

  /** @internal */
  public _register(
    native: NativeSessionHandle,
    registrationId: string,
    configuration: Configuration,
  ): EndpointDefinition {
    native.registerEndpoint(
      registrationId,
      this.nodeType,
      this.inputs.map((input) => input._nativeHandle()),
      this._dispatch,
      this.deadlineMs,
    );
    return new EndpointDefinition(this.nodeType, registrationId, { configuration });
  }

  /** @internal */
  public _abort(reason?: unknown): void {
    for (const active of this.#instances.values()) {
      if (!active.controller.signal.aborted) active.controller.abort(reason);
    }
  }

  /** @internal */
  public readonly _dispatch = async (request: NativeProviderCall): Promise<NativeProviderResult> => {
    const configuration = configurationFromNative(request.configuration);
    switch (request.operation) {
      case 'endpoint.validate':
        await this.#options.validate?.(configuration);
        return {};
      case 'endpoint.create': {
        const instanceId = required(request.instanceId, 'instanceId');
        if (this.#instances.has(instanceId)) throw new Error('Endpoint instance already exists');
        this.#instances.set(instanceId, {
          node: this.#options.create(configuration),
          controller: new AbortController(),
          state: 'new',
        });
        return {};
      }
      case 'endpoint.prepare': {
        const active = this.#active(request);
        if (active.state !== 'new') throw new Error(`Endpoint cannot prepare while ${active.state}`);
        active.state = 'preparing';
        await active.node.prepare?.({ signal: active.controller.signal });
        active.state = 'prepared';
        return {};
      }
      case 'endpoint.start': {
        const active = this.#active(request);
        if (active.state !== 'prepared') throw new Error(`Endpoint cannot start while ${active.state}`);
        await active.node.start?.({ signal: active.controller.signal });
        active.state = 'running';
        return {};
      }
      case 'endpoint.receive': {
        const active = this.#active(request);
        if (active.state !== 'running') {
          throw new Error('Endpoint received data outside its running lifetime');
        }
        await active.node.receive(endpointItem(request), { signal: active.controller.signal });
        return { outcome: 'delivered' };
      }
      case 'endpoint.stop': {
        const active = this.#active(request);
        if (active.state === 'closed' || active.state === 'stopping') return {};
        const mode = request.shutdownMode === 'abort' || active.controller.signal.aborted
          ? 'abort'
          : 'drain';
        active.state = 'stopping';
        if (mode === 'abort' && !active.controller.signal.aborted) active.controller.abort();
        await active.node.stop?.(mode, { signal: active.controller.signal });
        return {};
      }
      case 'endpoint.cancel_preparation': {
        const instanceId = required(request.instanceId, 'instanceId');
        const active = this.#instances.get(instanceId);
        if (active === undefined) return {};
        active.state = 'stopping';
        if (!active.controller.signal.aborted) active.controller.abort();
        try {
          await active.node.stop?.('abort', { signal: active.controller.signal });
        } finally {
          await this.#finish(instanceId, active);
        }
        return {};
      }
      case 'endpoint.close': {
        const instanceId = required(request.instanceId, 'instanceId');
        const active = this.#instances.get(instanceId);
        if (active !== undefined) await this.#finish(instanceId, active);
        return {};
      }
      default:
        throw new Error(`Unsupported Endpoint operation: ${request.operation}`);
    }
  };

  #active(request: NativeProviderCall): ActiveEndpoint {
    const instanceId = required(request.instanceId, 'instanceId');
    const active = this.#instances.get(instanceId);
    if (active === undefined) throw new Error('Endpoint instance is no longer active');
    return active;
  }

  async #finish(instanceId: string, active: ActiveEndpoint): Promise<void> {
    if (active.state === 'closed') return;
    active.state = 'closed';
    if (!active.controller.signal.aborted) active.controller.abort();
    this.#instances.delete(instanceId);
    await active.node.close?.();
  }
}

/** Define an Endpoint with a class/object factory. */
export function defineEndpoint(options: EndpointFactoryOptions): EndpointFactory;
/** Define an Endpoint from one receive function. */
export function defineEndpoint(
  options: EndpointProviderOptions,
  receive: EndpointReceive,
): EndpointFactory;
export function defineEndpoint(
  options: EndpointFactoryOptions | EndpointProviderOptions,
  receive?: EndpointReceive,
): EndpointFactory {
  if ('create' in options) return new EndpointFactory(options);
  if (receive === undefined) throw new TypeError('defineEndpoint needs a receive function');
  return new EndpointFactory({
    ...options,
    create: () => ({ receive }),
  });
}

function endpointItem(request: NativeProviderCall): EndpointItem {
  const common = {
    input: required(request.inputPort, 'inputPort'),
    endpointId: BigInt(required(request.endpointId, 'endpointId')),
    routeId: BigInt(required(request.routeId, 'routeId')),
  };
  if (request.audio != null) {
    return Object.freeze({
      kind: 'audio',
      ...common,
      frame: _audioFrameFromNative(request.audio),
    });
  }
  if (request.signal != null) {
    return Object.freeze({
      kind: 'signal',
      ...common,
      signal: _envelopeFromNative(request.signal),
    });
  }
  throw new Error('Endpoint delivery contains neither audio nor a typed signal');
}

function sourceContext(value: NativeSourceContext | null | undefined, signal: AbortSignal): SourcePrepareContext {
  if (value == null) throw new Error('Source prepare context is unavailable');
  return Object.freeze({
    sourceTypeId: value.sourceTypeId,
    ...(value.sessionId == null ? {} : { sessionId: BigInt(value.sessionId) }),
    ...(value.sourceId == null ? {} : { sourceId: BigInt(value.sourceId) }),
    outputs: Object.freeze(
      value.outputs.map((output) =>
        Object.freeze({ name: output.name, streamId: BigInt(output.streamId) }),
      ),
    ),
    signal,
  });
}

function emissionToNative(value: SourceEmission): NativeProviderEmission {
  const common = {
    output: value.output,
    sourceTimestampNs: value.sourceTimestampNs?.toString(),
    observedTimestampNs: value.observedTimestampNs?.toString(),
    durationNs: value.durationNs?.toString(),
    sourceGeneration: value.sourceGeneration,
    discontinuityEpoch: value.discontinuityEpoch?.toString(),
    policyEpoch: value.policyEpoch?.toString(),
    clockId: value.clockId,
    terminal: value.terminal,
  };
  return typeof value.data === 'string'
    ? { ...common, payloadKind: 'text', text: value.data }
    : { ...common, payloadKind: 'bytes', bytes: Buffer.from(value.data) };
}

function operatorEmissionToNative(value: OperatorEmission): NativeProviderEmission {
  if (typeof value.data === 'string') {
    return { output: value.output, payloadKind: 'text', text: value.data };
  }
  if (value.data instanceof Float32Array) {
    return {
      output: value.output,
      payloadKind: 'audio',
      samplesF32Le: Buffer.from(
        value.data.buffer,
        value.data.byteOffset,
        value.data.byteLength,
      ),
    };
  }
  return { output: value.output, payloadKind: 'bytes', bytes: Buffer.from(value.data) };
}

function configurationFromNative(
  entries: readonly NativeConfigurationEntry[] | null | undefined,
): SourceConfiguration {
  return Object.freeze(
    Object.fromEntries((entries ?? []).map(({ key, value }) => [key, value])),
  );
}

function required(value: string | null | undefined, name: string): string {
  if (value == null || value.length === 0) throw new Error(`${name} is unavailable`);
  return value;
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
