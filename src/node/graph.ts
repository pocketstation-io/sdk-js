import { nativeCallSync } from './errors.js';
import {
  nativeAddon,
  type NativeConfigurationEntry,
  type NativeDeliveryPolicyHandle,
  type NativeEndpointDefinitionHandle,
  type NativeMediaCapsHandle,
  type NativeMediaOptions,
  type NativeOperatorHandle,
  type NativePortSpecHandle,
  type NativeRouteSettingsHandle,
  type NativeSignalSpecHandle,
} from './native.js';

/** Signal families understood by the native graph compiler. */
export type SignalKind =
  | 'any'
  | 'pcm-audio'
  | 'encoded-audio'
  | 'text'
  | 'event'
  | 'metrics'
  | 'control'
  | 'binary'
  | 'custom';

/** Encoded-audio formats supported by Core media descriptions. */
export const Codec = {
  Opus: 'opus',
  Aac: 'aac',
  Mp3: 'mp3',
  G711Ulaw: 'g711-ulaw',
  G711Alaw: 'g711-alaw',
  WebmOpus: 'webm-opus',
} as const;
/** One encoded-audio format accepted by Core. */
export type Codec = (typeof Codec)[keyof typeof Codec];

/** Text encodings supported by `SignalSpec.text()`. */
export type TextFormat = 'utf8' | 'json' | 'markdown';
/** Event encodings supported by `SignalSpec.event()`. */
export type EventFormat = 'json' | 'protobuf' | 'flatbuffers' | 'cbor';
/** Binary encodings supported by `SignalSpec.binary()`. */
export type BinaryFormat = 'raw' | 'protobuf' | 'flatbuffers' | 'cbor';

/** Optional semantic identity attached to a signal. */
export interface SignalOptions {
  /** Application-defined role, such as `transcript.final`. */
  readonly role?: string;
  /** Schema identifier used to validate cross-package compatibility. */
  readonly schema?: string;
}

/** @internal Native description used when reading one signal envelope. */
export interface SignalDescription extends SignalOptions {
  readonly kind: SignalKind;
  readonly format?: string;
  readonly customId?: string;
}

/** Describes the meaning and wire identity of values carried by a graph port. */
export class SignalSpec {
  readonly #native: NativeSignalSpecHandle;

  private constructor(
    kind: SignalKind,
    options: SignalOptions & { format?: string; customId?: string } = {},
  ) {
    this.#native = nativeCallSync(
      () => new (nativeAddon().NativeSignalSpec)(kind, options),
    );
  }

  /** @internal */
  public static _fromDescription(description: SignalDescription): SignalSpec {
    const options = {
      role: description.role,
      schema: description.schema,
    };
    switch (description.kind) {
      case 'any':
        return SignalSpec.any(options);
      case 'pcm-audio':
        return SignalSpec.audio(options);
      case 'encoded-audio':
        return SignalSpec.encodedAudio(description.format as Codec, options);
      case 'text':
        return SignalSpec.text(description.format as TextFormat, options);
      case 'event':
        return SignalSpec.event(description.format as EventFormat, options);
      case 'metrics':
        return SignalSpec.metrics(options);
      case 'control':
        return SignalSpec.control(options);
      case 'binary':
        return SignalSpec.binary(description.format as BinaryFormat, options);
      case 'custom':
        return SignalSpec.custom(description.customId ?? '', options);
    }
  }

  /** Describe an unconstrained signal. */
  public static any(options: SignalOptions = {}): SignalSpec {
    return new SignalSpec('any', options);
  }

  /** Describe interleaved PCM audio. */
  public static audio(options: SignalOptions = {}): SignalSpec {
    return new SignalSpec('pcm-audio', options);
  }

  /** Describe audio encoded with one supported codec. */
  public static encodedAudio(
    codec: Codec,
    options: SignalOptions = {},
  ): SignalSpec {
    return new SignalSpec('encoded-audio', { ...options, format: codec });
  }

  /** Describe text with an explicit encoding. */
  public static text(
    format: TextFormat = 'utf8',
    options: SignalOptions = {},
  ): SignalSpec {
    return new SignalSpec('text', { ...options, format });
  }

  /** Describe structured events with an explicit encoding. */
  public static event(
    format: EventFormat = 'json',
    options: SignalOptions = {},
  ): SignalSpec {
    return new SignalSpec('event', { ...options, format });
  }

  /** Describe metrics values. */
  public static metrics(options: SignalOptions = {}): SignalSpec {
    return new SignalSpec('metrics', options);
  }

  /** Describe control messages. */
  public static control(options: SignalOptions = {}): SignalSpec {
    return new SignalSpec('control', options);
  }

  /** Describe binary values with an explicit encoding. */
  public static binary(
    format: BinaryFormat = 'raw',
    options: SignalOptions = {},
  ): SignalSpec {
    return new SignalSpec('binary', { ...options, format });
  }

  /** Describe a package-defined signal with a stable identifier. */
  public static custom(id: string, options: SignalOptions = {}): SignalSpec {
    return new SignalSpec('custom', { ...options, customId: id });
  }

  /** Signal family selected for this value. */
  public get kind(): SignalKind {
    return this.#native.kind as SignalKind;
  }

  /** Wire format when the selected signal family defines one. */
  public get format(): string | undefined {
    return this.#native.format ?? undefined;
  }

  /** Stable identifier supplied for a custom signal. */
  public get customId(): string | undefined {
    return this.#native.customId ?? undefined;
  }

  /** Application-defined semantic role. */
  public get role(): string | undefined {
    return this.#native.role ?? undefined;
  }

  /** Schema identifier used for compatibility checks. */
  public get schema(): string | undefined {
    return this.#native.schema ?? undefined;
  }

  /** Stable cross-language identifier produced by Core. */
  public get wireId(): string {
    return this.#native.wireId;
  }

  /** Whether this signal represents PCM or encoded audio. */
  public get isAudio(): boolean {
    return this.#native.isAudio;
  }

  /** Ask Core whether two signal descriptions may be connected. */
  public isCompatibleWith(other: SignalSpec): boolean {
    return this.#native.isCompatibleWith(other.#native);
  }

  /** @internal */
  public _nativeHandle(): NativeSignalSpecHandle {
    return this.#native;
  }
}

/** Media representations understood by Core. */
export type MediaKind =
  | 'audio-pcm'
  | 'audio-encoded'
  | 'text'
  | 'event'
  | 'metrics'
  | 'control'
  | 'binary'
  | 'any';
/** Channel requirements for PCM audio. */
export type ChannelLayout = 'mono' | 'stereo' | 'any';

/** Optional PCM requirements used during native media negotiation. */
export interface AudioCaps {
  /** Required sample rate in hertz, or any rate when omitted. */
  readonly sampleRateHz?: number;
  /** Required samples per frame, or any frame size when omitted. */
  readonly frameSamples?: number;
  /** Required channel layout, or any layout when omitted. */
  readonly channelLayout?: ChannelLayout;
}

/** Describes the media representation accepted by a graph port or route. */
export class MediaCaps {
  readonly #native: NativeMediaCapsHandle;

  private constructor(native: NativeMediaCapsHandle) {
    this.#native = native;
  }

  private static create(kind: MediaKind, options?: NativeMediaOptions): MediaCaps {
    return new MediaCaps(
      nativeCallSync(
        () => new (nativeAddon().NativeMediaCaps)(kind, options),
      ),
    );
  }

  /** Describe interleaved float PCM with optional format requirements. */
  public static audio(caps: AudioCaps = {}): MediaCaps {
    return MediaCaps.create('audio-pcm', caps);
  }

  /** Describe audio encoded with one supported codec. */
  public static encodedAudio(codec: Codec): MediaCaps {
    return MediaCaps.create('audio-encoded', { format: codec });
  }

  /** Describe text media. */
  public static text(): MediaCaps {
    return MediaCaps.create('text');
  }

  /** Describe structured event media. */
  public static event(): MediaCaps {
    return MediaCaps.create('event');
  }

  /** Describe metrics media. */
  public static metrics(): MediaCaps {
    return MediaCaps.create('metrics');
  }

  /** Describe control messages. */
  public static control(): MediaCaps {
    return MediaCaps.create('control');
  }

  /** Describe binary media with an explicit encoding. */
  public static binary(format: BinaryFormat = 'raw'): MediaCaps {
    return MediaCaps.create('binary', { format });
  }

  /** Accept any media representation. */
  public static any(): MediaCaps {
    return MediaCaps.create('any');
  }

  /** Choose the broad media representation associated with a signal. */
  public static forSignal(signal: SignalSpec): MediaCaps {
    switch (signal.kind) {
      case 'pcm-audio':
        return MediaCaps.audio();
      case 'encoded-audio':
        return MediaCaps.encodedAudio(signal.format as Codec);
      case 'text':
        return MediaCaps.text();
      case 'event':
        return MediaCaps.event();
      case 'metrics':
        return MediaCaps.metrics();
      case 'control':
        return MediaCaps.control();
      case 'binary':
        return MediaCaps.binary((signal.format ?? 'raw') as BinaryFormat);
      case 'any':
      case 'custom':
        return MediaCaps.any();
    }
  }

  /** Media family selected for this value. */
  public get kind(): MediaKind {
    return this.#native.kind as MediaKind;
  }

  /** Codec or binary format when this media family defines one. */
  public get format(): string | undefined {
    return this.#native.format ?? undefined;
  }

  /** Required PCM sample rate in hertz. */
  public get sampleRateHz(): number | undefined {
    return this.#native.sampleRateHz ?? undefined;
  }

  /** Required PCM samples per frame. */
  public get frameSamples(): number | undefined {
    return this.#native.frameSamples ?? undefined;
  }

  /** Required PCM channel layout. */
  public get channelLayout(): ChannelLayout | undefined {
    return (this.#native.channelLayout ?? undefined) as ChannelLayout | undefined;
  }

  /** Ask Core whether these media requirements may be connected. */
  public isCompatibleWith(other: MediaCaps): boolean {
    return this.#native.isCompatibleWith(other.#native);
  }

  /** Return Core's common media result, or `undefined` when none exists. */
  public negotiate(other: MediaCaps): MediaCaps | undefined {
    const result = this.#native.negotiate(other.#native);
    return result == null ? undefined : new MediaCaps(result);
  }

  /** Ask Core whether this representation can carry the given signal. */
  public supportsSignal(signal: SignalSpec): boolean {
    return this.#native.supportsSignal(signal._nativeHandle());
  }

  /** @internal */
  public _nativeHandle(): NativeMediaCapsHandle {
    return this.#native;
  }
}

/** Direction of one named Operator or Endpoint port. */
export type PortDirection = 'input' | 'output';
/** Whether a port accepts one connection or several. */
export type Multiplicity = 'one' | 'many';

/** A named input or output with explicit signal and media requirements. */
export class PortSpec {
  readonly #native: NativePortSpecHandle;

  private constructor(
    name: string,
    direction: PortDirection,
    signal: SignalSpec,
    media: MediaCaps,
    multiplicity: Multiplicity,
    required: boolean,
  ) {
    this.#native = nativeCallSync(
      () =>
        new (nativeAddon().NativePortSpec)(
          name,
          direction,
          signal._nativeHandle(),
          media._nativeHandle(),
          multiplicity,
          required,
        ),
    );
  }

  /** Declare an input port and validate it with Core. */
  public static input(
    name: string,
    signal: SignalSpec,
    options: {
      media?: MediaCaps;
      multiplicity?: Multiplicity;
      required?: boolean;
    } = {},
  ): PortSpec {
    return new PortSpec(
      name,
      'input',
      signal,
      options.media ?? MediaCaps.forSignal(signal),
      options.multiplicity ?? 'one',
      options.required ?? true,
    );
  }

  /** Declare an output port and validate it with Core. */
  public static output(
    name: string,
    signal: SignalSpec,
    options: {
      media?: MediaCaps;
      multiplicity?: Multiplicity;
      required?: boolean;
    } = {},
  ): PortSpec {
    return new PortSpec(
      name,
      'output',
      signal,
      options.media ?? MediaCaps.forSignal(signal),
      options.multiplicity ?? 'one',
      options.required ?? true,
    );
  }

  /** Port name used when connecting a Session. */
  public get name(): string {
    return this.#native.name;
  }

  /** Whether this port receives or emits values. */
  public get direction(): PortDirection {
    return this.#native.direction as PortDirection;
  }

  /** Runtime signal identity accepted or emitted by this port. */
  public get signal(): SignalSpec {
    const native = this.#native.signal;
    return signalFromNative(native);
  }

  /** Media representation accepted or emitted by this port. */
  public get media(): MediaCaps {
    return mediaFromNative(this.#native.media);
  }

  /** Number of connections this port accepts. */
  public get multiplicity(): Multiplicity {
    return this.#native.multiplicity as Multiplicity;
  }

  /** Whether the compiler requires this port to be connected. */
  public get required(): boolean {
    return this.#native.required;
  }

  /** @internal */
  public _nativeHandle(): NativePortSpecHandle {
    return this.#native;
  }
}

/** Clock source used to interpret media timestamps. */
export type ClockDomain =
  | 'capture'
  | 'playback'
  | 'network'
  | 'inherited'
  | 'wallclock';
/** Behavior used when a route has reached its native capacity. */
export type QueuePressure = 'drop-newest' | 'drop-oldest' | 'buffer' | 'fail';
/** Ordering and delivery guarantee selected for a route. */
export type DeliverySemantics =
  | 'best-effort-realtime'
  | 'ordered'
  | 'exactly-once-not-realtime';
/** How a route treats missing media. */
export type LossPolicy = 'conceal-audio' | 'deliver-or-fail' | 'drop-allowed';
/** How frame memory may be transferred between native branches. */
export type FrameOwnership = 'move' | 'share' | 'copy';
/** Native observations retained for a route. */
export type RouteObservability = 'off' | 'counters' | 'full';

/** Chooses what happens when a destination cannot keep up. */
export class DeliveryPolicy {
  readonly #native: NativeDeliveryPolicyHandle;

  private constructor(native: NativeDeliveryPolicyHandle) {
    this.#native = native;
  }

  /** @internal */
  public static _fromNative(native: NativeDeliveryPolicyHandle): DeliveryPolicy {
    return new DeliveryPolicy(native);
  }

  /** Native delivery defaults for realtime PCM. */
  public static realtimeAudio(): DeliveryPolicy {
    return new DeliveryPolicy(nativeAddon().NativeDeliveryPolicy.realtimeAudio());
  }

  /** Native delivery defaults for off-realtime signals. */
  public static buffered(): DeliveryPolicy {
    return new DeliveryPolicy(nativeAddon().NativeDeliveryPolicy.buffered());
  }

  /** Clock domain required by this route. */
  public get clock(): ClockDomain {
    return this.#native.clock as ClockDomain;
  }

  /** Maximum accepted route latency in milliseconds, when configured. */
  public get latencyBudgetMs(): number | undefined {
    return this.#native.latencyBudgetMs ?? undefined;
  }

  /** Accepted timing variation in milliseconds, when configured. */
  public get jitterBudgetMs(): number | undefined {
    return this.#native.jitterBudgetMs ?? undefined;
  }

  /** Action taken when the native route reaches capacity. */
  public get queuePressure(): QueuePressure {
    return this.#native.backpressure as QueuePressure;
  }

  /** Ordering and delivery guarantee. */
  public get delivery(): DeliverySemantics {
    return this.#native.delivery as DeliverySemantics;
  }

  /** Missing-media behavior. */
  public get loss(): LossPolicy {
    return this.#native.loss as LossPolicy;
  }

  /** Frame-memory behavior compiled for this route. */
  public get frameOwnership(): FrameOwnership {
    return this.#native.copyPolicy as FrameOwnership;
  }

  /** Native observations retained for this route. */
  public get observability(): RouteObservability {
    return this.#native.observability as RouteObservability;
  }

  /** Largest accepted typed payload in bytes, when configured. */
  public get maxPayloadBytes(): number | undefined {
    return this.#native.maxPayloadBytes ?? undefined;
  }

  /** Return a copy with different capacity behavior. */
  public withQueuePressure(value: QueuePressure): DeliveryPolicy {
    return new DeliveryPolicy(
      nativeCallSync(() => this.#native.withBackpressure(value)),
    );
  }

  /** Return a copy with different frame-memory behavior. */
  public withFrameOwnership(value: FrameOwnership): DeliveryPolicy {
    return new DeliveryPolicy(
      nativeCallSync(() => this.#native.withCopyPolicy(value)),
    );
  }

  /** Return a copy with an optional jitter budget in milliseconds. */
  public withJitterBudgetMs(value?: number): DeliveryPolicy {
    return new DeliveryPolicy(this.#native.withJitterBudgetMs(value));
  }

  /** Return a copy with an exact maximum typed payload size. */
  public withMaxPayloadBytes(value: number): DeliveryPolicy {
    return new DeliveryPolicy(
      nativeCallSync(() => this.#native.withMaxPayloadBytes(value)),
    );
  }

  /** @internal */
  public _nativeHandle(): NativeDeliveryPolicyHandle {
    return this.#native;
  }
}

/** Combines media requirements with delivery behavior for one route. */
export class RouteSettings {
  readonly #native: NativeRouteSettingsHandle;

  private constructor(native: NativeRouteSettingsHandle) {
    this.#native = native;
  }

  /** Native media and delivery defaults for realtime PCM. */
  public static realtimeAudio(): RouteSettings {
    return new RouteSettings(nativeAddon().NativeRouteSettings.realtimeAudio());
  }

  /** Native media and delivery defaults for off-realtime signals. */
  public static buffered(): RouteSettings {
    return new RouteSettings(nativeAddon().NativeRouteSettings.buffered());
  }

  /** Combine explicit media requirements and delivery behavior. */
  public static create(media: MediaCaps, delivery: DeliveryPolicy): RouteSettings {
    return new RouteSettings(
      new (nativeAddon().NativeRouteSettings)(
        media._nativeHandle(),
        delivery._nativeHandle(),
      ),
    );
  }

  /** Media requirements compiled for this route. */
  public get media(): MediaCaps {
    return mediaFromNative(this.#native.media);
  }

  /** Delivery behavior compiled for this route. */
  public get delivery(): DeliveryPolicy {
    return DeliveryPolicy._fromNative(this.#native.deliveryPolicy);
  }

  /** Return a copy with different media requirements. */
  public withMedia(media: MediaCaps): RouteSettings {
    return new RouteSettings(this.#native.withMedia(media._nativeHandle()));
  }

  /** Return a copy with different delivery behavior. */
  public withDelivery(delivery: DeliveryPolicy): RouteSettings {
    return new RouteSettings(
      this.#native.withDelivery(delivery._nativeHandle()),
    );
  }

  /** @internal */
  public _nativeHandle(): NativeRouteSettingsHandle {
    return this.#native;
  }
}

/** Configuration value marked for native redaction. */
export interface SecretValue {
  /** Unredacted value passed to the registered implementation. */
  readonly value: string;
  /** Marker that prevents this value from appearing in diagnostics and traces. */
  readonly secret: true;
}

/** String configuration passed to a registered native implementation. */
export type ConfigurationValue = string | SecretValue;
/** Immutable configuration map for an Operator or Endpoint. */
export type Configuration = Readonly<Record<string, ConfigurationValue>>;

/** Mark a configuration value for redaction in diagnostics and traces. */
export function secret(value: string): SecretValue {
  return Object.freeze({ value, secret: true });
}

function configurationEntries(
  configuration: Configuration = {},
): NativeConfigurationEntry[] {
  return Object.entries(configuration)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) =>
      typeof entry === 'string'
        ? { key, value: entry }
        : { key, value: entry.value, sensitive: true },
    );
}

/** Declares one configured Operator implementation by its stable identifier. */
export class Operator {
  readonly #native: NativeOperatorHandle;
  /** Stable identifier of the registered implementation. */
  public readonly id: string;

  /** Declare one configured Operator. No worker starts in the constructor. */
  public constructor(id: string, configuration: Configuration = {}) {
    this.id = id;
    this.#native = nativeCallSync(
      () => new (nativeAddon().NativeOperator)(id, configurationEntries(configuration)),
    );
  }

  /** @internal */
  public _nativeHandle(): NativeOperatorHandle {
    return this.#native;
  }
}

/** Declares one configured Endpoint implementation by its stable identifiers. */
export class EndpointDefinition {
  readonly #native: NativeEndpointDefinitionHandle;
  /** Stable node type resolved by the Core compiler. */
  public readonly nodeType: string;
  /** Stable identifier of the registered Endpoint implementation. */
  public readonly operatorId: string;

  /** Declare one configured native destination. */
  public constructor(
    nodeType: string,
    operatorId: string,
    options: { configuration?: Configuration; route?: RouteSettings } = {},
  ) {
    this.nodeType = nodeType;
    this.operatorId = operatorId;
    this.#native = nativeCallSync(
      () =>
        new (nativeAddon().NativeEndpointDefinition)(
          nodeType,
          operatorId,
          configurationEntries(options.configuration),
          options.route?._nativeHandle(),
        ),
    );
  }

  /** @internal */
  public _nativeHandle(): NativeEndpointDefinitionHandle {
    return this.#native;
  }
}

function signalFromNative(native: NativeSignalSpecHandle): SignalSpec {
  const options: SignalOptions = {
    role: native.role ?? undefined,
    schema: native.schema ?? undefined,
  };
  switch (native.kind as SignalKind) {
    case 'any':
      return SignalSpec.any(options);
    case 'pcm-audio':
      return SignalSpec.audio(options);
    case 'encoded-audio':
      return SignalSpec.encodedAudio(native.format as Codec, options);
    case 'text':
      return SignalSpec.text(native.format as TextFormat, options);
    case 'event':
      return SignalSpec.event(native.format as EventFormat, options);
    case 'metrics':
      return SignalSpec.metrics(options);
    case 'control':
      return SignalSpec.control(options);
    case 'binary':
      return SignalSpec.binary(native.format as BinaryFormat, options);
    case 'custom':
      return SignalSpec.custom(native.customId ?? '', options);
  }
}

function mediaFromNative(native: NativeMediaCapsHandle): MediaCaps {
  switch (native.kind as MediaKind) {
    case 'audio-pcm':
      return MediaCaps.audio({
        sampleRateHz: native.sampleRateHz ?? undefined,
        frameSamples: native.frameSamples ?? undefined,
        channelLayout: (native.channelLayout ?? 'any') as ChannelLayout,
      });
    case 'audio-encoded':
      return MediaCaps.encodedAudio(native.format as Codec);
    case 'text':
      return MediaCaps.text();
    case 'event':
      return MediaCaps.event();
    case 'metrics':
      return MediaCaps.metrics();
    case 'control':
      return MediaCaps.control();
    case 'binary':
      return MediaCaps.binary(native.format as BinaryFormat);
    case 'any':
      return MediaCaps.any();
  }
}
