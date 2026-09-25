import type { Configuration, PortSpec } from './graph.js';
import { EndpointDefinition, Operator, SignalSpec } from './graph.js';
import { _envelopeFromNative, type SignalEnvelope } from './signals.js';
import {
  _audioFrameFromNative,
  type ConnectorAudioFrame,
} from './connector.js';
import {
  nativeAddon,
  type NativeConfigurationEntry,
  type NativeEndpointDriverObservations,
  type NativeEndpointInputDescriptor,
  type NativeEndpointItem,
  type NativeOperatorPrepareContext,
  type NativeProviderCall,
  type NativeProviderEmission,
  type NativeProviderResult,
  type NativeSessionHandle,
  type NativeSourceContext,
  type NativeSourceManifestHandle,
} from './native.js';
import { nativeCallSync } from './errors.js';

/** String configuration supplied when a Source is declared. */
export type SourceConfiguration = Readonly<Record<string, string>>;

/** Context supplied while one Source instance is running. */
export interface SourceContext {
  /** Stops when the owning Session is cancelled. */
  readonly signal: AbortSignal;
}

/** Source and stream identities assigned by Core before production begins. */
export interface SourceDriverPrepareContext extends SourceContext {
  readonly sourceTypeId: string;
  readonly sessionId?: bigint;
  readonly sourceId?: bigint;
  readonly outputs: readonly {
    readonly name: string;
    readonly streamId: bigint;
  }[];
}

/** One typed value emitted by an application-owned Source. */
export class SourceEmission {
  /** Declared output name. */
  public readonly output: string;
  /** UTF-8 text or opaque bytes. PCM belongs in `Session.audioInput()`. */
  public readonly data: string | Uint8Array;
  public readonly signal?: SignalSpec;
  public readonly sourceTimestampNs?: bigint;
  public readonly observedTimestampNs?: bigint;
  public readonly durationNs?: bigint;
  public readonly sourceGeneration?: number;
  public readonly discontinuityEpoch?: bigint;
  public readonly policyEpoch?: bigint;
  public readonly clockId?: number;
  public readonly terminal?: boolean;

  public constructor(options: SourceEmissionOptions) {
    this.output = exactText(options.output, 'Source emission output');
    this.data = typeof options.data === 'string' ? options.data : new Uint8Array(options.data);
    this.signal = options.signal;
    this.sourceTimestampNs = optionalU64(options.sourceTimestampNs, 'sourceTimestampNs');
    this.observedTimestampNs = optionalU64(options.observedTimestampNs, 'observedTimestampNs');
    this.durationNs = optionalU64(options.durationNs, 'durationNs');
    this.sourceGeneration = options.sourceGeneration ?? 1;
    requirePositiveInteger('sourceGeneration', this.sourceGeneration);
    this.discontinuityEpoch = optionalU64(options.discontinuityEpoch ?? 0n, 'discontinuityEpoch');
    this.policyEpoch = optionalU64(options.policyEpoch ?? 0n, 'policyEpoch');
    this.clockId = options.clockId ?? 1;
    if (!Number.isInteger(this.clockId) || this.clockId < 0 || this.clockId > 0xffff_ffff) {
      throw new RangeError('clockId must be a u32 integer');
    }
    this.terminal = options.terminal ?? false;
    validateSourceEmission(this);
    Object.freeze(this);
  }

  public static text(
    output: string,
    payload: string,
    options: Omit<SourceEmissionOptions, 'output' | 'data'> & { readonly signal: SignalSpec },
  ): SourceEmission {
    return new SourceEmission({ output, data: payload, ...options });
  }

  public static bytes(
    output: string,
    payload: Uint8Array,
    options: Omit<SourceEmissionOptions, 'output' | 'data'> & { readonly signal: SignalSpec },
  ): SourceEmission {
    return new SourceEmission({ output, data: payload, ...options });
  }
}

export interface SourceEmissionOptions {
  readonly output: string;
  readonly data: string | Uint8Array;
  readonly signal?: SignalSpec;
  readonly sourceTimestampNs?: bigint;
  readonly observedTimestampNs?: bigint;
  readonly durationNs?: bigint;
  readonly sourceGeneration?: number;
  readonly discontinuityEpoch?: bigint;
  readonly policyEpoch?: bigint;
  readonly clockId?: number;
  readonly terminal?: boolean;
}

export type SourceEmissionInput = SourceEmission | SourceEmissionOptions;

/** State created for one declared Source instance. */
export interface SourceDriver {
  prepare?(context: SourceDriverPrepareContext): void | Promise<void>;
  next(context: SourceContext): SourceEmissionInput | undefined | Promise<SourceEmissionInput | undefined>;
  close?(): void | Promise<void>;
}

/** Defines one reusable Source implementation. */
export interface SourceFactoryOptions {
  /** Portable reverse-domain identity ending in `.source.<name>.vN`. */
  readonly id: string;
  /** Typed non-PCM outputs produced by each instance. */
  readonly outputs: readonly PortSpec[];
  /** Create independent state for one Session declaration. */
  readonly create: (configuration: SourceConfiguration) => SourceDriver | Promise<SourceDriver>;
  /** Reject invalid configuration before any Source resource starts. */
  readonly validate?: (configuration: SourceConfiguration) => void | Promise<void>;
  /** Additive declaration revision. Defaults to one. */
  readonly revision?: number;
  /** Implementation generation. Defaults to one. */
  readonly generation?: number;
  /** Maximum duration of each JavaScript lifecycle call. Defaults to 5,000 ms. */
  readonly deadlineMs?: number;
  /** @internal */
  readonly prepareContext?: (
    context: NativeSourceContext,
    signal: AbortSignal,
  ) => SourceDriverPrepareContext;
  /** @internal Reuse an already Core-validated manifest. */
  readonly nativeManifest?: NativeSourceManifestHandle;
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
  readonly #manifest: NativeSourceManifestHandle;
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
    if (!Number.isInteger(this.deadlineMs) || this.deadlineMs < 1 || this.deadlineMs > 300_000) {
      throw new RangeError('deadlineMs must be an integer from 1 through 300000');
    }
    if (this.outputs.length === 0) {
      throw new TypeError('A Source needs at least one output');
    }
    if (this.outputs.some((output) => output.direction !== 'output' || output.signal.isAudio)) {
      throw new TypeError(
        'JavaScript Sources emit typed non-PCM signals; use Session.audioInput() for application-owned PCM',
      );
    }
    this.#manifest = options.nativeManifest ?? nativeCallSync(
      () => new (nativeAddon().NativeSourceManifest)(
        this.id,
        this.outputs.map((output) => output._nativeHandle()),
        this.revision,
        this.generation,
      ),
    );
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
      this.#manifest,
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
        const driver = await this.#options.create(configuration);
        this.#instances.set(instanceId, { driver, controller: new AbortController() });
        return {};
      }
      case 'source.prepare': {
        const active = this.#active(request);
        try {
          const nativeContext = requiredValue(request.sourceContext, 'Source prepare context');
          const context = this.#options.prepareContext === undefined
            ? sourceContext(nativeContext, active.controller.signal)
            : this.#options.prepareContext(nativeContext, active.controller.signal);
          await active.driver.prepare?.(context);
        } catch (error) {
          if (!active.controller.signal.aborted) active.controller.abort(error);
          throw error;
        }
        return {};
      }
      case 'source.next': {
        const active = this.#active(request);
        if (request.cancelled === true && !active.controller.signal.aborted) {
          active.controller.abort();
        }
        try {
          const emission = await active.driver.next({ signal: active.controller.signal });
          return emission === undefined ? {} : { emission: emissionToNative(emission, this.outputs) };
        } catch (error) {
          if (!active.controller.signal.aborted) active.controller.abort(error);
          throw error;
        }
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

/** One value emitted by an application-owned Operator. Core attaches lineage and derivation. */
export class OperatorEmission {
  /** Declared output name, or a uniquely matching output inferred from `signal`. */
  public readonly output?: string;
  /** Text, opaque bytes, or one complete interleaved float32 PCM frame. */
  public readonly data: string | Uint8Array | Float32Array;
  /** Exact typed signal carried by this emission. */
  public readonly signal?: SignalSpec;

  public constructor(options: {
    readonly data: string | Uint8Array | Float32Array;
    readonly signal?: SignalSpec;
    readonly output?: string;
  }) {
    if (options.output === undefined && options.signal === undefined) {
      throw new TypeError('Operator emission needs an output name or SignalSpec');
    }
    this.output = options.output;
    this.data = typeof options.data === 'string'
      ? options.data
      : options.data instanceof Float32Array
        ? new Float32Array(options.data)
        : new Uint8Array(options.data);
    this.signal = options.signal;
    validateOperatorEmission(this);
    Object.freeze(this);
  }

  public static audio(
    samples: Float32Array,
    options: { readonly signal: SignalSpec; readonly output?: string },
  ): OperatorEmission {
    return new OperatorEmission({ data: samples, ...options });
  }

  public static text(
    payload: string,
    options: { readonly signal: SignalSpec; readonly output?: string },
  ): OperatorEmission {
    return new OperatorEmission({ data: payload, ...options });
  }

  public static bytes(
    payload: Uint8Array,
    options: { readonly signal: SignalSpec; readonly output?: string },
  ): OperatorEmission {
    return new OperatorEmission({ data: payload, ...options });
  }
}

/** Structural shorthand retained for concise `defineOperator()` implementations. */
export type OperatorEmissionInput = OperatorEmission | {
  readonly output: string;
  readonly data: string | Uint8Array | Float32Array;
  readonly signal?: SignalSpec;
};

/** State created for one configured Operator instance. */
export interface OperatorNode {
  prepare?(context: OperatorContext): void | Promise<void>;
  process(
    input: SignalEnvelope,
    inputPort: string,
    context: OperatorContext,
  ): readonly OperatorEmissionInput[] | Promise<readonly OperatorEmissionInput[]>;
  flush?(context: OperatorContext): readonly OperatorEmissionInput[] | Promise<readonly OperatorEmissionInput[]>;
  cancel?(context: OperatorContext): void | Promise<void>;
  close?(): void | Promise<void>;
}

/** Defines one reusable off-realtime Operator implementation. */
export interface OperatorFactoryOptions {
  readonly id: string;
  readonly inputs: readonly PortSpec[];
  readonly outputs: readonly PortSpec[];
  readonly create: (configuration: SourceConfiguration) => OperatorNode | Promise<OperatorNode>;
  readonly validate?: (configuration: SourceConfiguration) => void | Promise<void>;
  readonly revision?: number;
  readonly generation?: number;
  /** Maximum signals retained by each Core Operator queue. Defaults to eight. */
  readonly queueCapacity?: number;
  /** Maximum duration of each JavaScript lifecycle call. Defaults to 5,000 ms. */
  readonly deadlineMs?: number;
  /** Core-enforced processing deadline. Defaults to 30 seconds. */
  readonly processTimeoutMs?: number;
  readonly networkAllowed?: boolean;
  readonly filesystemAllowed?: boolean;
  readonly drainQueued?: boolean;
  readonly continueOnFailure?: boolean;
  readonly terminalRoles?: readonly string[];
  /** @internal */
  readonly prepareContext?: (
    context: NativeOperatorPrepareContext,
    signal: AbortSignal,
  ) => OperatorContext;
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
  public readonly processTimeoutMs: number;
  public readonly networkAllowed: boolean;
  public readonly filesystemAllowed: boolean;
  public readonly drainQueued: boolean;
  public readonly continueOnFailure: boolean;
  public readonly terminalRoles: readonly string[];
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
    this.processTimeoutMs = options.processTimeoutMs ?? 30_000;
    this.networkAllowed = options.networkAllowed ?? false;
    this.filesystemAllowed = options.filesystemAllowed ?? false;
    this.drainQueued = options.drainQueued ?? false;
    this.continueOnFailure = options.continueOnFailure ?? false;
    this.terminalRoles = Object.freeze([...(options.terminalRoles ?? [])]);
    requirePositiveU32('revision', this.revision);
    requirePositiveU32('generation', this.generation);
    requirePositiveSafeInteger('queueCapacity', this.queueCapacity);
    if (!Number.isInteger(this.deadlineMs) || this.deadlineMs < 1 || this.deadlineMs > 300_000) {
      throw new RangeError('deadlineMs must be an integer from 1 through 300000');
    }
    requirePositiveU32('processTimeoutMs', this.processTimeoutMs);
    if (this.inputs.length === 0 || this.outputs.length === 0) {
      throw new TypeError('An Operator needs at least one input and one output');
    }
    if (this.inputs.some((port) => port.direction !== 'input')) {
      throw new TypeError('Operator inputs must be input PortSpecs');
    }
    if (this.outputs.some((port) => port.direction !== 'output')) {
      throw new TypeError('Operator outputs must be output PortSpecs');
    }
    const outputRoles = new Set(this.outputs.map((port) => port.signal.role).filter((role): role is string => role !== undefined));
    for (const role of this.terminalRoles) {
      if (role.trim().length === 0 || !outputRoles.has(role)) {
        throw new TypeError(`Terminal Operator role ${JSON.stringify(role)} is not a declared output role`);
      }
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
      this.queueCapacity.toString(),
      this.processTimeoutMs,
      this.networkAllowed,
      this.filesystemAllowed,
      this.drainQueued,
      this.continueOnFailure,
      [...this.terminalRoles],
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
          node: await this.#options.create(configuration),
          controller: new AbortController(),
        });
        return {};
      }
      case 'operator.prepare': {
        const active = this.#active(request);
        const context = this.#options.prepareContext === undefined
          ? { signal: active.controller.signal }
          : this.#options.prepareContext(
            requiredValue(request.operatorContext, 'Operator prepare context'),
            active.controller.signal,
          );
        await active.node.prepare?.(context);
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
        return { emissions: emissions.map((value) => operatorEmissionToNative(value, this.outputs)) };
      }
      case 'operator.flush': {
        const active = this.#active(request);
        const emissions = (await active.node.flush?.({ signal: active.controller.signal })) ?? [];
        return { emissions: emissions.map((value) => operatorEmissionToNative(value, this.outputs)) };
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

/** Explicit accounting result for one Endpoint item. */
export type EndpointDeliveryOutcome = 'delivered' | 'dropped';

/** Function accepted by the concise Endpoint form. */
export type EndpointReceive = (
  item: EndpointItem,
  context: EndpointContext,
) => EndpointDeliveryOutcome | void | Promise<EndpointDeliveryOutcome | void>;

/** State created for one prepared Endpoint instance. */
export interface EndpointNode {
  prepare?(context: EndpointContext): { readonly idleEnabled?: boolean } | void | Promise<{ readonly idleEnabled?: boolean } | void>;
  start?(context: EndpointContext): void | Promise<void>;
  /** Invoked after Core opens the transactional Session start barrier. */
  gateOpen?(context: EndpointContext): void | Promise<void>;
  receive(item: EndpointItem, context: EndpointContext): EndpointDeliveryOutcome | void | Promise<EndpointDeliveryOutcome | void>;
  /** Receive one finite native-owned batch when the Endpoint enables batching. */
  receiveBatch?(items: readonly EndpointItem[], context: EndpointContext): EndpointDeliveryOutcome | readonly EndpointDeliveryOutcome[] | void | Promise<EndpointDeliveryOutcome | readonly EndpointDeliveryOutcome[] | void>;
  /** Optional finite work invoked only when a prepared Endpoint explicitly enables idle polling. */
  idle?(context: EndpointContext): void | Promise<void>;
  stop?(mode: 'drain' | 'abort', context: EndpointContext): void | Promise<void>;
  close?(): void | Promise<void>;
  /** @internal Return validated final counters to Core after close. */
  _finalObservations?(): NativeEndpointDriverObservations;
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
  /** Maximum items delivered in one callback. Defaults to one; maximum 1,024. */
  readonly maximumBatchItems?: number;
}

/** Defines one application-owned Endpoint implementation. */
export interface EndpointFactoryOptions extends EndpointProviderOptions {
  /** Create independent state for the inputs Core starts together. */
  readonly create: (
    configuration: SourceConfiguration,
    inputs: readonly NativeEndpointInputDescriptor[],
  ) => EndpointNode;
  /** Reject invalid configuration before any Endpoint resource starts. */
  readonly validate?: (configuration: SourceConfiguration) => void | Promise<void>;
  /** Select route-local preparation or a stable shared preparation group. */
  readonly preparationGroup?: (
    routeId: bigint,
    configuration: SourceConfiguration,
  ) => string | undefined;
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
  public readonly maximumBatchItems: number;
  readonly #options: EndpointFactoryOptions;
  readonly #instances = new Map<string, ActiveEndpoint>();
  #sessionId: bigint | undefined;

  public constructor(options: EndpointFactoryOptions) {
    this.#options = options;
    this.id = options.id;
    this.nodeType = options.nodeType ?? `${options.id}.node`;
    this.inputs = Object.freeze([...options.inputs]);
    this.deadlineMs = options.deadlineMs ?? 5_000;
    this.maximumBatchItems = options.maximumBatchItems ?? 1;
    if (this.id.trim().length === 0 || this.nodeType.trim().length === 0) {
      throw new TypeError('Endpoint id and nodeType cannot be empty');
    }
    if (this.inputs.length === 0 || this.inputs.some((input) => input.direction !== 'input')) {
      throw new TypeError('An Endpoint needs at least one input PortSpec');
    }
    if (!Number.isInteger(this.deadlineMs) || this.deadlineMs < 1 || this.deadlineMs > 300_000) {
      throw new RangeError('deadlineMs must be an integer from 1 through 300000');
    }
    if (!Number.isInteger(this.maximumBatchItems) || this.maximumBatchItems < 1 || this.maximumBatchItems > 1_024) {
      throw new RangeError('maximumBatchItems must be an integer from 1 through 1024');
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
      this.maximumBatchItems,
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
      case 'endpoint.preparation_group': {
        if (this.#options.preparationGroup === undefined) return {};
        const group = this.#options.preparationGroup(
          BigInt(required(request.routeId, 'routeId')),
          configuration,
        );
        return group === undefined
          ? { routePreparation: true }
          : { preparationGroup: group };
      }
      case 'endpoint.validate':
        await this.#options.validate?.(configuration);
        return {};
      case 'endpoint.create': {
        const instanceId = required(request.instanceId, 'instanceId');
        if (this.#instances.has(instanceId)) throw new Error('Endpoint instance already exists');
        this.#instances.set(instanceId, {
          node: this.#options.create(
            configuration,
            Object.freeze([...(request.endpointInputs ?? [])]),
          ),
          controller: new AbortController(),
          state: 'new',
        });
        return {};
      }
      case 'endpoint.prepare': {
        const active = this.#active(request);
        if (active.state !== 'new') throw new Error(`Endpoint cannot prepare while ${active.state}`);
        active.state = 'preparing';
        const preparation = await active.node.prepare?.({ signal: active.controller.signal });
        active.state = 'prepared';
        return { idleEnabled: preparation?.idleEnabled ?? false };
      }
      case 'endpoint.start': {
        const active = this.#active(request);
        if (active.state !== 'prepared') throw new Error(`Endpoint cannot start while ${active.state}`);
        await active.node.start?.({ signal: active.controller.signal });
        active.state = 'running';
        return {};
      }
      case 'endpoint.gate_open': {
        const active = this.#active(request);
        if (active.state === 'stopping' || active.state === 'closed') return {};
        if (active.state !== 'running') throw new Error('Endpoint start gate opened outside its running lifetime');
        await active.node.gateOpen?.({ signal: active.controller.signal });
        return {};
      }
      case 'endpoint.receive': {
        const active = this.#active(request);
        if (active.state !== 'running') {
          throw new Error('Endpoint received data outside its running lifetime');
        }
        const outcome = await active.node.receive(endpointItem(request), { signal: active.controller.signal });
        return { outcome: endpointDeliveryOutcome(outcome) };
      }
      case 'endpoint.receive_batch': {
        const active = this.#active(request);
        if (active.state !== 'running') {
          throw new Error('Endpoint received data outside its running lifetime');
        }
        const items = Object.freeze((request.endpointItems ?? []).map(endpointItem));
        if (items.length === 0) throw new Error('Endpoint received an empty batch');
        if (active.node.receiveBatch !== undefined) {
          const outcome = await active.node.receiveBatch(items, { signal: active.controller.signal });
          const outcomes = Array.isArray(outcome)
            ? outcome.map(endpointDeliveryOutcome)
            : items.map(() => endpointDeliveryOutcome(outcome));
          if (outcomes.length !== items.length) throw new Error('Endpoint returned the wrong number of batch outcomes');
          return { outcomes: [...outcomes] };
        } else {
          const outcomes: EndpointDeliveryOutcome[] = [];
          for (const item of items) {
            outcomes.push(endpointDeliveryOutcome(
              await active.node.receive(item, { signal: active.controller.signal }),
            ));
          }
          return { outcomes };
        }
      }
      case 'endpoint.idle': {
        const active = this.#active(request);
        if (active.state !== 'running') throw new Error('Endpoint cannot idle outside its running lifetime');
        await active.node.idle?.({ signal: active.controller.signal });
        return {};
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
        if (active === undefined) return {};
        const endpointObservations = await this.#finish(instanceId, active);
        return { endpointObservations };
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

  async #finish(
    instanceId: string,
    active: ActiveEndpoint,
  ): Promise<NativeEndpointDriverObservations | undefined> {
    if (active.state === 'closed') return active.node._finalObservations?.();
    active.state = 'closed';
    if (!active.controller.signal.aborted) active.controller.abort();
    this.#instances.delete(instanceId);
    await active.node.close?.();
    return active.node._finalObservations?.();
  }
}

function endpointDeliveryOutcome(value: unknown): EndpointDeliveryOutcome {
  if (value === 'delivered' || value === 'dropped') return value;
  if (typeof value === 'string') {
    throw new TypeError(`Unsupported Endpoint delivery outcome: ${value}`);
  }
  // JavaScript callbacks assigned to a void-returning contract may still
  // return incidental values (for example, Array.push returns a number).
  // Only the explicit dropped sentinel changes native delivery accounting.
  return 'delivered';
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

function endpointItem(request: NativeProviderCall | NativeEndpointItem): EndpointItem {
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

function sourceContext(value: NativeSourceContext | null | undefined, signal: AbortSignal): SourceDriverPrepareContext {
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

function emissionToNative(
  value: SourceEmissionInput,
  outputs: readonly PortSpec[],
): NativeProviderEmission {
  validateSourceEmission(value);
  const output = outputs.find((candidate) => candidate.name === value.output);
  if (output === undefined) {
    throw new TypeError(`Source emitted undeclared output ${JSON.stringify(value.output)}`);
  }
  if (value.signal !== undefined && !output.signal.isCompatibleWith(value.signal)) {
    throw new TypeError(`Source output ${JSON.stringify(value.output)} does not accept the emission SignalSpec`);
  }
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

function validateSourceEmission(value: {
  readonly data: string | Uint8Array;
  readonly signal?: SignalSpec;
}): void {
  if (value.signal === undefined) return;
  const kind = value.signal.kind;
  if (typeof value.data === 'string' && kind !== 'text' && kind !== 'any') {
    throw new TypeError('Source emission payload does not match its SignalSpec');
  }
  if (typeof value.data !== 'string' && kind !== 'binary' && kind !== 'any') {
    throw new TypeError('Source emission payload does not match its SignalSpec');
  }
}

function operatorEmissionToNative(
  value: OperatorEmissionInput,
  outputs: readonly PortSpec[],
): NativeProviderEmission {
  validateOperatorEmission(value);
  const output = resolveOperatorOutput(value, outputs);
  if (typeof value.data === 'string') {
    return { output, payloadKind: 'text', text: value.data };
  }
  if (value.data instanceof Float32Array) {
    return {
      output,
      payloadKind: 'audio',
      samplesF32Le: Buffer.from(
        value.data.buffer,
        value.data.byteOffset,
        value.data.byteLength,
      ),
    };
  }
  return { output, payloadKind: 'bytes', bytes: Buffer.from(value.data) };
}

function validateOperatorEmission(value: {
  readonly data: string | Uint8Array | Float32Array;
  readonly signal?: SignalSpec;
}): void {
  if (value.signal === undefined) return;
  const kind = value.signal.kind;
  if (typeof value.data === 'string' && kind !== 'text' && kind !== 'any') {
    throw new TypeError('Operator text emission does not match its SignalSpec');
  }
  if (value.data instanceof Float32Array && kind !== 'pcm-audio' && kind !== 'any') {
    throw new TypeError('Operator audio emission does not match its SignalSpec');
  }
  if (
    typeof value.data !== 'string'
    && !(value.data instanceof Float32Array)
    && kind !== 'binary'
    && kind !== 'any'
  ) {
    throw new TypeError('Operator bytes emission does not match its SignalSpec');
  }
}

function resolveOperatorOutput(
  value: OperatorEmissionInput,
  outputs: readonly PortSpec[],
): string {
  if (value.output !== undefined) {
    const output = outputs.find((candidate) => candidate.name === value.output);
    if (output === undefined) {
      throw new TypeError(`Operator emitted undeclared output ${JSON.stringify(value.output)}`);
    }
    if (value.signal !== undefined && !output.signal.isCompatibleWith(value.signal)) {
      throw new TypeError(`Operator output ${JSON.stringify(value.output)} does not accept the emission SignalSpec`);
    }
    return value.output;
  }
  if (value.signal === undefined) {
    throw new TypeError('Operator emission needs an output name or SignalSpec');
  }
  const matches = outputs.filter((candidate) =>
    candidate.signal.wireId === value.signal?.wireId
    || candidate.signal.isCompatibleWith(value.signal as SignalSpec),
  );
  if (matches.length !== 1) {
    throw new TypeError(`Operator emission SignalSpec matches ${matches.length} outputs; declare output explicitly`);
  }
  return matches[0]!.name;
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

function requiredValue<T>(value: T | null | undefined, name: string): T {
  if (value == null) throw new Error(`${name} is unavailable`);
  return value;
}

function exactText(value: string, name: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be non-empty and exact`);
  }
  return value;
}

function optionalU64(value: bigint | undefined, name: string): bigint | undefined {
  if (value === undefined) return undefined;
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`${name} must be a u64 bigint`);
  }
  return value;
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function requirePositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function requirePositiveU32(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) {
    throw new RangeError(`${name} must be a positive unsigned 32-bit integer`);
  }
}
