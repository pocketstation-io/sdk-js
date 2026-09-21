import { PocketStationError } from '../errors.js';
import * as graph from './graph.js';
import type {
  Configuration,
  ConfigurationValue,
  MediaCaps,
  PortSpec,
  RouteSettings,
  SignalSpec,
} from './graph.js';
import type {
  EndpointFactoryOptions,
  EndpointItem,
  EndpointNode,
  SourceConfiguration,
} from './provider.js';
import type { Endpoint } from './session.js';
import type { SignalEnvelope } from './signals.js';
import type {
  NativeConfigurationEntry,
  NativeConnectorManifest,
  NativeEndpointInputDescriptor,
  NativeProviderAudio,
  NativeProviderCall,
  NativeProviderResult,
} from './native.js';

/** Exact Connector configuration value families shared with Core. */
export const ConnectorConfigurationValueKind = {
  Text: 'text', Boolean: 'boolean', SignedInteger: 'signed-integer',
  UnsignedInteger: 'unsigned-integer', DurationMilliseconds: 'duration-milliseconds',
  ByteCount: 'byte-count', Secret: 'secret',
} as const;
export type ConnectorConfigurationValueKind =
  (typeof ConnectorConfigurationValueKind)[keyof typeof ConnectorConfigurationValueKind];

/** Whether a Connector configuration field is mandatory, optional, or defaulted. */
export const ConnectorConfigurationRequirement = {
  Required: 'required', Optional: 'optional', Default: 'default',
} as const;
export type ConnectorConfigurationRequirement =
  (typeof ConnectorConfigurationRequirement)[keyof typeof ConnectorConfigurationRequirement];

/** Lifecycle stage attached to a structured Connector failure. */
export const ConnectorErrorStage = {
  Configuration: 'configuration', Prepare: 'prepare', Startup: 'startup',
  Readiness: 'readiness', Delivery: 'delivery', Retry: 'retry',
  Shutdown: 'shutdown', Join: 'join',
} as const;
export type ConnectorErrorStage =
  (typeof ConnectorErrorStage)[keyof typeof ConnectorErrorStage];

/** Whether retrying a failed Connector operation can be meaningful. */
export const ConnectorRetryability = {
  Never: 'never', Retryable: 'retryable',
  RetryAfterReconfiguration: 'retry-after-reconfiguration',
} as const;
export type ConnectorRetryability =
  (typeof ConnectorRetryability)[keyof typeof ConnectorRetryability];

/** Explicit accounting result for one delivered item. */
export const ConnectorDeliveryOutcome = { Delivered: 'delivered', Dropped: 'dropped' } as const;
export type ConnectorDeliveryOutcome =
  (typeof ConnectorDeliveryOutcome)[keyof typeof ConnectorDeliveryOutcome];

/** Finalization policy selected by the Session. */
export const ConnectorShutdownMode = { Drain: 'drain', Abort: 'abort' } as const;
export type ConnectorShutdownMode =
  (typeof ConnectorShutdownMode)[keyof typeof ConnectorShutdownMode];
/** Delivery gate reported by a Connector. */
export const ConnectorDeliveryReadiness = { NotReady: 'not-ready', Ready: 'ready' } as const;
export type ConnectorDeliveryReadiness =
  (typeof ConnectorDeliveryReadiness)[keyof typeof ConnectorDeliveryReadiness];
/** Provider health reported independently of readiness. */
export const ConnectorHealth = { Healthy: 'healthy', Degraded: 'degraded' } as const;
export type ConnectorHealth = (typeof ConnectorHealth)[keyof typeof ConnectorHealth];
/** Provider reconnection state reported independently of health. */
export const ConnectorRecovery = { Idle: 'idle', Reconnecting: 'reconnecting' } as const;
export type ConnectorRecovery = (typeof ConnectorRecovery)[keyof typeof ConnectorRecovery];

/** Structured provider failure preserved in Connector observations. */
export class ConnectorError extends PocketStationError {
  public readonly stage: ConnectorErrorStage;
  public readonly retryability: ConnectorRetryability;
  public constructor(
    message: string,
    options: { code: string; stage: ConnectorErrorStage; retryability?: ConnectorRetryability; cause?: unknown },
  ) {
    if (options.code.trim().length === 0) throw new TypeError('Connector error code cannot be empty');
    super(options.code, boundedErrorMessage(message), { cause: options.cause });
    this.name = 'ConnectorError';
    this.stage = options.stage;
    this.retryability = options.retryability ?? 'never';
  }
}

/** Immutable structured failure retained by a Connector runtime. */
export interface ConnectorErrorSnapshot {
  readonly code: string; readonly stage: ConnectorErrorStage;
  readonly retryability: ConnectorRetryability; readonly message: string;
}

/** Orthogonal delivery, health, and recovery state. */
export interface ConnectorServiceStatus {
  readonly deliveryReadiness: ConnectorDeliveryReadiness;
  readonly health: ConnectorHealth; readonly recovery: ConnectorRecovery;
  readonly readinessReasonCode?: string; readonly healthReasonCode?: string;
  readonly recoveryReasonCode?: string; readonly revision: bigint;
  readonly lastTransitionElapsedNs: bigint; readonly acceptsDelivery: boolean;
}

/** Provider-service observations for one prepared Connector runtime. */
export interface ConnectorObservations {
  readonly serviceStatus: ConnectorServiceStatus;
  readonly statusTransitionsTotal: bigint; readonly retryAttemptsTotal: bigint;
  readonly reconnectsTotal: bigint; readonly failuresTotal: bigint;
  readonly lastError?: ConnectorErrorSnapshot;
}

/** Connector plus delivery counters for one prepared input group. */
export interface ConnectorRuntimeObservations {
  readonly endpointIds: readonly bigint[]; readonly connector: ConnectorObservations;
  readonly framesReceivedTotal: bigint; readonly framesDeliveredTotal: bigint;
  readonly framesDroppedTotal: bigint; readonly discontinuitiesTotal: bigint;
  readonly endpointFailuresTotal: bigint;
}

/** One typed configuration value with explicit secret access. */
export class ConnectorConfigurationValue {
  readonly #kind: ConnectorConfigurationValueKind;
  readonly #value: string | boolean | bigint;
  private constructor(kind: ConnectorConfigurationValueKind, value: string | boolean | bigint) {
    this.#kind = kind; this.#value = value;
    if ((kind === 'text' || kind === 'secret') && Buffer.byteLength(value as string) > 16 * 1024) {
      throw configurationError('connector.configuration.value_too_large', 'Connector configuration text exceeds 16384 bytes');
    }
    if (kind === 'secret' && (value as string).length === 0) {
      throw configurationError('connector.configuration.empty_secret', 'Connector secret cannot be empty');
    }
  }
  public static text(value: string): ConnectorConfigurationValue { return new ConnectorConfigurationValue('text', value); }
  public static boolean(value: boolean): ConnectorConfigurationValue { return new ConnectorConfigurationValue('boolean', value); }
  public static signedInteger(value: bigint | number): ConnectorConfigurationValue { return new ConnectorConfigurationValue('signed-integer', integer(value, true)); }
  public static unsignedInteger(value: bigint | number): ConnectorConfigurationValue { return new ConnectorConfigurationValue('unsigned-integer', integer(value, false)); }
  public static durationMilliseconds(value: bigint | number): ConnectorConfigurationValue { return new ConnectorConfigurationValue('duration-milliseconds', integer(value, false)); }
  public static byteCount(value: bigint | number): ConnectorConfigurationValue { return new ConnectorConfigurationValue('byte-count', integer(value, false)); }
  public static secret(value: string): ConnectorConfigurationValue { return new ConnectorConfigurationValue('secret', value); }
  public get kind(): ConnectorConfigurationValueKind { return this.#kind; }
  /** Return a non-secret value. */
  public get value(): string | boolean | bigint {
    if (this.#kind === 'secret') throw configurationError('connector.configuration.secret_access', 'Secret configuration requires exposeSecret()');
    return this.#value;
  }
  /** Explicitly reveal a secret to its owning Connector. */
  public exposeSecret(): string {
    if (this.#kind !== 'secret') throw configurationError('connector.configuration.not_secret', 'Only a secret Connector value can be exposed');
    return this.#value as string;
  }
  /** @internal */ public _encoded(): string { return String(this.#value); }
  public toString(): string { return this.#kind === 'secret' ? 'ConnectorConfigurationValue.secret(<redacted>)' : `ConnectorConfigurationValue.${this.#kind}(${String(this.#value)})`; }
}

/** Values accepted when declaring a configured Connector. */
export type ConnectorConfigurationInput = Readonly<Record<string, ConnectorConfigurationValue | string | boolean | number | bigint>>;

type ConstraintSpec =
  | { readonly kind: 'non-empty' }
  | { readonly kind: 'text-length-bytes'; readonly minimum: number; readonly maximum: number }
  | { readonly kind: 'signed-range' | 'unsigned-range'; readonly minimum: bigint; readonly maximum: bigint }
  | { readonly kind: 'one-of'; readonly values: readonly string[] };

/** One finite constraint applied to a Connector configuration field. */
export class ConnectorConfigurationConstraint {
  /** @internal */ public readonly _spec: ConstraintSpec;
  private constructor(spec: ConstraintSpec) { this._spec = Object.freeze(spec); }
  public static nonEmpty(): ConnectorConfigurationConstraint { return new ConnectorConfigurationConstraint({ kind: 'non-empty' }); }
  public static textLengthBytes(minimum: number, maximum: number): ConnectorConfigurationConstraint {
    finiteRange(minimum, maximum, 'text length');
    return new ConnectorConfigurationConstraint({ kind: 'text-length-bytes', minimum, maximum });
  }
  public static signedRange(minimum: bigint | number, maximum: bigint | number): ConnectorConfigurationConstraint {
    const low = integer(minimum, true); const high = integer(maximum, true);
    if (low > high) throw new RangeError('signed range minimum cannot exceed maximum');
    return new ConnectorConfigurationConstraint({ kind: 'signed-range', minimum: low, maximum: high });
  }
  public static unsignedRange(minimum: bigint | number, maximum: bigint | number): ConnectorConfigurationConstraint {
    const low = integer(minimum, false); const high = integer(maximum, false);
    if (low > high) throw new RangeError('unsigned range minimum cannot exceed maximum');
    return new ConnectorConfigurationConstraint({ kind: 'unsigned-range', minimum: low, maximum: high });
  }
  public static oneOf(values: readonly string[]): ConnectorConfigurationConstraint {
    if (values.length === 0 || values.some((value) => value.length === 0)) throw new TypeError('oneOf requires non-empty values');
    return new ConnectorConfigurationConstraint({ kind: 'one-of', values: Object.freeze([...values]) });
  }
}

/** Construction fields for one documented Connector configuration field. */
export interface ConnectorConfigurationFieldOptions {
  readonly name: string; readonly kind: ConnectorConfigurationValueKind;
  readonly documentation: string; readonly requirement?: ConnectorConfigurationRequirement;
  readonly default?: ConnectorConfigurationValue | string | boolean | number | bigint;
  readonly constraints?: readonly ConnectorConfigurationConstraint[]; readonly deprecation?: string;
}

/** One documented typed field in a Connector configuration schema. */
export class ConnectorConfigurationField {
  public readonly name: string; public readonly kind: ConnectorConfigurationValueKind;
  public readonly documentation: string; public readonly requirement: ConnectorConfigurationRequirement;
  public readonly default?: ConnectorConfigurationValue;
  public readonly constraints: readonly ConnectorConfigurationConstraint[]; public readonly deprecation?: string;
  public constructor(options: ConnectorConfigurationFieldOptions) {
    this.name = options.name; this.kind = options.kind; this.documentation = options.documentation;
    this.requirement = options.requirement ?? 'required'; this.constraints = Object.freeze([...(options.constraints ?? [])]);
    this.deprecation = options.deprecation;
    if (this.name.trim().length === 0 || this.documentation.trim().length === 0) throw configurationError('connector.configuration.invalid_schema', 'Connector fields require a name and documentation');
    if (this.requirement === 'default') {
      if (options.default === undefined) throw configurationError('connector.configuration.invalid_schema', 'A default field requires a default value');
      if (this.kind === 'secret') throw configurationError('connector.configuration.secret_default_forbidden', 'Secret fields cannot have defaults');
      this.default = coerceConfigurationValue(this.kind, options.default); validateConstraints(this, this.default);
    } else if (options.default !== undefined) throw configurationError('connector.configuration.invalid_schema', 'Only a default field can provide a default value');
    Object.freeze(this);
  }
}

/** Finite typed configuration schema resolved before provider preparation. */
export class ConnectorConfigurationSchema {
  public readonly fields: readonly ConnectorConfigurationField[]; public readonly revision: number;
  public constructor(fields: readonly ConnectorConfigurationField[] = [], revision = 1) {
    positiveInteger('revision', revision); if (fields.length > 128) throw configurationError('connector.configuration.too_many_fields', 'Connector configuration schema cannot exceed 128 fields');
    const names = new Set<string>(); for (const field of fields) { if (names.has(field.name)) throw configurationError('connector.configuration.duplicate_field', `Duplicate Connector configuration field ${field.name}`); names.add(field.name); }
    this.fields = Object.freeze([...fields]); this.revision = revision; Object.freeze(this);
  }
  /** Resolve defaults and validate an application configuration. */
  public configuration(values: ConnectorConfigurationInput = {}): Readonly<Record<string, ConnectorConfigurationValue>> {
    const unknown = Object.keys(values).find((name) => !this.fields.some((field) => field.name === name));
    if (unknown !== undefined) throw configurationError('connector.configuration.unknown_field', `Unknown Connector configuration field ${unknown}`);
    const result: Record<string, ConnectorConfigurationValue> = {};
    for (const field of this.fields) {
      const supplied = values[field.name];
      if (supplied === undefined) { if (field.requirement === 'required') throw configurationError('connector.configuration.missing_required_field', `Required Connector configuration field ${field.name} is missing`); if (field.default !== undefined) result[field.name] = field.default; continue; }
      const value = coerceConfigurationValue(field.kind, supplied); validateConstraints(field, value); result[field.name] = value;
    }
    return Object.freeze(result);
  }
  /** @internal */ public _decode(values: SourceConfiguration): Readonly<Record<string, ConnectorConfigurationValue>> {
    const typed: Record<string, ConnectorConfigurationValue> = {};
    for (const field of this.fields) { const encoded = values[field.name]; if (encoded !== undefined) typed[field.name] = decodeConfigurationValue(field.kind, encoded); }
    return this.configuration(typed);
  }
  /** @internal */ public _encode(values: ConnectorConfigurationInput): Configuration {
    const resolved = this.configuration(values);
    return Object.freeze(Object.fromEntries(Object.entries(resolved).map(([name, value]) => [name, value.kind === 'secret' ? ({ value: value.exposeSecret(), secret: true } satisfies ConfigurationValue) : value._encoded()])));
  }
  /** @internal */ public _nativeEntries(values: ConnectorConfigurationInput): NativeConfigurationEntry[] {
    const resolved = this.configuration(values);
    return Object.entries(resolved).map(([key, value]) => ({
      key,
      value: value.kind === 'secret' ? value.exposeSecret() : value._encoded(),
      sensitive: value.kind === 'secret',
    }));
  }
}

/** One stable capability advertised by a Connector implementation. */
export interface ConnectorCapability { readonly id: string; readonly documentation: string; }
/** One external or host requirement declared by a Connector. */
export interface ConnectorRequirement { readonly id: string; readonly documentation: string; readonly required?: boolean; }

/** Construction fields for a provider-neutral Connector declaration. */
export interface ConnectorManifestOptions {
  readonly operatorId: string; readonly packageVersion: string; readonly inputs: readonly PortSpec[];
  readonly configuration?: ConnectorConfigurationSchema; readonly nodeTypeId?: string;
  readonly manifestRevision?: number; readonly startupTimeoutMs?: number; readonly probeIntervalMs?: number;
  readonly successThreshold?: number; readonly failureThreshold?: number;
  readonly capabilities?: readonly ConnectorCapability[]; readonly requirements?: readonly ConnectorRequirement[];
}

/** Validated identity, ports, configuration, and readiness policy for a Connector. */
export class ConnectorManifest {
  public readonly operatorId: string; public readonly packageVersion: string; public readonly inputs: readonly PortSpec[];
  public readonly configuration: ConnectorConfigurationSchema; public readonly nodeTypeId: string;
  public readonly manifestRevision: number; public readonly startupTimeoutMs: number; public readonly probeIntervalMs: number;
  public readonly successThreshold: number; public readonly failureThreshold: number;
  public readonly capabilities: readonly ConnectorCapability[]; public readonly requirements: readonly ConnectorRequirement[];
  public constructor(options: ConnectorManifestOptions) {
    if (options.operatorId.trim().length === 0 || options.packageVersion.trim().length === 0) throw new TypeError('Connector operatorId and packageVersion cannot be empty');
    if (options.inputs.length === 0 || options.inputs.some((port) => port.direction !== 'input')) throw new TypeError('Connector manifests require at least one input and cannot declare outputs');
    this.operatorId = options.operatorId; this.packageVersion = options.packageVersion; this.inputs = Object.freeze([...options.inputs]);
    this.configuration = options.configuration ?? new ConnectorConfigurationSchema(); this.nodeTypeId = options.nodeTypeId ?? options.operatorId;
    this.manifestRevision = options.manifestRevision ?? 1; this.startupTimeoutMs = options.startupTimeoutMs ?? 5_000;
    this.probeIntervalMs = options.probeIntervalMs ?? 100; this.successThreshold = options.successThreshold ?? 1; this.failureThreshold = options.failureThreshold ?? 1;
    this.capabilities = validateManifestEntries(options.capabilities ?? [], 'capability'); this.requirements = validateManifestEntries(options.requirements ?? [], 'requirement');
    positiveInteger('manifestRevision', this.manifestRevision); positiveInteger('startupTimeoutMs', this.startupTimeoutMs); positiveInteger('probeIntervalMs', this.probeIntervalMs); positiveInteger('successThreshold', this.successThreshold); positiveInteger('failureThreshold', this.failureThreshold); Object.freeze(this);
  }
  /** Build the common one-input PCM Connector manifest. */
  public static audio(operatorId: string, options: { packageVersion: string; configuration?: ConnectorConfigurationSchema; portName?: string; multiplicity?: 'one' | 'many' }): ConnectorManifest {
    const signal = graph.SignalSpec.audio();
    return new ConnectorManifest({ operatorId, packageVersion: options.packageVersion, inputs: [graph.PortSpec.input(options.portName ?? 'audio', signal, { multiplicity: options.multiplicity ?? 'one' })], configuration: options.configuration });
  }
  /** @internal */ public _nativeManifest(): NativeConnectorManifest {
    return {
      operatorId: this.operatorId,
      nodeTypeId: this.nodeTypeId,
      packageVersion: this.packageVersion,
      manifestRevision: this.manifestRevision,
      startupTimeoutMs: this.startupTimeoutMs,
      probeIntervalMs: this.probeIntervalMs,
      successThreshold: this.successThreshold,
      failureThreshold: this.failureThreshold,
      configurationRevision: this.configuration.revision,
      configurationFields: this.configuration.fields.map((field) => ({
        name: field.name,
        kind: field.kind,
        requirement: field.requirement,
        documentation: field.documentation,
        ...(field.default === undefined ? {} : { defaultValue: field.default._encoded() }),
        constraints: field.constraints.map((constraint) => {
          const spec = constraint._spec;
          switch (spec.kind) {
            case 'non-empty': return { kind: spec.kind };
            case 'text-length-bytes': return { kind: spec.kind, minimum: String(spec.minimum), maximum: String(spec.maximum) };
            case 'signed-range':
            case 'unsigned-range': return { kind: spec.kind, minimum: String(spec.minimum), maximum: String(spec.maximum) };
            case 'one-of': return { kind: spec.kind, values: [...spec.values] };
          }
        }),
        ...(field.deprecation === undefined ? {} : { deprecation: field.deprecation }),
      })),
      capabilities: this.capabilities.map((entry) => ({ ...entry })),
      requirements: this.requirements.map((entry) => ({ ...entry })),
    };
  }
}

/** Source-aware PCM delivered to an application Connector. */
export interface ConnectorAudioFrame {
  readonly samples: Float32Array; readonly sampleRateHz: number; readonly channels: number;
  readonly sourceId: bigint; readonly streamId: bigint; readonly sequenceNumber: bigint;
  readonly timestampNs: bigint; readonly routeEnqueuedAtNs: bigint; readonly routeReceivedAtNs: bigint;
  readonly outputGenerationId?: bigint; readonly sourceGeneration: number; readonly discontinuityEpoch: bigint;
  readonly permissionEpoch: bigint; readonly clockId: number; readonly durationNs: bigint;
  readonly connectorId?: bigint; readonly endpointId?: bigint; readonly routeId?: bigint;
  readonly endpointEnqueuedAtNs?: bigint; readonly polledAtNs?: bigint;
}

/** Immutable route metadata and resolved configuration for one Connector input. */
export interface ConnectorInputDescriptor {
  readonly endpointId: bigint; readonly connectorId?: bigint; readonly routeId: bigint;
  readonly portName: string; readonly signalWireId: string; readonly signal: SignalSpec;
  readonly media: MediaCaps; readonly routeSettings: RouteSettings;
  readonly configuration: Readonly<Record<string, ConnectorConfigurationValue>>;
}

/** One owned audio frame or typed signal delivered off realtime threads. */
export type ConnectorItem =
  | { readonly kind: 'audio'; readonly input: ConnectorInputDescriptor; readonly audio: ConnectorAudioFrame; readonly signal?: undefined }
  | { readonly kind: 'signal'; readonly input: ConnectorInputDescriptor; readonly signal: SignalEnvelope; readonly audio?: undefined };

interface MutableServiceStatus {
  deliveryReadiness: ConnectorDeliveryReadiness; health: ConnectorHealth; recovery: ConnectorRecovery;
  readinessReasonCode?: string; healthReasonCode?: string; recoveryReasonCode?: string;
  revision: bigint; lastTransitionElapsedNs: bigint;
}

class RuntimeState {
  readonly startedNs = process.hrtime.bigint(); readonly endpointIds: readonly bigint[]; readonly controller: AbortController;
  readonly status: MutableServiceStatus = { deliveryReadiness: 'not-ready', health: 'healthy', recovery: 'idle', revision: 0n, lastTransitionElapsedNs: 0n };
  transitions = 0n; retries = 0n; reconnects = 0n; failures = 0n; received = 0n; delivered = 0n; dropped = 0n; discontinuities = 0n; endpointFailures = 0n;
  lastError?: ConnectorErrorSnapshot; shutdownMode?: ConnectorShutdownMode; lastDiscontinuities = new Map<bigint, bigint>();
  active = true;
  public constructor(endpointIds: readonly bigint[], controller = new AbortController()) { this.endpointIds = Object.freeze([...new Set(endpointIds)]); this.controller = controller; }
  public transition(change: () => void): boolean {
    const before = `${this.status.deliveryReadiness}|${this.status.health}|${this.status.recovery}|${this.status.readinessReasonCode}|${this.status.healthReasonCode}|${this.status.recoveryReasonCode}`;
    change(); const after = `${this.status.deliveryReadiness}|${this.status.health}|${this.status.recovery}|${this.status.readinessReasonCode}|${this.status.healthReasonCode}|${this.status.recoveryReasonCode}`;
    if (before === after) return false; this.status.revision += 1n; this.status.lastTransitionElapsedNs = process.hrtime.bigint() - this.startedNs; this.transitions += 1n; return true;
  }
  public fail(error: unknown, stage: ConnectorErrorStage): ConnectorError {
    const structured = asConnectorError(error, stage); this.failures += 1n; this.endpointFailures += 1n;
    this.lastError = Object.freeze({ code: structured.code, stage: structured.stage, retryability: structured.retryability, message: structured.message }); return structured;
  }
  public snapshot(): ConnectorRuntimeObservations {
    const serviceStatus: ConnectorServiceStatus = Object.freeze({ ...this.status, acceptsDelivery: this.status.deliveryReadiness === 'ready' && this.status.recovery === 'idle' });
    const connector: ConnectorObservations = Object.freeze({ serviceStatus, statusTransitionsTotal: this.transitions, retryAttemptsTotal: this.retries, reconnectsTotal: this.reconnects, failuresTotal: this.failures, lastError: this.lastError });
    return Object.freeze({ endpointIds: this.endpointIds, connector, framesReceivedTotal: this.received, framesDeliveredTotal: this.delivered, framesDroppedTotal: this.dropped, discontinuitiesTotal: this.discontinuities, endpointFailuresTotal: this.endpointFailures });
  }
}

/** Finite lifecycle, readiness, health, and recovery control for a Connector driver. */
export class ConnectorContext {
  readonly #runtime: RuntimeState;
  /** Cancels when this prepared Connector group is aborted or closed. */ public readonly signal: AbortSignal;
  /** @internal */ public constructor(runtime: RuntimeState) { this.#runtime = runtime; this.signal = runtime.controller.signal; }
  public get stopRequested(): boolean { this.#ensureActive(); return this.signal.aborted || this.#runtime.shutdownMode !== undefined; }
  public get shutdownMode(): ConnectorShutdownMode | undefined { this.#ensureActive(); return this.#runtime.shutdownMode; }
  public setReady(): boolean { this.#ensureActive(); return this.#runtime.transition(() => { this.#runtime.status.deliveryReadiness = 'ready'; delete this.#runtime.status.readinessReasonCode; }); }
  public setNotReady(reasonCode?: string): boolean { this.#ensureActive(); if (reasonCode !== undefined) requiredReason(reasonCode); return this.#runtime.transition(() => { this.#runtime.status.deliveryReadiness = 'not-ready'; this.#runtime.status.readinessReasonCode = reasonCode; }); }
  public setDegraded(reasonCode: string): boolean { this.#ensureActive(); requiredReason(reasonCode); return this.#runtime.transition(() => { this.#runtime.status.health = 'degraded'; this.#runtime.status.healthReasonCode = reasonCode; }); }
  public setHealthy(): boolean { this.#ensureActive(); return this.#runtime.transition(() => { this.#runtime.status.health = 'healthy'; delete this.#runtime.status.healthReasonCode; }); }
  public setReconnecting(reasonCode: string): boolean { this.#ensureActive(); requiredReason(reasonCode); const changed = this.#runtime.transition(() => { this.#runtime.status.recovery = 'reconnecting'; this.#runtime.status.recoveryReasonCode = reasonCode; }); if (changed) this.#runtime.reconnects += 1n; return changed; }
  public setConnected(): boolean { this.#ensureActive(); return this.#runtime.transition(() => { this.#runtime.status.recovery = 'idle'; delete this.#runtime.status.recoveryReasonCode; }); }
  public recordRetry(): void { this.#ensureActive(); this.#runtime.retries += 1n; }
  #ensureActive(): void { if (!this.#runtime.active) throw new ConnectorError('Connector context is no longer active', { code: 'connector.context_closed', stage: 'shutdown' }); }
}

/** Provider behavior for Core-owned polling and one-at-a-time delivery. */
export abstract class ConnectorDriver {
  public start(context: ConnectorContext): void | Promise<void> { context.setReady(); }
  public abstract deliver(item: ConnectorItem, context: ConnectorContext): ConnectorDeliveryOutcome | void | Promise<ConnectorDeliveryOutcome | void>;
  public idle(_context: ConnectorContext): void | Promise<void> {}
  public shutdown(_mode: ConnectorShutdownMode, _context: ConnectorContext): void | Promise<void> {}
  public cancelPreparation(): void | Promise<void> {}
}

/** Provider behavior for finite batches while Core retains receiver ownership. */
export abstract class ConnectorWorker {
  public start(context: ConnectorContext): void | Promise<void> { context.setReady(); }
  public abstract deliverBatch(items: readonly ConnectorItem[], context: ConnectorContext): ConnectorBatchOutcome | Promise<ConnectorBatchOutcome>;
  public idle(_context: ConnectorContext): void | Promise<void> {}
  public shutdown(_mode: ConnectorShutdownMode, _context: ConnectorContext): void | Promise<void> {}
  public cancelPreparation(): void | Promise<void> {}
}

/** One result for a batch, or one result per item. */
export type ConnectorBatchOutcome = ConnectorDeliveryOutcome | readonly ConnectorDeliveryOutcome[] | void;
/** Build one Connector driver for a prepared input group. */
export type ConnectorDriverBuilder = (inputs: readonly ConnectorInputDescriptor[]) => ConnectorDriver | Promise<ConnectorDriver>;
/** Build one finite-batch Connector worker for a prepared input group. */
export type ConnectorWorkerBuilder = (inputs: readonly ConnectorInputDescriptor[]) => ConnectorWorker | Promise<ConnectorWorker>;
/** Driver factory with optional preparation grouping. */
export interface ConnectorDriverFactory { prepare(inputs: readonly ConnectorInputDescriptor[]): ConnectorDriver | Promise<ConnectorDriver>; preparationGroup?(routeId: bigint, configuration: Readonly<Record<string, ConnectorConfigurationValue>>): string | undefined; }
/** Batch-worker factory with optional preparation grouping. */
export interface ConnectorFactory { prepare(inputs: readonly ConnectorInputDescriptor[]): ConnectorWorker | Promise<ConnectorWorker>; preparationGroup?(routeId: bigint, configuration: Readonly<Record<string, ConnectorConfigurationValue>>): string | undefined; }
/** Handler used by `Connector.fromHandler()`. */
export type ConnectorHandler = (item: ConnectorItem, context: ConnectorContext) => ConnectorDeliveryOutcome | void | Promise<ConnectorDeliveryOutcome | void>;
/** PCM-only handler used by `Connector.fromAudioHandler()`. */
export type AudioConnectorHandler = (frame: ConnectorAudioFrame, context: ConnectorContext) => ConnectorDeliveryOutcome | void | Promise<ConnectorDeliveryOutcome | void>;
/** Optional preparation grouping callback. */
export type ConnectorPreparationGroup = (routeId: bigint, configuration: Readonly<Record<string, ConnectorConfigurationValue>>) => string | undefined;

/** Finite waits for asynchronous Connector work. */
export interface ConnectorDeadlines { readonly prepareMs?: number; readonly startMs?: number; readonly deliveryMs?: number; readonly shutdownMs?: number; }
interface ResolvedDeadlines { prepareMs: number; startMs: number; deliveryMs: number; shutdownMs: number; }
interface AdvancedConnector { readonly manifest: ConnectorManifest; readonly factory: ConnectorDriverFactory | ConnectorDriverBuilder | ConnectorFactory | ConnectorWorkerBuilder; readonly worker: boolean; readonly maximumBatchItems: number; readonly deadlines: ResolvedDeadlines; }

/** Finite native-to-JavaScript dispatch settings for the concise PCM form. */
export interface ConnectorOptions { readonly deadlineMs?: number; readonly capacityFrames?: number; }
/** Function accepted by the concise Connector form. */
export type ConnectorSend = (frame: ConnectorAudioFrame, context: ConnectorContext) => void | Promise<void>;

/** Application-owned destination with concise PCM and full manifest-driven forms. */
export abstract class Connector {
  readonly #deadlineMs: number; readonly #capacityFrames: number; #sessionId?: bigint;
  #connectorId?: bigint;
  #controller = new AbortController(); #state: 'new' | 'starting' | 'running' | 'stopping' | 'closed' = 'new';
  #advanced?: AdvancedConnector; readonly #runtimes: RuntimeState[] = [];
  readonly #declarations = new Map<bigint, { configuration: Readonly<Record<string, ConnectorConfigurationValue>>; route: RouteSettings }>();
  protected constructor(options: ConnectorOptions = {}) {
    this.#deadlineMs = options.deadlineMs ?? 5_000; this.#capacityFrames = options.capacityFrames ?? 8;
    deadline('deadlineMs', this.#deadlineMs, 60_000); if (!Number.isInteger(this.#capacityFrames) || this.#capacityFrames < 1 || this.#capacityFrames > 63) throw new RangeError('capacityFrames must be an integer from 1 through 63');
  }
  public start(_context: ConnectorContext): void | Promise<void> {}
  public abstract send(frame: ConnectorAudioFrame, context: ConnectorContext): void | Promise<void>;
  public stop(_mode: ConnectorShutdownMode, _context: ConnectorContext): void | Promise<void> {}
  /** Full manifest for an advanced Connector. */ public get manifest(): ConnectorManifest { if (this.#advanced === undefined) throw new TypeError('Concise Connectors receive an internal manifest during Session registration'); return this.#advanced.manifest; }
  /** Driver or worker factory for an advanced Connector. */ public get factory(): AdvancedConnector['factory'] { if (this.#advanced === undefined) throw new TypeError('Concise Connectors receive an internal factory during Session registration'); return this.#advanced.factory; }
  public static withDriver(manifest: ConnectorManifest, factory: ConnectorDriverFactory | ConnectorDriverBuilder, options: { deadlines?: ConnectorDeadlines } = {}): Connector { return advancedConnector(manifest, factory, false, 1, options.deadlines); }
  public static withWorker(manifest: ConnectorManifest, factory: ConnectorFactory | ConnectorWorkerBuilder, options: { maximumBatchItems?: number; deadlines?: ConnectorDeadlines } = {}): Connector { const maximum = options.maximumBatchItems ?? 32; if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1024) throw new RangeError('maximumBatchItems must be between 1 and 1024'); return advancedConnector(manifest, factory, true, maximum, options.deadlines); }
  public static fromHandler(manifest: ConnectorManifest, handler: ConnectorHandler, options: { deadlines?: ConnectorDeadlines } = {}): Connector { return Connector.withDriver(manifest, () => new (class extends ConnectorDriver { public deliver(item: ConnectorItem, context: ConnectorContext) { return handler(item, context); } })(), options); }
  public static fromAudioHandler(operatorId: string, handler: AudioConnectorHandler, options: { packageVersion: string; portName?: string; deadlines?: ConnectorDeadlines }): Connector {
    return Connector.fromHandler(ConnectorManifest.audio(operatorId, { packageVersion: options.packageVersion, portName: options.portName }), (item, context) => { if (item.kind !== 'audio') throw new ConnectorError('Audio Connector received a non-audio item', { code: 'connector.delivery.signal_mismatch', stage: 'delivery' }); return handler(item.audio, context); }, { deadlines: options.deadlines });
  }
  /** @internal */ public _isAdvanced(): boolean { return this.#advanced !== undefined; }
  /** @internal */ public _usesWorker(): boolean { return this.#advanced?.worker ?? false; }
  /** @internal */ public _setAdvanced(value: AdvancedConnector): void { this.#advanced = value; }
  /** @internal */ public _bind(sessionId: bigint, connectorId: bigint): void { if (this.#sessionId !== undefined && this.#sessionId !== sessionId) throw new TypeError('A Connector object cannot be shared by different Sessions'); if (this.#state === 'closed') throw new TypeError('A closed Connector cannot be registered again'); if (this.#connectorId !== undefined && this.#connectorId !== connectorId) throw new TypeError('A Connector identity cannot change inside one Session'); this.#sessionId = sessionId; this.#connectorId = connectorId; }
  /** @internal */ public _deadline(): number { return this.#advanced === undefined ? this.#deadlineMs : Math.max(...Object.values(this.#advanced.deadlines)); }
  /** @internal */ public _capacityFrames(): number { return this.#capacityFrames; }
  /** @internal */ public _abort(reason?: unknown): void { if (!this.#controller.signal.aborted) this.#controller.abort(reason); for (const runtime of this.#runtimes) if (!runtime.controller.signal.aborted) runtime.controller.abort(reason); }
  /** @internal */ public _trackDeclaration(endpointId: bigint, configuration: ConnectorConfigurationInput, route: RouteSettings): void { this.#declarations.set(endpointId, { configuration: this.manifest.configuration.configuration(configuration), route }); }
  /** @internal */ public _observations(): readonly ConnectorRuntimeObservations[] { return Object.freeze(this.#runtimes.map((runtime) => runtime.snapshot())); }
  /** @internal */ public _observation(endpointId: bigint): ConnectorObservations | undefined { return this.#runtimes.find((runtime) => runtime.endpointIds.includes(endpointId))?.snapshot().connector; }
  /** @internal */ public _endpointFactoryOptions(): EndpointFactoryOptions {
    const advanced = this.#advanced; if (advanced === undefined) throw new TypeError('Concise Connector has no advanced Endpoint factory');
    const group = preparationGroup(advanced.factory);
    return { id: advanced.manifest.operatorId, nodeType: advanced.manifest.nodeTypeId, inputs: advanced.manifest.inputs,
      deadlineMs: Math.max(...Object.values(advanced.deadlines)), maximumBatchItems: advanced.worker ? advanced.maximumBatchItems : 1,
      validate: (configuration) => { advanced.manifest.configuration._decode(configuration); },
      preparationGroup: group === undefined ? () => undefined : (routeId, configuration) => group(routeId, advanced.manifest.configuration._decode(configuration)),
      create: (configuration, nativeInputs) => this.#createAdvancedNode(advanced, configuration, nativeInputs) };
  }
  #createAdvancedNode(advanced: AdvancedConnector, encoded: SourceConfiguration, nativeInputs: readonly NativeEndpointInputDescriptor[]): EndpointNode {
    const configuration = advanced.manifest.configuration._decode(encoded);
    const descriptors = nativeInputs.map((input): ConnectorInputDescriptor => {
      const endpointId = BigInt(input.endpointId); const port = advanced.manifest.inputs.find((candidate) => candidate.name === input.portName);
      if (port === undefined) throw new ConnectorError(`Connector received undeclared input ${input.portName}`, { code: 'connector.prepare.undeclared_input', stage: 'prepare' });
      const declaration = this.#declarations.get(endpointId); const route = declaration?.route ?? defaultRoute(advanced.manifest);
      return Object.freeze({ endpointId, ...(input.connectorId == null ? {} : { connectorId: BigInt(input.connectorId) }), routeId: BigInt(input.routeId), portName: input.portName, signalWireId: port.signal.wireId, signal: port.signal, media: port.media, routeSettings: route, configuration: declaration?.configuration ?? configuration });
    });
    const runtime = new RuntimeState(descriptors.map((input) => input.endpointId)); this.#runtimes.push(runtime); const context = new ConnectorContext(runtime);
    let implementation: ConnectorDriver | ConnectorWorker | undefined; let started = false;
    const byEndpointPort = new Map(descriptors.map((input) => [`${input.endpointId}:${input.portName}`, input]));
    const convert = (item: EndpointItem): ConnectorItem => {
      const descriptor = byEndpointPort.get(`${item.endpointId}:${item.input}`);
      if (descriptor === undefined) throw runtime.fail(new Error('Connector input descriptor is unavailable'), 'delivery');
      return item.kind === 'audio'
        ? Object.freeze({ kind: 'audio', input: descriptor, audio: Object.freeze({ ...item.frame, connectorId: descriptor.connectorId, endpointId: descriptor.endpointId, routeId: descriptor.routeId }) })
        : Object.freeze({ kind: 'signal', input: descriptor, signal: item.signal });
    };
    const deliver = async (items: readonly EndpointItem[]): Promise<ConnectorDeliveryOutcome[]> => {
      if (implementation === undefined) throw runtime.fail(new Error('Connector implementation is unavailable'), 'delivery');
      const converted = Object.freeze(items.map(convert));
      runtime.received += BigInt(converted.length);
      for (const item of converted) recordDiscontinuity(runtime, item);
      try {
        if (advanced.worker) {
          const result = await within(Promise.resolve((implementation as ConnectorWorker).deliverBatch(converted, context)), advanced.deadlines.deliveryMs, 'delivery');
          const outcomes = Array.isArray(result) ? result : converted.map(() => result);
          if (outcomes.length !== converted.length) throw new ConnectorError('Connector worker returned the wrong number of outcomes', { code: 'javascript.invalid_batch_outcome_count', stage: 'delivery' });
          for (const outcome of outcomes) { if (outcome === 'dropped') runtime.dropped += 1n; else runtime.delivered += 1n; }
          return outcomes.map((outcome) => outcome === 'dropped' ? 'dropped' : 'delivered');
        } else {
          const outcomes: ConnectorDeliveryOutcome[] = [];
          for (const item of converted) {
            const outcome = await within(Promise.resolve((implementation as ConnectorDriver).deliver(item, context)), advanced.deadlines.deliveryMs, 'delivery');
            if (outcome === 'dropped') { runtime.dropped += 1n; outcomes.push('dropped'); } else { runtime.delivered += 1n; outcomes.push('delivered'); }
          }
          return outcomes;
        }
      } catch (failure) { throw nativeConnectorError(runtime.fail(failure, 'delivery')); }
    };
    return {
      prepare: async () => { try { implementation = await within(resolvePrepare(advanced.factory, descriptors), advanced.deadlines.prepareMs, 'prepare'); return { idleEnabled: advanced.worker ? implementation.idle !== ConnectorWorker.prototype.idle : implementation.idle !== ConnectorDriver.prototype.idle }; } catch (failure) { throw nativeConnectorError(runtime.fail(failure, 'prepare')); } },
      start: async () => { if (implementation === undefined) throw nativeConnectorError(runtime.fail(new Error('Connector implementation was not prepared'), 'startup')); try { await within(Promise.resolve(implementation.start(context)), advanced.deadlines.startMs, 'startup'); started = true; } catch (failure) { throw nativeConnectorError(runtime.fail(failure, 'startup')); } },
      receive: async (item: EndpointItem) => (await deliver([item]))[0],
      receiveBatch: advanced.worker ? deliver : undefined,
      idle: async () => { if (implementation === undefined) throw nativeConnectorError(runtime.fail(new Error('Connector implementation was not prepared'), 'delivery')); try { await within(Promise.resolve(implementation.idle(context)), advanced.deadlines.deliveryMs, 'delivery'); } catch (failure) { throw nativeConnectorError(runtime.fail(failure, 'delivery')); } },
      stop: async (mode) => { runtime.shutdownMode = mode; if (mode === 'abort' && !runtime.controller.signal.aborted) runtime.controller.abort(); if (implementation === undefined) return; try { if (!started) await within(Promise.resolve(implementation.cancelPreparation()), advanced.deadlines.shutdownMs, 'prepare'); else await within(Promise.resolve(implementation.shutdown(mode, context)), advanced.deadlines.shutdownMs, 'shutdown'); } catch (failure) { throw nativeConnectorError(runtime.fail(failure, started ? 'shutdown' : 'prepare')); } },
      close: () => { runtime.active = false; if (!runtime.controller.signal.aborted) runtime.controller.abort(); },
    };
  }
  /** @internal */ public readonly _dispatch = async (request: NativeProviderCall): Promise<NativeProviderResult> => {
    const runtime = new RuntimeState([], this.#controller); const context = new ConnectorContext(runtime);
    switch (request.operation) {
      case 'start': this.#state = 'starting'; await this.start(context); context.setReady(); this.#state = 'running'; return {};
      case 'send': if (this.#state !== 'running' || request.audio == null) throw new Error('Connector received audio outside its running lifetime'); await this.send(_audioFrameFromNative(request.audio), context); return { outcome: 'delivered' };
      case 'stop': { if (this.#state === 'closed') return {}; const mode: ConnectorShutdownMode = this.#controller.signal.aborted ? 'abort' : 'drain'; this.#state = 'stopping'; try { await this.stop(mode, context); } finally { this.#state = 'closed'; } return {}; }
      default: throw new Error(`Unsupported Connector operation: ${request.operation}`);
    }
  };
}

/** Session-bound registration that can declare multiple configured destinations. */
export class RegisteredConnector {
  readonly #sessionId: bigint; readonly #connector: Connector; readonly #declare: (configuration: ConnectorConfigurationInput, route: RouteSettings) => Endpoint;
  /** @internal */ public constructor(sessionId: bigint, connector: Connector, declare: (configuration: ConnectorConfigurationInput, route: RouteSettings) => Endpoint) { this.#sessionId = sessionId; this.#connector = connector; this.#declare = declare; }
  public get sessionId(): bigint { return this.#sessionId; }
  public declare(configuration: ConnectorConfigurationInput = {}, options: { routeSettings?: RouteSettings } = {}): Endpoint { const route = options.routeSettings ?? defaultRoute(this.#connector.manifest); this.#connector.manifest.configuration.configuration(configuration); const endpoint = this.#declare(configuration, route); this.#connector._trackDeclaration(endpoint.id, configuration, route); return endpoint; }
  public observations(): readonly ConnectorRuntimeObservations[] { return this.#connector._observations(); }
  public observation(endpoint: Endpoint): ConnectorObservations | undefined { return this.#connector._observation(endpoint.id); }
}

/** Create a concise PCM Connector from one delivery function. */
export function connector(send: ConnectorSend, options?: ConnectorOptions): Connector;
/** Decorate an advanced item handler with a manifest. */
export function connector(manifest: ConnectorManifest, options?: { deadlines?: ConnectorDeadlines }): (handler: ConnectorHandler) => Connector;
export function connector(first: ConnectorSend | ConnectorManifest, options: ConnectorOptions | { deadlines?: ConnectorDeadlines } = {}): Connector | ((handler: ConnectorHandler) => Connector) {
  if (first instanceof ConnectorManifest) return (handler) => Connector.fromHandler(first, handler, options as { deadlines?: ConnectorDeadlines });
  return new (class extends Connector { public constructor() { super(options as ConnectorOptions); } public send(frame: ConnectorAudioFrame, context: ConnectorContext) { return first(frame, context); } })();
}

/** @internal */
export function _audioFrameFromNative(value: NativeProviderAudio): ConnectorAudioFrame {
  const bytes = value.samplesF32Le;
  return Object.freeze({ samples: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), sampleRateHz: value.sampleRateHz, channels: value.channelCount, sourceId: BigInt(value.sourceId), streamId: BigInt(value.streamId), sequenceNumber: BigInt(value.sequenceNumber), timestampNs: BigInt(value.timestampNs), routeEnqueuedAtNs: BigInt(value.routeEnqueuedAtNs), routeReceivedAtNs: BigInt(value.routeReceivedAtNs), sourceGeneration: value.sourceGeneration, discontinuityEpoch: BigInt(value.discontinuityEpoch), permissionEpoch: BigInt(value.permissionEpoch), clockId: value.clockId, durationNs: BigInt(value.durationNs), ...(value.outputGenerationId == null ? {} : { outputGenerationId: BigInt(value.outputGenerationId) }), ...(value.connectorId == null ? {} : { connectorId: BigInt(value.connectorId) }) });
}

function advancedConnector(manifest: ConnectorManifest, factory: AdvancedConnector['factory'], worker: boolean, maximumBatchItems: number, deadlines?: ConnectorDeadlines): Connector { const value = new (class extends Connector { public constructor() { super(); } public send(): never { throw new ConnectorError('Advanced Connector delivery uses its declared driver', { code: 'connector.delivery.invalid_path', stage: 'delivery' }); } })(); value._setAdvanced({ manifest, factory, worker, maximumBatchItems, deadlines: resolveDeadlines(deadlines) }); return value; }
function preparationGroup(factory: AdvancedConnector['factory']): ConnectorPreparationGroup | undefined { return typeof factory === 'function' ? undefined : factory.preparationGroup?.bind(factory); }
async function resolvePrepare(factory: AdvancedConnector['factory'], inputs: readonly ConnectorInputDescriptor[]): Promise<ConnectorDriver | ConnectorWorker> { return typeof factory === 'function' ? factory(inputs) : factory.prepare(inputs); }
function resolveDeadlines(value: ConnectorDeadlines = {}): ResolvedDeadlines { const result = { prepareMs: value.prepareMs ?? 5_000, startMs: value.startMs ?? 5_000, deliveryMs: value.deliveryMs ?? 30_000, shutdownMs: value.shutdownMs ?? 5_000 }; for (const [name, amount] of Object.entries(result)) deadline(name, amount, 300_000); return result; }
async function within<T>(promise: Promise<T>, milliseconds: number, stage: ConnectorErrorStage): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ConnectorError(`Connector ${stage} exceeded ${milliseconds} milliseconds`, { code: 'javascript.connector.timeout', stage, retryability: 'retryable' })), milliseconds); })]); } finally { if (timer !== undefined) clearTimeout(timer); } }
function asConnectorError(error: unknown, stage: ConnectorErrorStage): ConnectorError { return error instanceof ConnectorError ? error : new ConnectorError(error instanceof Error ? error.message : String(error), { code: 'javascript.connector_failed', stage, cause: error }); }
function nativeConnectorError(error: ConnectorError): Error { return new Error(`PKSCE1:${error.code}:${error.stage}:${error.retryability}:${error.message}`); }
function configurationError(code: string, message: string): ConnectorError { return new ConnectorError(message, { code, stage: 'configuration', retryability: 'retry-after-reconfiguration' }); }
function coerceConfigurationValue(kind: ConnectorConfigurationValueKind, value: ConnectorConfigurationValue | string | boolean | number | bigint): ConnectorConfigurationValue { if (value instanceof ConnectorConfigurationValue) { if (value.kind !== kind) throw configurationError('connector.configuration.type_mismatch', `Configuration value is ${value.kind}, expected ${kind}`); return value; } switch (kind) { case 'text': if (typeof value === 'string') return ConnectorConfigurationValue.text(value); break; case 'boolean': if (typeof value === 'boolean') return ConnectorConfigurationValue.boolean(value); break; case 'signed-integer': if (typeof value === 'number' || typeof value === 'bigint') return ConnectorConfigurationValue.signedInteger(value); break; case 'unsigned-integer': if (typeof value === 'number' || typeof value === 'bigint') return ConnectorConfigurationValue.unsignedInteger(value); break; case 'duration-milliseconds': if (typeof value === 'number' || typeof value === 'bigint') return ConnectorConfigurationValue.durationMilliseconds(value); break; case 'byte-count': if (typeof value === 'number' || typeof value === 'bigint') return ConnectorConfigurationValue.byteCount(value); break; } throw configurationError('connector.configuration.type_mismatch', `Configuration value cannot be represented as ${kind}`); }
function decodeConfigurationValue(kind: ConnectorConfigurationValueKind, encoded: string): ConnectorConfigurationValue { switch (kind) { case 'text': return ConnectorConfigurationValue.text(encoded); case 'boolean': if (encoded !== 'true' && encoded !== 'false') throw configurationError('connector.configuration.type_mismatch', 'Boolean configuration must be true or false'); return ConnectorConfigurationValue.boolean(encoded === 'true'); case 'signed-integer': return ConnectorConfigurationValue.signedInteger(BigInt(encoded)); case 'unsigned-integer': return ConnectorConfigurationValue.unsignedInteger(BigInt(encoded)); case 'duration-milliseconds': return ConnectorConfigurationValue.durationMilliseconds(BigInt(encoded)); case 'byte-count': return ConnectorConfigurationValue.byteCount(BigInt(encoded)); case 'secret': return ConnectorConfigurationValue.secret(encoded); } }
function validateConstraints(field: ConnectorConfigurationField, value: ConnectorConfigurationValue): void { for (const constraint of field.constraints) { const spec = constraint._spec; const raw = value.kind === 'secret' ? value.exposeSecret() : value.value; let valid = true; if (spec.kind === 'non-empty') valid = typeof raw === 'string' && raw.length > 0; else if (spec.kind === 'text-length-bytes') { const size = typeof raw === 'string' ? Buffer.byteLength(raw) : -1; valid = size >= spec.minimum && size <= spec.maximum; } else if (spec.kind === 'signed-range' || spec.kind === 'unsigned-range') valid = typeof raw === 'bigint' && raw >= spec.minimum && raw <= spec.maximum; else if (spec.kind === 'one-of') valid = typeof raw === 'string' && spec.values.includes(raw); if (!valid) throw configurationError('connector.configuration.constraint_failed', `Connector configuration field ${field.name} violates ${spec.kind}`); } }
function recordDiscontinuity(runtime: RuntimeState, item: ConnectorItem): void { const epoch = item.kind === 'audio' ? item.audio.discontinuityEpoch : item.signal.lineage?.discontinuityEpoch; if (epoch === undefined) return; const prior = runtime.lastDiscontinuities.get(item.input.routeId); if (prior !== undefined && prior !== epoch) runtime.discontinuities += 1n; runtime.lastDiscontinuities.set(item.input.routeId, epoch); }
function defaultRoute(manifest: ConnectorManifest): RouteSettings { return manifest.inputs.length === 1 && manifest.inputs[0]?.signal.isAudio ? graph.RouteSettings.realtimeAudio() : graph.RouteSettings.buffered(); }
function integer(value: bigint | number, signed: boolean): bigint { if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError('Connector integer must be a safe integer or bigint'); const result = BigInt(value); if (!signed && result < 0n) throw new RangeError('Connector unsigned integer cannot be negative'); if (signed && (result < -(2n ** 63n) || result > 2n ** 63n - 1n)) throw new RangeError('Connector signed integer exceeds i64'); if (!signed && result > 2n ** 64n - 1n) throw new RangeError('Connector unsigned integer exceeds u64'); return result; }
function positiveInteger(name: string, value: number): void { if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`); }
function deadline(name: string, value: number, maximum: number): void { if (!Number.isInteger(value) || value < 1 || value > maximum) throw new RangeError(`${name} must be an integer from 1 through ${maximum}`); }
function finiteRange(minimum: number, maximum: number, name: string): void { if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 0 || minimum > maximum) throw new RangeError(`${name} range is invalid`); }
function requiredReason(value: string): void { if (value.trim().length === 0) throw new TypeError('Connector reason code cannot be empty'); }
function boundedErrorMessage(value: string): string { if (value.trim().length === 0) return 'Connector failed without an error message'; return Buffer.from(value).subarray(0, 4096).toString(); }
function validateManifestEntries<T extends ConnectorCapability | ConnectorRequirement>(entries: readonly T[], name: string): readonly T[] { if (entries.length > 128) throw new RangeError(`Connector ${name} entries cannot exceed 128`); const ids = new Set<string>(); for (const entry of entries) { if (entry.id.trim().length === 0 || entry.documentation.trim().length === 0) throw new TypeError(`Connector ${name} requires an id and documentation`); if (ids.has(entry.id)) throw new TypeError(`Duplicate Connector ${name} ${entry.id}`); ids.add(entry.id); } return Object.freeze([...entries]); }
