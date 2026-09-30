import { PocketStationError } from '../errors.js';
import {
  EndpointConfiguration,
  EndpointDefinition,
  MediaCaps,
  PortSpec,
  RouteSettings,
  SignalSpec,
  type Configuration,
} from './graph.js';
import type { EndpointFailureStage } from './events.js';
import {
  ConnectorId,
  EndpointId,
  RouteId,
  RuntimeSessionId,
  SourceId,
  StemId,
  StreamId,
} from './identity.js';
import {
  EndpointFactory,
  type EndpointContext,
  type EndpointDeliveryOutcome,
  type EndpointItem,
  type EndpointNode,
  type SourceConfiguration,
} from './provider.js';
import type {
  NativeEndpointDriverObservations,
  NativeEndpointInputDescriptor,
} from './native.js';
import type { Endpoint } from './session.js';

/** String and explicitly redacted values accepted by an Endpoint declaration. */
export type EndpointConfigurationInput = Configuration | EndpointConfiguration;

/** Finite shutdown policy selected by Core for an Endpoint runtime. */
export const EndpointShutdownMode = { Drain: 'drain', Abort: 'abort' } as const;
export type EndpointShutdownMode =
  (typeof EndpointShutdownMode)[keyof typeof EndpointShutdownMode];

/** Retry guidance retained with a structured Endpoint failure. */
export const EndpointFailureRetryability = {
  NEVER: 'never',
  RETRYABLE: 'retryable',
  RECONFIGURATION_REQUIRED: 'reconfiguration-required',
  /** @deprecated Use `NEVER`. */
  Never: 'never',
  /** @deprecated Use `RETRYABLE`. */
  Retryable: 'retryable',
  /** @deprecated Use `RECONFIGURATION_REQUIRED`. */
  ReconfigurationRequired: 'reconfiguration-required',
} as const;
export type EndpointFailureRetryability =
  (typeof EndpointFailureRetryability)[keyof typeof EndpointFailureRetryability];

/** Failure raised by an application-authored Endpoint lifecycle. */
export class EndpointDriverError extends PocketStationError {
  public readonly stage: EndpointFailureStage;
  public readonly retryability: EndpointFailureRetryability;

  public constructor(
    message: string,
    options: {
      readonly code?: string;
      readonly stage?: EndpointFailureStage;
      readonly retryability?: EndpointFailureRetryability;
      readonly cause?: unknown;
    } = {},
  ) {
    const code = options.code ?? 'javascript.endpoint_failure';
    if (code.trim().length === 0) throw new TypeError('Endpoint error code cannot be empty');
    super(code, boundedMessage(message), { cause: options.cause });
    this.name = 'EndpointDriverError';
    this.stage = options.stage ?? 'prepare';
    this.retryability = options.retryability ?? 'never';
  }
}

/** Immutable counters returned by one application-owned Endpoint runtime. */
export class EndpointDriverObservations {
  public readonly framesReceivedTotal: bigint;
  public readonly framesDeliveredTotal: bigint;
  public readonly framesDroppedTotal: bigint;
  public readonly discontinuitiesTotal: bigint;
  public readonly failuresTotal: bigint;

  public constructor(options: {
    readonly framesReceivedTotal?: bigint | number;
    readonly framesDeliveredTotal?: bigint | number;
    readonly framesDroppedTotal?: bigint | number;
    readonly discontinuitiesTotal?: bigint | number;
    readonly failuresTotal?: bigint | number;
  } = {}) {
    this.framesReceivedTotal = counter(options.framesReceivedTotal ?? 0n, 'framesReceivedTotal');
    this.framesDeliveredTotal = counter(options.framesDeliveredTotal ?? 0n, 'framesDeliveredTotal');
    this.framesDroppedTotal = counter(options.framesDroppedTotal ?? 0n, 'framesDroppedTotal');
    this.discontinuitiesTotal = counter(options.discontinuitiesTotal ?? 0n, 'discontinuitiesTotal');
    this.failuresTotal = counter(options.failuresTotal ?? 0n, 'failuresTotal');
    Object.freeze(this);
  }
}

/** Compiler-visible identity and typed inputs for one generic Endpoint. */
export class EndpointManifest {
  public readonly operatorId: string;
  public readonly inputs: readonly PortSpec[];
  public readonly nodeTypeId: string;

  public constructor(options: {
    readonly operatorId: string;
    readonly inputs: readonly PortSpec[];
    readonly nodeTypeId?: string;
  }) {
    this.operatorId = exactIdentifier(options.operatorId, 'operatorId');
    this.nodeTypeId = exactIdentifier(options.nodeTypeId ?? options.operatorId, 'nodeTypeId');
    if (options.inputs.length === 0 || options.inputs.some((input) => input.direction !== 'input')) {
      throw new TypeError('Endpoint manifests require at least one input and cannot declare outputs');
    }
    const names = new Set<string>();
    for (const input of options.inputs) {
      if (names.has(input.name)) throw new TypeError(`Duplicate Endpoint input ${input.name}`);
      names.add(input.name);
    }
    this.inputs = Object.freeze([...options.inputs]);
    Object.freeze(this);
  }

  /** Build the common many-route PCM Endpoint manifest. */
  public static audio(
    operatorId: string,
    options: { readonly portName?: string; readonly nodeTypeId?: string } = {},
  ): EndpointManifest {
    return new EndpointManifest({
      operatorId,
      nodeTypeId: options.nodeTypeId,
      inputs: [PortSpec.input(options.portName ?? 'audio', SignalSpec.audio(), {
        media: MediaCaps.audio(),
        multiplicity: 'many',
      })],
    });
  }
}

/** Read-only Core transaction barrier supplied before delivery begins. */
export class EndpointStartGate {
  #open = false;
  public get isOpen(): boolean { return this.#open; }
  /** @internal */ public _open(): void { this.#open = true; }
}

/** Session-owned route identity and configuration for one Endpoint input. */
export class EndpointPrepareContext {
  public readonly sessionId: RuntimeSessionId;
  public readonly endpointId: EndpointId;
  public readonly connectorId?: ConnectorId;
  public readonly routeId: RouteId;
  public readonly originKind: string;
  public readonly sourceId?: SourceId;
  public readonly streamId?: StreamId;
  public readonly stemId?: StemId;
  public readonly sessionTimelineOriginNs: bigint;
  public readonly configuration: Readonly<Configuration>;
  public readonly signal: AbortSignal;

  /** @internal */
  public constructor(
    native: NativeEndpointInputDescriptor,
    configuration: Configuration,
    signal: AbortSignal,
  ) {
    this.sessionId = RuntimeSessionId(BigInt(required(native.sessionId, 'sessionId')));
    this.endpointId = EndpointId(BigInt(native.endpointId));
    this.connectorId = native.connectorId == null
      ? undefined
      : ConnectorId(BigInt(native.connectorId));
    this.routeId = RouteId(BigInt(native.routeId));
    this.originKind = required(native.originKind, 'originKind');
    this.sourceId = native.sourceId == null
      ? undefined
      : SourceId(BigInt(native.sourceId));
    this.streamId = native.streamId == null
      ? undefined
      : StreamId(BigInt(native.streamId));
    this.stemId = native.stemId == null
      ? undefined
      : StemId(BigInt(native.stemId));
    this.sessionTimelineOriginNs = BigInt(
      required(native.sessionTimelineOriginNs, 'sessionTimelineOriginNs'),
    );
    this.configuration = Object.freeze({ ...configuration });
    this.signal = signal;
    Object.freeze(this);
  }
}

/** One compiled input port and its exact Session route metadata. */
export class EndpointPortInput {
  public readonly portName: string;
  public readonly signal: SignalSpec;
  public readonly media: MediaCaps;
  public readonly routeSettings: RouteSettings;
  public readonly context: EndpointPrepareContext;

  /** @internal */
  public constructor(options: {
    readonly port: PortSpec;
    readonly routeSettings: RouteSettings;
    readonly context: EndpointPrepareContext;
  }) {
    this.portName = options.port.name;
    this.signal = options.port.signal;
    this.media = options.port.media;
    this.routeSettings = options.routeSettings;
    this.context = options.context;
    Object.freeze(this);
  }
}

/** One delivered item paired with the input that owns it. */
export interface EndpointDriverItem {
  readonly input: EndpointPortInput;
  readonly item: EndpointItem;
}

/** Prepared resources held behind Core's closed Session start barrier. */
export abstract class PreparedEndpointDriver {
  public abstract start(
    gate: EndpointStartGate,
  ): RunningEndpointDriver | Promise<RunningEndpointDriver>;
  public cancelPreparation(): void | Promise<void> {}
}

/** Active Endpoint resources owned through joined finalization. */
export abstract class RunningEndpointDriver {
  public abstract receive(
    delivery: EndpointDriverItem,
  ): EndpointDeliveryOutcome | void | Promise<EndpointDeliveryOutcome | void>;

  public async receiveBatch(
    deliveries: readonly EndpointDriverItem[],
  ): Promise<readonly EndpointDeliveryOutcome[]> {
    const outcomes: EndpointDeliveryOutcome[] = [];
    for (const delivery of deliveries) {
      const outcome = await this.receive(delivery);
      outcomes.push(outcome === 'dropped' ? 'dropped' : 'delivered');
    }
    return outcomes;
  }

  public idle(): void | Promise<void> {}
  public observations(): EndpointDriverObservations | Promise<EndpointDriverObservations> {
    return new EndpointDriverObservations();
  }
  /** Drain permits accepted deliveries until joinAndFinalize; abort rejects them. */
  public requestShutdown(_mode: EndpointShutdownMode): void | Promise<void> {}
  public joinAndFinalize(): EndpointDriverObservations | Promise<EndpointDriverObservations> {
    return this.observations();
  }
}

/** Build prepared Endpoint resources for one Core-selected input group. */
export type EndpointDriverBuilder = (
  inputs: readonly EndpointPortInput[],
) => PreparedEndpointDriver | Promise<PreparedEndpointDriver>;

/** Factory object form with optional preparation grouping. */
export interface EndpointDriverFactory {
  prepare(
    inputs: readonly EndpointPortInput[],
  ): PreparedEndpointDriver | Promise<PreparedEndpointDriver>;
  preparationGroup?(
    routeId: RouteId,
    configuration: Readonly<Configuration>,
  ): string | undefined;
}

/** Select route-local preparation or a stable shared group. */
export type EndpointPreparationGroup = (
  routeId: RouteId,
  configuration: Readonly<Configuration>,
) => string | undefined;

/** Finite waits for every asynchronous Endpoint lifecycle operation. */
export interface EndpointDeadlines {
  readonly prepareMs?: number;
  readonly startMs?: number;
  readonly deliveryMs?: number;
  readonly shutdownMs?: number;
}

interface ResolvedEndpointDeadlines {
  readonly prepareMs: number;
  readonly startMs: number;
  readonly deliveryMs: number;
  readonly shutdownMs: number;
}

/** Final application-owned observations for one prepared input group. */
export interface EndpointRuntimeObservations extends EndpointDriverObservations {
  readonly endpointIds: readonly EndpointId[];
  readonly finalized: boolean;
}

interface EndpointRuntime {
  readonly endpointIds: readonly EndpointId[];
  readonly controller: AbortController;
  observations: EndpointDriverObservations;
  finalized: boolean;
}

/** Reusable manifest-driven generic Endpoint implementation. */
export class EndpointProvider {
  public readonly manifest: EndpointManifest;
  public readonly factory: EndpointDriverFactory | EndpointDriverBuilder;
  public readonly deadlines: Readonly<Required<EndpointDeadlines>>;
  public readonly maximumBatchItems: number;
  public readonly idleEnabled: boolean;
  public readonly validateConfiguration?: (
    configuration: Readonly<Configuration>,
  ) => void | Promise<void>;
  public readonly preparationGroup?: EndpointPreparationGroup;

  readonly #declarations = new Map<EndpointId, {
    readonly configuration: Configuration;
    readonly route: RouteSettings;
  }>();
  readonly #runtimes: EndpointRuntime[] = [];
  #sessionId?: RuntimeSessionId;

  public constructor(options: {
    readonly manifest: EndpointManifest;
    readonly factory: EndpointDriverFactory | EndpointDriverBuilder;
    readonly deadlines?: EndpointDeadlines;
    readonly maximumBatchItems?: number;
    readonly idleEnabled?: boolean;
    readonly validateConfiguration?: (
      configuration: Readonly<Configuration>,
    ) => void | Promise<void>;
    readonly preparationGroup?: EndpointPreparationGroup;
  }) {
    this.manifest = options.manifest;
    this.factory = options.factory;
    this.deadlines = Object.freeze(resolveDeadlines(options.deadlines));
    this.maximumBatchItems = options.maximumBatchItems ?? 32;
    if (!Number.isInteger(this.maximumBatchItems) || this.maximumBatchItems < 1 || this.maximumBatchItems > 1_024) {
      throw new RangeError('maximumBatchItems must be an integer from 1 through 1024');
    }
    this.idleEnabled = options.idleEnabled ?? false;
    this.validateConfiguration = options.validateConfiguration;
    this.preparationGroup = options.preparationGroup ?? (
      typeof options.factory === 'function'
        ? undefined
        : options.factory.preparationGroup?.bind(options.factory)
    );
  }

  /** @internal */
  public _bind(sessionId: RuntimeSessionId): void {
    if (this.#sessionId !== undefined && this.#sessionId !== sessionId) {
      throw new TypeError('An Endpoint provider cannot be shared by different Sessions');
    }
    this.#sessionId = sessionId;
  }

  /** @internal */
  public _factory(): EndpointFactory {
    return new EndpointFactory({
      id: this.manifest.operatorId,
      nodeType: this.manifest.nodeTypeId,
      inputs: this.manifest.inputs,
      deadlineMs: Math.max(...Object.values(this.deadlines)),
      maximumBatchItems: this.maximumBatchItems,
      validate: async (configuration) => {
        await this.validateConfiguration?.(configuration);
      },
      preparationGroup: this.preparationGroup === undefined
        ? () => undefined
        : (routeId, configuration) => this.preparationGroup?.(
            RouteId(routeId),
            configuration,
          ),
      create: (configuration, nativeInputs) => this.#createNode(configuration, nativeInputs),
    });
  }

  /** @internal */
  public _track(
    endpointId: EndpointId,
    configuration: Configuration,
    route: RouteSettings,
  ): void {
    this.#declarations.set(endpointId, {
      configuration: Object.freeze({ ...configuration }),
      route,
    });
  }

  /** Runtime observations retained after finalization. */
  public observations(): readonly EndpointRuntimeObservations[] {
    return Object.freeze(this.#runtimes.map((runtime) => Object.freeze({
      ...runtime.observations,
      endpointIds: runtime.endpointIds,
      finalized: runtime.finalized,
    })));
  }

  #createNode(
    encodedConfiguration: SourceConfiguration,
    nativeInputs: readonly NativeEndpointInputDescriptor[],
  ): EndpointNode {
    const controller = new AbortController();
    const descriptors = nativeInputs.map((native): EndpointPortInput => {
      const port = this.manifest.inputs.find((candidate) => candidate.name === native.portName);
      if (port === undefined) {
        throw new EndpointDriverError(`Endpoint received undeclared input ${native.portName}`, {
          code: 'endpoint.prepare.undeclared_input',
        });
      }
      const endpointId = EndpointId(BigInt(native.endpointId));
      const declaration = this.#declarations.get(endpointId);
      const configuration = declaration?.configuration ?? encodedConfiguration;
      return new EndpointPortInput({
        port,
        routeSettings: declaration?.route ?? defaultRoute(this.manifest),
        context: new EndpointPrepareContext(native, configuration, controller.signal),
      });
    });
    const byRoute = new Map(descriptors.map((input) => [input.context.routeId, input]));
    const runtime: EndpointRuntime = {
      endpointIds: Object.freeze([...new Set(descriptors.map((input) => input.context.endpointId))]),
      controller,
      observations: new EndpointDriverObservations(),
      finalized: false,
    };
    this.#runtimes.push(runtime);
    let prepared: PreparedEndpointDriver | undefined;
    let running: RunningEndpointDriver | undefined;
    let gate: EndpointStartGate | undefined;
    let preparationCancelled = false;
    let shutdownRequested = false;
    let sessionSignalDisposer: (() => void) | undefined;
    let latePreparationCleanupStarted = false;
    let lateRunningCleanupStarted = false;

    const abortOnTimeout = (failure: EndpointDriverError): void => {
      if (!runtime.controller.signal.aborted) runtime.controller.abort(failure);
    };
    const cancelPrepared = async (value: PreparedEndpointDriver): Promise<void> => {
      if (preparationCancelled) return;
      preparationCancelled = true;
      await within(
        Promise.resolve(value.cancelPreparation()),
        this.deadlines.shutdownMs,
        'cancel-preparation',
        abortOnTimeout,
      );
    };
    const cancelLatePreparation = (value: PreparedEndpointDriver): void => {
      if (latePreparationCleanupStarted) return;
      latePreparationCleanupStarted = true;
      void cancelPrepared(value).catch(() => undefined);
    };
    const finalizeLateRunning = (value: RunningEndpointDriver): void => {
      if (lateRunningCleanupStarted) return;
      lateRunningCleanupStarted = true;
      void (async () => {
        try {
          await within(
            Promise.resolve(value.requestShutdown('abort')),
            this.deadlines.shutdownMs,
            'request-stop',
            abortOnTimeout,
          );
        } catch {
          // The Session already retains the start timeout as its primary failure.
        }
        try {
          runtime.observations = validateObservations(await within(
            Promise.resolve(value.joinAndFinalize()),
            this.deadlines.shutdownMs,
            'join-finalize',
            abortOnTimeout,
          ));
        } catch {
          // Late cleanup cannot replace the failure already returned to Core.
        }
      })();
    };

    const delivery = (item: EndpointItem): EndpointDriverItem => {
      const input = byRoute.get(RouteId(item.routeId));
      if (input === undefined || input.portName !== item.input) {
        throw new EndpointDriverError('Endpoint input metadata is unavailable', {
          code: 'endpoint.delivery.input_unavailable',
          stage: 'join-finalize',
        });
      }
      return Object.freeze({ input, item });
    };
    const receiveBatch = async (
      items: readonly EndpointItem[],
    ): Promise<readonly EndpointDeliveryOutcome[]> => {
      try {
        if (running === undefined) {
          throw new EndpointDriverError('Endpoint received data before startup', {
            code: 'endpoint.delivery.not_running',
            stage: 'join-finalize',
          });
        }
        const delivered = Object.freeze(items.map(delivery));
        const result = await within(
          Promise.resolve(running.receiveBatch(delivered)),
          this.deadlines.deliveryMs,
          'join-finalize',
          abortOnTimeout,
        );
        if (result.length !== delivered.length) {
          throw new EndpointDriverError('Endpoint returned the wrong number of delivery outcomes', {
            code: 'endpoint.delivery.invalid_outcome_count',
            stage: 'join-finalize',
          });
        }
        return result.map((outcome) => outcome === 'dropped' ? 'dropped' : 'delivered');
      } catch (failure) {
        throw nativeEndpointError(asEndpointError(failure, 'join-finalize'));
      }
    };

    return {
      prepare: async (context: EndpointContext) => {
        sessionSignalDisposer ??= forwardAbort(context.signal, runtime.controller);
        try {
          const preparation = Promise.resolve(
            resolvePrepare(this.factory, Object.freeze(descriptors)),
          );
          prepared = await within(
            preparation,
            this.deadlines.prepareMs,
            'prepare',
            abortOnTimeout,
            cancelLatePreparation,
          );
          return { idleEnabled: this.idleEnabled };
        } catch (failure) {
          throw nativeEndpointError(asEndpointError(failure, 'prepare'));
        }
      },
      start: async () => {
        if (prepared === undefined) {
          throw nativeEndpointError(new EndpointDriverError('Endpoint was not prepared', {
            code: 'endpoint.start.not_prepared',
            stage: 'start',
          }));
        }
        gate = new EndpointStartGate();
        try {
          const startup = Promise.resolve(prepared.start(gate));
          running = await within(
            startup,
            this.deadlines.startMs,
            'start',
            abortOnTimeout,
            finalizeLateRunning,
          );
        } catch (failure) {
          throw nativeEndpointError(asEndpointError(failure, 'start'));
        }
      },
      gateOpen: () => { gate?._open(); },
      receive: async (item) => (await receiveBatch([item]))[0],
      receiveBatch,
      idle: async () => {
        if (running === undefined) return;
        try {
          await within(
            Promise.resolve(running.idle()),
            this.deadlines.deliveryMs,
            'join-finalize',
            abortOnTimeout,
          );
        } catch (failure) {
          throw nativeEndpointError(asEndpointError(failure, 'join-finalize'));
        }
      },
      stop: async (mode) => {
        if (mode === 'abort' && !runtime.controller.signal.aborted) runtime.controller.abort();
        if (running !== undefined) {
          if (shutdownRequested) return;
          shutdownRequested = true;
          try {
            await within(
              Promise.resolve(running.requestShutdown(mode)),
              this.deadlines.shutdownMs,
              'request-stop',
              abortOnTimeout,
            );
          } catch (failure) {
            throw nativeEndpointError(asEndpointError(failure, 'request-stop'));
          }
        } else if (prepared !== undefined && !preparationCancelled) {
          try {
            await cancelPrepared(prepared);
          } catch (failure) {
            throw nativeEndpointError(asEndpointError(failure, 'cancel-preparation'));
          }
        }
      },
      close: async () => {
        try {
          if (running !== undefined) {
            runtime.observations = validateObservations(await within(
              Promise.resolve(running.joinAndFinalize()),
              this.deadlines.shutdownMs,
              'join-finalize',
              abortOnTimeout,
            ));
          } else if (prepared !== undefined && !preparationCancelled) {
            await cancelPrepared(prepared);
          }
        } catch (failure) {
          throw nativeEndpointError(asEndpointError(failure, 'join-finalize'));
        } finally {
          runtime.finalized = true;
          if (!runtime.controller.signal.aborted) runtime.controller.abort();
          sessionSignalDisposer?.();
        }
      },
      _finalObservations: () => nativeObservations(runtime.observations),
    };
  }
}

/** Session-bound registration that declares configured Endpoint instances. */
export class RegisteredEndpoint {
  readonly #sessionId: RuntimeSessionId;
  readonly #provider: EndpointProvider;
  readonly #declare: (
    definition: EndpointDefinition,
    configuration: Configuration,
    route: RouteSettings,
  ) => Endpoint;

  /** @internal */
  public constructor(
    sessionId: RuntimeSessionId,
    provider: EndpointProvider,
    declare: (
      definition: EndpointDefinition,
      configuration: Configuration,
      route: RouteSettings,
    ) => Endpoint,
  ) {
    this.#sessionId = sessionId;
    this.#provider = provider;
    this.#declare = declare;
  }

  public get sessionId(): RuntimeSessionId { return this.#sessionId; }

  public declare(
    configuration: EndpointConfigurationInput = {},
    options: { readonly routeSettings?: RouteSettings } = {},
  ): Endpoint {
    const values = configuration instanceof EndpointConfiguration
      ? configuration.toObject()
      : configuration;
    validateConfiguration(values);
    const route = options.routeSettings ?? defaultRoute(this.#provider.manifest);
    const definition = new EndpointDefinition(
      this.#provider.manifest.nodeTypeId,
      this.#provider.manifest.operatorId,
      { configuration: values, route },
    );
    const endpoint = this.#declare(definition, values, route);
    this.#provider._track(endpoint.id, values, route);
    return endpoint;
  }

  public observations(): readonly EndpointRuntimeObservations[] {
    return this.#provider.observations();
  }
}

function resolvePrepare(
  factory: EndpointDriverFactory | EndpointDriverBuilder,
  inputs: readonly EndpointPortInput[],
): PreparedEndpointDriver | Promise<PreparedEndpointDriver> {
  return typeof factory === 'function' ? factory(inputs) : factory.prepare(inputs);
}

function defaultRoute(manifest: EndpointManifest): RouteSettings {
  return manifest.inputs.length === 1 && manifest.inputs[0]?.signal.isAudio
    ? RouteSettings.realtimeAudio()
    : RouteSettings.buffered();
}

function validateConfiguration(configuration: Configuration): void {
  for (const [key, value] of Object.entries(configuration)) {
    if (key.length === 0 || key.trim() !== key) {
      throw new TypeError('Endpoint configuration keys must be non-empty and exact');
    }
    if (typeof value !== 'string' && (value == null || value.secret !== true || typeof value.value !== 'string')) {
      throw new TypeError(`Endpoint configuration value ${key} must be a string or explicit secret`);
    }
  }
}

function resolveDeadlines(value: EndpointDeadlines = {}): ResolvedEndpointDeadlines {
  const result = {
    prepareMs: value.prepareMs ?? 5_000,
    startMs: value.startMs ?? 5_000,
    deliveryMs: value.deliveryMs ?? 30_000,
    shutdownMs: value.shutdownMs ?? 5_000,
  };
  for (const [name, milliseconds] of Object.entries(result)) {
    if (!Number.isInteger(milliseconds) || milliseconds < 1 || milliseconds > 300_000) {
      throw new RangeError(`${name} must be an integer from 1 through 300000`);
    }
  }
  return result;
}

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  stage: EndpointFailureStage,
  onTimeout?: (failure: EndpointDriverError) => void,
  onLateResult?: (value: T) => void | Promise<void>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const failure = new EndpointDriverError(
            `Endpoint ${stage} exceeded ${milliseconds} milliseconds`,
            { code: 'javascript.endpoint.timeout', stage, retryability: 'retryable' },
          );
          onTimeout?.(failure);
          if (onLateResult !== undefined) {
            void promise.then(
              async (value) => { await onLateResult(value); },
              () => undefined,
            ).catch(() => undefined);
          }
          reject(failure);
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function forwardAbort(source: AbortSignal, target: AbortController): () => void {
  const abort = (): void => {
    if (!target.signal.aborted) target.abort(source.reason);
  };
  if (source.aborted) {
    abort();
    return () => undefined;
  }
  source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
}

function asEndpointError(error: unknown, stage: EndpointFailureStage): EndpointDriverError {
  return error instanceof EndpointDriverError
    ? error
    : new EndpointDriverError(error instanceof Error ? error.message : String(error), {
      code: 'javascript.endpoint_failed',
      stage,
      cause: error,
    });
}

function nativeEndpointError(error: EndpointDriverError): Error {
  return new Error(
    `PKSEE1:${error.code}:${error.stage}:${error.retryability}:${error.message}`,
  );
}

function validateObservations(value: EndpointDriverObservations): EndpointDriverObservations {
  return value instanceof EndpointDriverObservations
    ? value
    : new EndpointDriverObservations(value);
}

function boundedMessage(value: string): string {
  if (value.trim().length === 0) return 'Endpoint failed without an error message';
  return Buffer.from(value).subarray(0, 4_096).toString();
}

function exactIdentifier(value: string, name: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be non-empty and exact`);
  }
  return value;
}

function counter(value: bigint | number, name: string): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer or bigint`);
  }
  const result = BigInt(value);
  if (result < 0n) throw new RangeError(`${name} cannot be negative`);
  if (result > 18_446_744_073_709_551_615n) {
    throw new RangeError(`${name} cannot exceed the Core unsigned 64-bit counter range`);
  }
  return result;
}

function nativeObservations(
  value: EndpointDriverObservations,
): NativeEndpointDriverObservations {
  return {
    framesReceivedTotal: value.framesReceivedTotal.toString(),
    framesDeliveredTotal: value.framesDeliveredTotal.toString(),
    framesDroppedTotal: value.framesDroppedTotal.toString(),
    discontinuitiesTotal: value.discontinuitiesTotal.toString(),
    failuresTotal: value.failuresTotal.toString(),
  };
}

function required(value: string | null | undefined, name: string): string {
  if (value == null || value.length === 0) {
    throw new EndpointDriverError(`Endpoint ${name} is unavailable`, {
      code: 'endpoint.prepare.context_unavailable',
    });
  }
  return value;
}
