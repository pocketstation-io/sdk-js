import {
  SourceConfiguration as GraphSourceConfiguration,
  type PortSpec,
  type SourceConfigurationInput,
} from './graph.js';
import {
  SOURCE_DRAIN_DEADLINE_MS,
  SourceEmission,
  SourceFactory,
  type SourceConfiguration as SourceConfigurationRecord,
  type SourceContext,
  type SourceDriver as ConciseSourceDriver,
} from './provider.js';
import {
  nativeAddon,
  type NativeSourceContext,
  type NativeSourceManifestHandle,
} from './native.js';
import { nativeCallSync } from './errors.js';
import {
  RuntimeSessionId,
  SourceId,
  StreamId,
} from './identity.js';
import type { SourceInstance } from './session.js';

/** Validated interface for one application-authored typed Source implementation. */
export class SourceManifest {
  public readonly sourceTypeId: string;
  public readonly outputs: readonly PortSpec[];
  public readonly revision: number;
  public readonly implementationGeneration: number;
  readonly #native: NativeSourceManifestHandle;

  public constructor(options: {
    readonly sourceTypeId: string;
    readonly outputs: readonly PortSpec[];
    readonly revision?: number;
    readonly implementationGeneration?: number;
  }) {
    this.sourceTypeId = options.sourceTypeId;
    this.outputs = Object.freeze([...options.outputs]);
    this.revision = positiveInteger(options.revision ?? 1, 'revision');
    this.implementationGeneration = positiveInteger(
      options.implementationGeneration ?? 1,
      'implementationGeneration',
    );
    this.#native = nativeCallSync(() => new (nativeAddon().NativeSourceManifest)(
      this.sourceTypeId,
      this.outputs.map((output) => output._nativeHandle()),
      this.revision,
      this.implementationGeneration,
    ));
    Object.freeze(this);
  }

  /** @internal */
  public _nativeHandle(): NativeSourceManifestHandle { return this.#native; }
}

/** Session-owned identity assigned to one prepared Source output. */
export class SourceOutputIdentity {
  public readonly outputPort: string;
  public readonly streamId: StreamId;

  /** @internal */
  public constructor(outputPort: string, streamId: StreamId) {
    this.outputPort = outputPort;
    this.streamId = streamId;
    Object.freeze(this);
  }

  /** Compatibility name used by the concise authoring surface. */
  public get name(): string { return this.outputPort; }
}

/** Immutable Session identity supplied after Core has prepared one Source. */
export class SourcePrepareContext {
  public readonly sourceTypeId: string;
  public readonly sessionId?: RuntimeSessionId;
  public readonly sourceId?: SourceId;
  public readonly outputs: readonly SourceOutputIdentity[];
  public readonly signal: AbortSignal;

  /** @internal */
  public constructor(value: NativeSourceContext, signal: AbortSignal) {
    this.sourceTypeId = value.sourceTypeId;
    if (value.sessionId != null) {
      this.sessionId = RuntimeSessionId(BigInt(value.sessionId));
    }
    if (value.sourceId != null) this.sourceId = SourceId(BigInt(value.sourceId));
    this.outputs = Object.freeze(value.outputs.map(
      (output) => new SourceOutputIdentity(
        output.name,
        StreamId(BigInt(output.streamId)),
      ),
    ));
    this.signal = signal;
    Object.freeze(this);
  }
}

/** Read-only cancellation state owned by the Core Source runtime. */
export class SourceCancellation {
  public readonly signal: AbortSignal;

  /** @internal */
  public constructor(signal: AbortSignal) {
    this.signal = signal;
    Object.freeze(this);
  }

  public get cancelled(): boolean { return this.signal.aborted; }
}

/** Finite waits for every JavaScript Source lifecycle stage. */
export class SourceDeadlines {
  public readonly createMs: number;
  public readonly prepareMs: number;
  public readonly nextMs: number;
  public readonly closeMs: number;

  public constructor(options: {
    readonly createMs?: number;
    readonly prepareMs?: number;
    readonly nextMs?: number;
    readonly closeMs?: number;
  } = {}) {
    this.createMs = boundedInteger(options.createMs ?? 5_000, 'createMs', 1, 300_000);
    this.prepareMs = boundedInteger(options.prepareMs ?? 5_000, 'prepareMs', 1, 300_000);
    this.nextMs = boundedInteger(options.nextMs ?? 30_000, 'nextMs', 1, 300_000);
    this.closeMs = boundedInteger(options.closeMs ?? 5_000, 'closeMs', 1, 300_000);
    Object.freeze(this);
  }
}

/** Application-owned state for one configured Source instance. */
export interface AuthoredSourceDriver {
  prepare?(context: SourcePrepareContext): void | Promise<void>;
  next(
    cancellation: SourceCancellation,
  ): SourceEmission | undefined | Promise<SourceEmission | undefined>;
  /** Return already accepted work during graceful stop; never advance live input. */
  drain?(): SourceEmission | undefined | Promise<SourceEmission | undefined>;
  close?(): void | Promise<void>;
}

/** Create independent Source state for one declaration. */
export interface SourceDriverFactory {
  create(
    configuration: SourceConfigurationRecord,
  ): AuthoredSourceDriver | Promise<AuthoredSourceDriver>;
  validateConfig?(configuration: SourceConfigurationRecord): void | Promise<void>;
}

export type SourceDriverBuilder = (
  configuration: SourceConfigurationRecord,
) => AuthoredSourceDriver | Promise<AuthoredSourceDriver>;
export type SourceIterableFactory = (
  configuration: SourceConfigurationRecord,
) => Iterable<SourceEmission> | AsyncIterable<SourceEmission>;
export type SourceConfigValidator = (
  configuration: SourceConfigurationRecord,
) => void | Promise<void>;

/** Manifest-driven reusable Source implementation. */
export class SourceProvider {
  public readonly manifest: SourceManifest;
  public readonly factory: SourceDriverFactory | SourceDriverBuilder;
  public readonly deadlines: SourceDeadlines;
  readonly #validator?: SourceConfigValidator;

  public constructor(options: {
    readonly manifest: SourceManifest;
    readonly factory: SourceDriverFactory | SourceDriverBuilder;
    readonly deadlines?: SourceDeadlines;
    readonly validateConfig?: SourceConfigValidator;
  }) {
    this.manifest = options.manifest;
    this.factory = options.factory;
    this.deadlines = options.deadlines ?? new SourceDeadlines();
    this.#validator = options.validateConfig;
  }

  public static withDriver(
    manifest: SourceManifest,
    factory: SourceDriverFactory | SourceDriverBuilder,
    options: { readonly deadlines?: SourceDeadlines } = {},
  ): SourceProvider {
    return new SourceProvider({ manifest, factory, deadlines: options.deadlines });
  }

  public static fromIterable(
    manifest: SourceManifest,
    factory: SourceIterableFactory,
    options: {
      readonly validateConfig?: SourceConfigValidator;
      readonly deadlines?: SourceDeadlines;
    } = {},
  ): SourceProvider {
    return new SourceProvider({
      manifest,
      deadlines: options.deadlines,
      validateConfig: options.validateConfig,
      factory: (configuration) => iterableDriver(factory(configuration)),
    });
  }

  public static fromAsyncIterable(
    manifest: SourceManifest,
    factory: SourceIterableFactory,
    options: {
      readonly validateConfig?: SourceConfigValidator;
      readonly deadlines?: SourceDeadlines;
    } = {},
  ): SourceProvider {
    return SourceProvider.fromIterable(manifest, factory, options);
  }

  /** @internal */
  public _factory(): SourceFactory {
    const maximumDeadline = Math.max(
      this.deadlines.createMs,
      this.deadlines.prepareMs,
      this.deadlines.nextMs,
      this.deadlines.closeMs,
    );
    return new SourceFactory({
      id: this.manifest.sourceTypeId,
      outputs: this.manifest.outputs,
      revision: this.manifest.revision,
      generation: this.manifest.implementationGeneration,
      deadlineMs: maximumDeadline,
      nativeManifest: this.manifest._nativeHandle(),
      prepareContext: (context, signal) => new SourcePrepareContext(context, signal),
      validate: async (configuration) => {
        const validation = this.#validator === undefined
          ? factoryValidator(this.factory, configuration)
          : this.#validator(configuration);
        await within(Promise.resolve(validation), this.deadlines.createMs, 'validation');
      },
      create: async (configuration): Promise<ConciseSourceDriver> => {
        let cleanupStarted = false;
        let pendingInput: Promise<void> | undefined;
        const invokeInput = <T>(operation: () => T | Promise<T>, milliseconds: number, stage: string): Promise<T> => {
          if (pendingInput !== undefined) throw new Error('Source input cleanup is still pending');
          const task = Promise.resolve().then(operation);
          const settled = task.then(() => undefined, () => undefined);
          pendingInput = settled;
          void settled.then(() => {
            if (pendingInput === settled) pendingInput = undefined;
          });
          return within(task, milliseconds, stage);
        };
        const cleanup = async (value: unknown): Promise<void> => {
          if (cleanupStarted) return;
          cleanupStarted = true;
          const close = sourceDriverClose(value);
          await within(
            Promise.resolve().then(async () => {
              await pendingInput;
              await close?.();
            }),
            this.deadlines.closeMs,
            'close',
          );
        };
        const creation = Promise.resolve().then(
          () => createDriver(this.factory, configuration),
        );
        const driver = await within(
          creation,
          this.deadlines.createMs,
          'creation',
          () => {
            void creation.then(cleanup).catch(() => undefined);
          },
        );
        if (driver == null || typeof driver.next !== 'function') {
          await cleanup(driver).catch(() => undefined);
          throw new TypeError('Source factory must return a driver with next()');
        }
        return {
          prepare: async (context) => {
            if (!(context instanceof SourcePrepareContext)) {
              throw new TypeError('Source prepared Session context is unavailable');
            }
            await within(
              Promise.resolve(driver.prepare?.(context)),
              this.deadlines.prepareMs,
              'prepare',
            );
          },
          next: async (context: SourceContext) => invokeInput(
            () => driver.next(new SourceCancellation(context.signal)),
            this.deadlines.nextMs,
            'next',
          ),
          drain: async () => invokeInput(
            async () => await driver.drain?.(),
            Math.min(this.deadlines.closeMs, SOURCE_DRAIN_DEADLINE_MS),
            'drain',
          ),
          close: async () => {
            await cleanup(driver);
          },
        };
      },
    });
  }
}

/** Session-bound Source registration used to declare configured instances. */
export class RegisteredSource {
  readonly #sessionId: RuntimeSessionId;
  readonly #provider: SourceProvider;
  readonly #declare: (configuration: SourceConfigurationRecord) => SourceInstance;

  /** @internal */
  public constructor(
    sessionId: RuntimeSessionId,
    provider: SourceProvider,
    declare: (configuration: SourceConfigurationRecord) => SourceInstance,
  ) {
    this.#sessionId = sessionId;
    this.#provider = provider;
    this.#declare = declare;
  }

  public get sessionId(): RuntimeSessionId { return this.#sessionId; }
  public get sourceTypeId(): string { return this.#provider.manifest.sourceTypeId; }

  public declare(
    configuration: GraphSourceConfiguration | SourceConfigurationInput = {},
  ): SourceInstance {
    const values = configuration instanceof GraphSourceConfiguration
      ? configuration.toObject()
      : new GraphSourceConfiguration(configuration).toObject();
    return this.#declare(values);
  }
}

/** Function-form helper equivalent to `SourceProvider.fromIterable()`. */
export function source(
  manifest: SourceManifest,
  options: {
    readonly validateConfig?: SourceConfigValidator;
    readonly deadlines?: SourceDeadlines;
  } = {},
): (factory: SourceIterableFactory) => SourceProvider {
  return (factory) => SourceProvider.fromIterable(manifest, factory, options);
}

function createDriver(
  factory: SourceDriverFactory | SourceDriverBuilder,
  configuration: SourceConfigurationRecord,
): AuthoredSourceDriver | Promise<AuthoredSourceDriver> {
  return typeof factory === 'function' ? factory(configuration) : factory.create(configuration);
}

function factoryValidator(
  factory: SourceDriverFactory | SourceDriverBuilder,
  configuration: SourceConfigurationRecord,
): void | Promise<void> {
  return typeof factory === 'function' ? undefined : factory.validateConfig?.(configuration);
}

function sourceDriverClose(value: unknown): (() => void | Promise<void>) | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  const close = Reflect.get(value, 'close');
  if (typeof close !== 'function') return undefined;
  return () => Reflect.apply(close, value, []) as void | Promise<void>;
}

function iterableDriver(
  values: Iterable<SourceEmission> | AsyncIterable<SourceEmission>,
): AuthoredSourceDriver {
  const asyncIterator = (values as AsyncIterable<SourceEmission>)[Symbol.asyncIterator]?.();
  const iterator = asyncIterator
    ?? (values as Iterable<SourceEmission>)[Symbol.iterator]?.();
  if (iterator === undefined) {
    throw new TypeError('Source iterable factory must return an Iterable or AsyncIterable');
  }
  return {
    next: async (cancellation) => {
      if (cancellation.cancelled) return undefined;
      const result = await iterator.next();
      return result.done ? undefined : result.value;
    },
    close: async () => { await iterator.return?.(); },
  };
}

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  stage: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            onTimeout?.();
            reject(new Error(`JavaScript Source ${stage} exceeded ${milliseconds} milliseconds`));
          },
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be positive`);
  return value;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

export { SourceEmission };
