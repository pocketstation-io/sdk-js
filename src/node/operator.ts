import {
  DeliveryPolicy,
  LossPolicy,
  MediaCaps,
  Operator,
  OperatorConfiguration,
  PortSpec,
  RouteSettings,
  SignalSpec,
  type Configuration,
  type BinaryFormat,
  type ChannelLayout,
  type Codec,
  type EventFormat,
  type FrameOwnership,
  type PortDirection,
  type QueuePressure,
  type TextFormat,
} from './graph.js';
import {
  OperatorEmission,
  OperatorFactory,
  type OperatorContext,
  type OperatorEmissionInput,
  type OperatorNode as ConciseOperatorNode,
  type SourceConfiguration,
} from './provider.js';
import type {
  NativeOperatorDeliveryPolicy,
  NativeOperatorMediaCaps,
  NativeOperatorPortContext,
  NativeOperatorPrepareContext,
  NativeOperatorSignalSpec,
} from './native.js';
import type { OperatorInstance } from './session.js';
import type { SignalEnvelope } from './signals.js';
import type { RuntimeSessionId } from './identity.js';

/** Complete Core policy for one application-authored off-realtime Operator. */
export class OperatorManifest {
  public readonly operatorId: string;
  public readonly inputs: readonly PortSpec[];
  public readonly outputs: readonly PortSpec[];
  public readonly revision: number;
  public readonly implementationGeneration: number;
  public readonly queueCapacitySignals: number;
  public readonly processTimeoutMs: number;
  public readonly networkAllowed: boolean;
  public readonly filesystemAllowed: boolean;
  public readonly drainQueued: boolean;
  public readonly continueOnFailure: boolean;
  public readonly terminalRoles: readonly string[];
  /** Optional input policy; omitted inputs retain Core's media-specific defaults. */
  public readonly inputDelivery?: DeliveryPolicy;

  public constructor(options: {
    readonly operatorId: string;
    readonly inputs: readonly PortSpec[];
    readonly outputs: readonly PortSpec[];
    readonly revision?: number;
    readonly implementationGeneration?: number;
    readonly queueCapacitySignals?: number;
    readonly processTimeoutMs?: number;
    readonly networkAllowed?: boolean;
    readonly filesystemAllowed?: boolean;
    readonly drainQueued?: boolean;
    readonly continueOnFailure?: boolean;
    readonly terminalRoles?: readonly string[];
    readonly inputDelivery?: DeliveryPolicy;
  }) {
    this.operatorId = exactText(options.operatorId, 'operatorId');
    this.inputs = ports(options.inputs, 'input');
    this.outputs = ports(options.outputs, 'output');
    assertCommonMedia(this.inputs, 'input');
    assertCommonMedia(this.outputs, 'output');
    this.revision = positiveUint32(options.revision ?? 1, 'revision');
    this.implementationGeneration = positiveUint32(
      options.implementationGeneration ?? 1,
      'implementationGeneration',
    );
    this.queueCapacitySignals = positiveSafeInteger(
      options.queueCapacitySignals ?? 8,
      'queueCapacitySignals',
    );
    this.processTimeoutMs = positiveUint32(
      options.processTimeoutMs ?? 30_000,
      'processTimeoutMs',
    );
    this.networkAllowed = options.networkAllowed ?? false;
    this.filesystemAllowed = options.filesystemAllowed ?? false;
    this.drainQueued = options.drainQueued ?? false;
    this.continueOnFailure = options.continueOnFailure ?? false;
    const allowedRoles = new Set(
      this.outputs
        .map((output) => output.signal.role)
        .filter((role): role is string => role !== undefined),
    );
    const terminalRoles = options.terminalRoles ?? [];
    if (new Set(terminalRoles).size !== terminalRoles.length) {
      throw new TypeError('terminalRoles cannot contain duplicates');
    }
    for (const role of terminalRoles) {
      exactText(role, 'terminal role');
      if (!allowedRoles.has(role)) {
        throw new TypeError(`Terminal Operator role ${JSON.stringify(role)} is not a declared output role`);
      }
    }
    this.terminalRoles = Object.freeze([...terminalRoles]);
    if (options.inputDelivery !== undefined && !(options.inputDelivery instanceof DeliveryPolicy)) {
      throw new TypeError('inputDelivery must be a DeliveryPolicy');
    }
    this.inputDelivery = options.inputDelivery;
    Object.freeze(this);
  }
}

/** One graph-compiled port observed immediately before Operator processing. */
export class OperatorPortContext {
  public readonly edgeId?: bigint;
  public readonly portName: string;
  public readonly direction: PortDirection;
  public readonly capacitySignals: number;
  public readonly signal: SignalSpec;
  public readonly media: MediaCaps;
  public readonly routeSettings: RouteSettings;

  /** @internal */
  public constructor(
    native: NativeOperatorPortContext,
    port: PortSpec,
  ) {
    if (native.portName !== port.name || native.direction !== port.direction) {
      throw new TypeError('Core returned an Operator port outside the registered manifest');
    }
    if (!Number.isInteger(native.capacitySignals) || native.capacitySignals < 1) {
      throw new TypeError('Core returned an invalid Operator edge capacity');
    }
    if (native.edgeId !== undefined && native.edgeId !== null) {
      this.edgeId = BigInt(native.edgeId);
    }
    this.portName = port.name;
    this.direction = port.direction;
    this.capacitySignals = native.capacitySignals;
    this.signal = signalFromCompiledContext(native.signal);
    this.media = mediaFromCompiledContext(native.media);
    this.routeSettings = routeFromCompiledContext(native.routeSettings.media, native.routeSettings.delivery);
    if (this.signal.wireId !== port.signal.wireId) {
      throw new TypeError('Core returned an Operator signal outside the registered manifest');
    }
    if (!this.media.isCompatibleWith(port.media)) {
      throw new TypeError('Core returned Operator media outside the registered manifest');
    }
    Object.freeze(this);
  }
}

/** Full graph-owned preparation context for one running Operator instance. */
export class OperatorPrepareContext implements OperatorContext {
  public readonly executionPartition: string;
  public readonly inputs: readonly OperatorPortContext[];
  public readonly outputs: readonly OperatorPortContext[];
  public readonly signal: AbortSignal;

  /** @internal */
  public constructor(
    native: NativeOperatorPrepareContext,
    manifest: OperatorManifest,
    signal: AbortSignal,
  ) {
    if (native.executionPartition !== 'async-worker') {
      throw new TypeError(`Unsupported Operator execution partition ${JSON.stringify(native.executionPartition)}`);
    }
    this.executionPartition = native.executionPartition;
    this.inputs = Object.freeze(native.inputs.map((context) => new OperatorPortContext(
      context,
      requiredPort(manifest.inputs, context),
    )));
    this.outputs = Object.freeze(native.outputs.map((context) => new OperatorPortContext(
      context,
      requiredPort(manifest.outputs, context),
    )));
    this.signal = signal;
    Object.freeze(this);
  }
}

/** Finite waits for every JavaScript Operator lifecycle stage. */
export class OperatorDeadlines {
  public readonly createMs: number;
  public readonly prepareMs: number;
  public readonly processMs: number;
  public readonly closeMs: number;

  public constructor(options: {
    readonly createMs?: number;
    readonly prepareMs?: number;
    readonly processMs?: number;
    readonly closeMs?: number;
  } = {}) {
    this.createMs = boundedInteger(options.createMs ?? 5_000, 'createMs', 1, 300_000);
    this.prepareMs = boundedInteger(options.prepareMs ?? 5_000, 'prepareMs', 1, 300_000);
    this.processMs = boundedInteger(options.processMs ?? 30_000, 'processMs', 1, 300_000);
    this.closeMs = boundedInteger(options.closeMs ?? 5_000, 'closeMs', 1, 300_000);
    Object.freeze(this);
  }
}

/** Application-owned state for one configured Operator instance. */
export interface AuthoredOperatorNode {
  prepare?(context: OperatorPrepareContext): void | Promise<void>;
  process(
    inputPort: string,
    envelope: SignalEnvelope,
  ): readonly OperatorEmissionInput[] | Promise<readonly OperatorEmissionInput[]>;
  flush?(): readonly OperatorEmissionInput[] | Promise<readonly OperatorEmissionInput[]>;
  cancel?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

/** Create independent Operator state for one declaration. */
export interface OperatorNodeFactory {
  create(
    configuration: Readonly<Record<string, string>>,
  ): AuthoredOperatorNode | Promise<AuthoredOperatorNode>;
  validateConfig?(
    configuration: Readonly<Record<string, string>>,
  ): void | Promise<void>;
}

export type OperatorNodeBuilder = (
  configuration: Readonly<Record<string, string>>,
) => AuthoredOperatorNode | Promise<AuthoredOperatorNode>;
export type OperatorHandler = (
  inputPort: string,
  envelope: SignalEnvelope,
) => readonly OperatorEmissionInput[] | Promise<readonly OperatorEmissionInput[]>;
export type OperatorConfigValidator = (
  configuration: Readonly<Record<string, string>>,
) => void | Promise<void>;

/** Manifest-driven application-owned Operator implementation. */
export class OperatorProvider {
  public readonly manifest: OperatorManifest;
  public readonly factory: OperatorNodeFactory | OperatorNodeBuilder;
  public readonly deadlines: OperatorDeadlines;
  readonly #validator?: OperatorConfigValidator;

  public constructor(options: {
    readonly manifest: OperatorManifest;
    readonly factory: OperatorNodeFactory | OperatorNodeBuilder;
    readonly deadlines?: OperatorDeadlines;
    readonly validateConfig?: OperatorConfigValidator;
  }) {
    this.manifest = options.manifest;
    this.factory = options.factory;
    this.deadlines = options.deadlines ?? new OperatorDeadlines({
      processMs: Math.min(30_000, options.manifest.processTimeoutMs),
    });
    if (this.deadlines.processMs > this.manifest.processTimeoutMs) {
      throw new RangeError('Operator process deadline cannot exceed the Core manifest deadline');
    }
    this.#validator = options.validateConfig;
  }

  public static withNode(
    manifest: OperatorManifest,
    factory: OperatorNodeFactory | OperatorNodeBuilder,
    options: { readonly deadlines?: OperatorDeadlines } = {},
  ): OperatorProvider {
    return new OperatorProvider({ manifest, factory, deadlines: options.deadlines });
  }

  public static fromHandler(
    manifest: OperatorManifest,
    handler: OperatorHandler,
    options: {
      readonly validateConfig?: OperatorConfigValidator;
      readonly deadlines?: OperatorDeadlines;
    } = {},
  ): OperatorProvider {
    return new OperatorProvider({
      manifest,
      deadlines: options.deadlines,
      validateConfig: options.validateConfig,
      factory: () => ({ process: handler }),
    });
  }

  /** @internal */
  public _factory(): OperatorFactory {
    const maximumDeadline = Math.max(
      this.deadlines.createMs,
      this.deadlines.prepareMs,
      this.deadlines.processMs,
      this.deadlines.closeMs,
    );
    return new OperatorFactory({
      id: this.manifest.operatorId,
      inputs: this.manifest.inputs,
      outputs: this.manifest.outputs,
      revision: this.manifest.revision,
      generation: this.manifest.implementationGeneration,
      queueCapacity: this.manifest.queueCapacitySignals,
      processTimeoutMs: this.manifest.processTimeoutMs,
      networkAllowed: this.manifest.networkAllowed,
      filesystemAllowed: this.manifest.filesystemAllowed,
      drainQueued: this.manifest.drainQueued,
      continueOnFailure: this.manifest.continueOnFailure,
      terminalRoles: this.manifest.terminalRoles,
      inputDelivery: this.manifest.inputDelivery,
      deadlineMs: maximumDeadline,
      prepareContext: (context, signal) => new OperatorPrepareContext(
        context,
        this.manifest,
        signal,
      ),
      validate: async (configuration) => {
        const validation = this.#validator === undefined
          ? factoryValidator(this.factory, configuration)
          : this.#validator(configuration);
        await within(
          Promise.resolve(validation),
          this.deadlines.createMs,
          'validation',
        );
      },
      create: async (configuration): Promise<ConciseOperatorNode> => {
        const creation = Promise.resolve(createNode(this.factory, configuration));
        const node = await within(
          creation,
          this.deadlines.createMs,
          'creation',
          async (lateNode) => {
            if (lateNode != null && typeof lateNode === 'object') {
              await lateNode.close?.();
            }
          },
        );
        if (node == null || typeof node.process !== 'function') {
          throw new TypeError('Operator factory must return a node with process()');
        }
        return {
          prepare: async (context) => {
            if (!(context instanceof OperatorPrepareContext)) {
              throw new TypeError('Operator compiled prepare context is unavailable');
            }
            await within(
              Promise.resolve(node.prepare?.(context)),
              this.deadlines.prepareMs,
              'prepare',
            );
          },
          process: async (envelope, inputPort) => within(
            Promise.resolve(node.process(inputPort, envelope)),
            this.deadlines.processMs,
            'process',
          ),
          flush: async () => within(
            Promise.resolve(node.flush?.() ?? []),
            this.deadlines.processMs,
            'flush',
          ),
          cancel: async () => {
            await within(Promise.resolve(node.cancel?.()), this.deadlines.closeMs, 'cancel');
          },
          close: async () => {
            await within(Promise.resolve(node.close?.()), this.deadlines.closeMs, 'close');
          },
        };
      },
    });
  }
}

/** Session-bound Operator registration used to declare configured instances. */
export class RegisteredOperator {
  readonly #sessionId: RuntimeSessionId;
  readonly #provider: OperatorProvider;
  readonly #declare: (operator: Operator) => OperatorInstance;

  /** @internal */
  public constructor(
    sessionId: RuntimeSessionId,
    provider: OperatorProvider,
    declare: (operator: Operator) => OperatorInstance,
  ) {
    this.#sessionId = sessionId;
    this.#provider = provider;
    this.#declare = declare;
  }

  public get sessionId(): RuntimeSessionId { return this.#sessionId; }
  public get operatorId(): string { return this.#provider.manifest.operatorId; }

  public declare(
    configuration: Configuration | OperatorConfiguration = {},
  ): OperatorInstance {
    const values = configuration instanceof OperatorConfiguration
      ? configuration.toObject()
      : configuration;
    return this.#declare(new Operator(this.operatorId, values));
  }
}

/** Function-form helper equivalent to `OperatorProvider.fromHandler()`. */
export function operator(
  manifest: OperatorManifest,
  options: {
    readonly validateConfig?: OperatorConfigValidator;
    readonly deadlines?: OperatorDeadlines;
  } = {},
): (handler: OperatorHandler) => OperatorProvider {
  return (handler) => OperatorProvider.fromHandler(manifest, handler, options);
}

function createNode(
  factory: OperatorNodeFactory | OperatorNodeBuilder,
  configuration: SourceConfiguration,
): AuthoredOperatorNode | Promise<AuthoredOperatorNode> {
  return typeof factory === 'function' ? factory(configuration) : factory.create(configuration);
}

function factoryValidator(
  factory: OperatorNodeFactory | OperatorNodeBuilder,
  configuration: SourceConfiguration,
): void | Promise<void> {
  return typeof factory === 'function' ? undefined : factory.validateConfig?.(configuration);
}

function signalFromCompiledContext(value: NativeOperatorSignalSpec): SignalSpec {
  const options = {
    role: value.role ?? undefined,
    schema: value.schema ?? undefined,
  };
  switch (value.kind) {
    case 'any': return SignalSpec.any(options);
    case 'pcm-audio': return SignalSpec.audio(options);
    case 'encoded-audio': return SignalSpec.encodedAudio(value.format as Codec, options);
    case 'text': return SignalSpec.text(value.format as TextFormat, options);
    case 'event': return SignalSpec.event(value.format as EventFormat, options);
    case 'metrics': return SignalSpec.metrics(options);
    case 'control': return SignalSpec.control(options);
    case 'binary': return SignalSpec.binary(value.format as BinaryFormat, options);
    case 'custom': return SignalSpec.custom(value.customId ?? '', options);
    default: throw new TypeError(`Core returned unsupported Operator signal kind ${JSON.stringify(value.kind)}`);
  }
}

function mediaFromCompiledContext(value: NativeOperatorMediaCaps): MediaCaps {
  switch (value.kind) {
    case 'audio-pcm':
      return MediaCaps.audio({
        sampleRateHz: value.sampleRateHz ?? undefined,
        frameSamples: value.frameSamples ?? undefined,
        channelLayout: (value.channelLayout ?? 'any') as ChannelLayout,
      });
    case 'audio-encoded': return MediaCaps.encodedAudio(value.format as Codec);
    case 'text': return MediaCaps.text();
    case 'event': return MediaCaps.event();
    case 'metrics': return MediaCaps.metrics();
    case 'control': return MediaCaps.control();
    case 'binary': return MediaCaps.binary(value.format as BinaryFormat);
    case 'any': return MediaCaps.any();
    default: throw new TypeError(`Core returned unsupported Operator media kind ${JSON.stringify(value.kind)}`);
  }
}

function routeFromCompiledContext(
  mediaValue: NativeOperatorMediaCaps,
  value: NativeOperatorDeliveryPolicy,
): RouteSettings {
  const noLatencyBudget = value.latencyBudgetMs === undefined || value.latencyBudgetMs === null;
  let delivery: DeliveryPolicy;
  if (
    value.clock === 'capture'
    && value.delivery === 'ordered'
    && value.observability === 'counters'
    && noLatencyBudget
  ) {
    delivery = DeliveryPolicy.realtimeAudio();
  } else if (
    value.clock === 'inherited'
    && value.delivery === 'ordered'
    && value.observability === 'counters'
    && noLatencyBudget
  ) {
    delivery = DeliveryPolicy.buffered();
  } else {
    throw new TypeError('Core returned an Operator route policy JavaScript cannot represent exactly');
  }
  delivery = delivery
    .withLoss(canonicalLossPolicy(value.loss))
    .withQueuePressure(value.backpressure as QueuePressure)
    .withFrameOwnership(value.copyPolicy as FrameOwnership)
    .withJitterBudgetMs(value.jitterBudgetMs ?? undefined);
  if (value.maxPayloadBytes !== undefined && value.maxPayloadBytes !== null) {
    delivery = delivery.withMaxPayloadBytes(value.maxPayloadBytes);
  }
  const route = RouteSettings.create(mediaFromCompiledContext(mediaValue), delivery);
  const compiled = route.deliveryPolicy;
  if (
    compiled.clock !== value.clock
    || (compiled.latencyBudgetMs ?? null) !== (value.latencyBudgetMs ?? null)
    || (compiled.jitterBudgetMs ?? null) !== (value.jitterBudgetMs ?? null)
    || compiled.queuePressure !== value.backpressure
    || compiled.delivery !== value.delivery
    || compiled.loss !== canonicalLossPolicy(value.loss)
    || compiled.frameOwnership !== value.copyPolicy
    || compiled.observability !== value.observability
    || (compiled.maxPayloadBytes ?? null) !== (value.maxPayloadBytes ?? null)
  ) {
    throw new TypeError('Core returned an Operator route policy JavaScript could not preserve exactly');
  }
  return route;
}

function canonicalLossPolicy(value: string): LossPolicy {
  if (value === 'conceal-audio' || value === 'conceal-for-audio') {
    return LossPolicy.CONCEAL_FOR_AUDIO;
  }
  if (value === 'deliver-or-fail' || value === 'must-deliver-or-fail') {
    return LossPolicy.MUST_DELIVER_OR_FAIL;
  }
  if (value === 'drop-allowed') return LossPolicy.DROP_ALLOWED;
  throw new TypeError(`Core returned unsupported loss policy ${JSON.stringify(value)}`);
}

function requiredPort(
  ports: readonly PortSpec[],
  context: NativeOperatorPortContext,
): PortSpec {
  const port = ports.find((candidate) => candidate.name === context.portName);
  if (port === undefined) {
    throw new TypeError(`Core prepared undeclared Operator port ${JSON.stringify(context.portName)}`);
  }
  return port;
}

function ports(values: readonly PortSpec[], direction: PortDirection): readonly PortSpec[] {
  if (values.length === 0 || values.some((port) => port.direction !== direction)) {
    throw new TypeError(`Operator requires at least one ${direction} PortSpec`);
  }
  const names = values.map((port) => port.name);
  if (new Set(names).size !== names.length) {
    throw new TypeError(`Operator ${direction} port names cannot contain duplicates`);
  }
  return Object.freeze([...values]);
}

function assertCommonMedia(values: readonly PortSpec[], kind: string): void {
  const first = values[0]!.media;
  if (values.some((port) => !port.media.isCompatibleWith(first))) {
    throw new TypeError(`Operator ${kind} ports must share one compatible edge media contract`);
  }
}

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  stage: string,
  onLateResult?: (value: T) => void | Promise<void>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const failure = new JavaScriptOperatorTimeoutError(stage, milliseconds);
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

class JavaScriptOperatorTimeoutError extends Error {
  public readonly code = 'javascript.operator.timeout';

  public constructor(stage: string, milliseconds: number) {
    super(`JavaScript Operator ${stage} exceeded ${milliseconds} milliseconds`);
    this.name = 'JavaScriptOperatorTimeoutError';
  }
}

function exactText(value: string, name: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be non-empty and exact`);
  }
  return value;
}

function positiveUint32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) {
    throw new RangeError(`${name} must be a positive unsigned 32-bit integer`);
  }
  return value;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

export { OperatorEmission };
