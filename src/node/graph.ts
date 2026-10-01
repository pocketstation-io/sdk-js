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

/** Runtime signal-family values understood by the native graph compiler. */
export const SignalKind = Object.freeze({
  ANY: 'any',
  PCM_AUDIO: 'pcm-audio',
  ENCODED_AUDIO: 'encoded-audio',
  TEXT: 'text',
  EVENT: 'event',
  METRICS: 'metrics',
  CONTROL: 'control',
  BINARY: 'binary',
  CUSTOM: 'custom',
} as const);

/** Signal families understood by the native graph compiler. */
export type SignalKind = (typeof SignalKind)[keyof typeof SignalKind];

/** Encoded-audio formats supported by Core media descriptions. */
export const Codec = Object.freeze({
  OPUS: 'opus',
  AAC: 'aac',
  MP3: 'mp3',
  G711_ULAW: 'g711-ulaw',
  G711_ALAW: 'g711-alaw',
  WEBM_OPUS: 'webm-opus',
  /** @deprecated Use `OPUS`. */
  Opus: 'opus',
  /** @deprecated Use `AAC`. */
  Aac: 'aac',
  /** @deprecated Use `MP3`. */
  Mp3: 'mp3',
  /** @deprecated Use `G711_ULAW`. */
  G711Ulaw: 'g711-ulaw',
  /** @deprecated Use `G711_ALAW`. */
  G711Alaw: 'g711-alaw',
  /** @deprecated Use `WEBM_OPUS`. */
  WebmOpus: 'webm-opus',
} as const);
/** One encoded-audio format accepted by Core. */
export type Codec = (typeof Codec)[keyof typeof Codec];

/** Runtime text encodings supported by `SignalSpec.text()`. */
export const TextFormat = Object.freeze({
  UTF8: 'utf8',
  JSON: 'json',
  MARKDOWN: 'markdown',
} as const);
/** Text encodings supported by `SignalSpec.text()`. */
export type TextFormat = (typeof TextFormat)[keyof typeof TextFormat];

/** Runtime event encodings supported by `SignalSpec.event()`. */
export const EventFormat = Object.freeze({
  JSON: 'json',
  PROTOBUF: 'protobuf',
  FLATBUFFERS: 'flatbuffers',
  CBOR: 'cbor',
} as const);
/** Event encodings supported by `SignalSpec.event()`. */
export type EventFormat = (typeof EventFormat)[keyof typeof EventFormat];

/** Runtime binary encodings supported by `SignalSpec.binary()`. */
export const BinaryFormat = Object.freeze({
  RAW: 'raw',
  PROTOBUF: 'protobuf',
  FLATBUFFERS: 'flatbuffers',
  CBOR: 'cbor',
} as const);
/** Binary encodings supported by `SignalSpec.binary()`. */
export type BinaryFormat = (typeof BinaryFormat)[keyof typeof BinaryFormat];

/** Any format carried by a built-in SignalSpec family. */
export type SignalFormat = Codec | TextFormat | EventFormat | BinaryFormat;

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
  public get format(): SignalFormat | undefined {
    return this.#native.format as SignalFormat | undefined;
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

/** Runtime media representations understood by Core. */
export const MediaKind = Object.freeze({
  AUDIO_PCM: 'audio-pcm',
  AUDIO_ENCODED: 'audio-encoded',
  TEXT: 'text',
  EVENT: 'event',
  METRICS: 'metrics',
  CONTROL: 'control',
  BINARY: 'binary',
  ANY: 'any',
} as const);
/** Media representations understood by Core. */
export type MediaKind = (typeof MediaKind)[keyof typeof MediaKind];

/** Runtime PCM channel layouts plus their exact channel count. */
export const ChannelLayout = Object.freeze({
  MONO: 'mono',
  STEREO: 'stereo',
  ANY: 'any',
  channelCount(layout: 'mono' | 'stereo' | 'any'): number | undefined {
    if (layout === 'mono') return 1;
    if (layout === 'stereo') return 2;
    return undefined;
  },
} as const);
/** Channel requirements for PCM audio. */
export type ChannelLayout =
  | typeof ChannelLayout.MONO
  | typeof ChannelLayout.STEREO
  | typeof ChannelLayout.ANY;

/** Runtime PCM sample representations supported by Core. */
export const SampleFormat = Object.freeze({
  F32_INTERLEAVED: 'f32-interleaved',
} as const);
/** PCM sample representation supported by Core. */
export type SampleFormat = (typeof SampleFormat)[keyof typeof SampleFormat];

/** Optional PCM requirements used during native media negotiation. */
export interface AudioCapsOptions {
  /** Required sample rate in hertz, or any rate when omitted. */
  readonly sampleRateHz?: number;
  /** Required samples per frame, or any frame size when omitted. */
  readonly frameSamples?: number;
  /** Required channel layout, or any layout when omitted. */
  readonly channelLayout?: ChannelLayout;
  /** PCM sample representation. Core currently accepts interleaved float32. */
  readonly format?: SampleFormat;
}

/** Immutable physical PCM requirements; omitted numeric fields are wildcards. */
export class AudioCaps {
  public readonly sampleRateHz: number | undefined;
  public readonly frameSamples: number | undefined;
  public readonly channelLayout: ChannelLayout;
  public readonly format: SampleFormat;

  public constructor(options: AudioCapsOptions = {}) {
    this.sampleRateHz = options.sampleRateHz;
    this.frameSamples = options.frameSamples;
    this.channelLayout = options.channelLayout ?? ChannelLayout.ANY;
    this.format = options.format ?? SampleFormat.F32_INTERLEAVED;
    if (this.format !== SampleFormat.F32_INTERLEAVED) {
      throw new RangeError(`unsupported PCM sample format ${this.format}`);
    }
    Object.freeze(this);
  }
}

/** Codec or binary format carried by non-PCM media. */
export type MediaFormat = Codec | BinaryFormat;

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
  public static audio(caps: AudioCaps | AudioCapsOptions = new AudioCaps()): MediaCaps {
    const resolved = caps instanceof AudioCaps ? caps : new AudioCaps(caps);
    return MediaCaps.create('audio-pcm', {
      sampleRateHz: resolved.sampleRateHz,
      frameSamples: resolved.frameSamples,
      channelLayout: resolved.channelLayout,
    });
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
  public get format(): MediaFormat | undefined {
    return this.#native.format as MediaFormat | undefined;
  }

  /** Physical PCM requirements, or `undefined` for non-PCM media. */
  public get audioCaps(): AudioCaps | undefined {
    if (this.kind !== MediaKind.AUDIO_PCM) return undefined;
    return new AudioCaps({
      sampleRateHz: this.sampleRateHz,
      frameSamples: this.frameSamples,
      channelLayout: this.channelLayout ?? ChannelLayout.ANY,
    });
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

/** Runtime directions for one named Operator or Endpoint port. */
export const PortDirection = Object.freeze({ INPUT: 'input', OUTPUT: 'output' } as const);
/** Direction of one named Operator or Endpoint port. */
export type PortDirection = (typeof PortDirection)[keyof typeof PortDirection];

/** Runtime multiplicities for one named graph port. */
export const Multiplicity = Object.freeze({ ONE: 'one', MANY: 'many' } as const);
/** Whether a port accepts one connection or several. */
export type Multiplicity = (typeof Multiplicity)[keyof typeof Multiplicity];

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

/** Runtime clock domains and their realtime classification. */
export const ClockDomain = Object.freeze({
  CAPTURE: 'capture',
  PLAYBACK: 'playback',
  NETWORK: 'network',
  INHERITED: 'inherited',
  WALLCLOCK: 'wallclock',
  isRealtime(domain: 'capture' | 'playback' | 'network' | 'inherited' | 'wallclock'): boolean {
    return domain === 'capture' || domain === 'playback';
  },
} as const);
/** Clock source used to interpret media timestamps. */
export type ClockDomain =
  | typeof ClockDomain.CAPTURE
  | typeof ClockDomain.PLAYBACK
  | typeof ClockDomain.NETWORK
  | typeof ClockDomain.INHERITED
  | typeof ClockDomain.WALLCLOCK;

/** Runtime behavior when a route reaches its finite capacity. */
export const BackpressurePolicy = Object.freeze({
  DROP_NEWEST: 'drop-newest',
  DROP_OLDEST: 'drop-oldest',
  BOUNDED_QUEUE: 'bounded-queue',
  BLOCK_FORBIDDEN: 'block-forbidden',
} as const);
/** Behavior when a route reaches its finite capacity. */
export type BackpressurePolicy =
  (typeof BackpressurePolicy)[keyof typeof BackpressurePolicy];

/** Behavior used when a route has reached its native capacity. */
export type QueuePressure = 'drop-newest' | 'drop-oldest' | 'buffer' | 'fail';

/** Runtime ordering and delivery guarantees. */
export const DeliverySemantics = Object.freeze({
  BEST_EFFORT_REALTIME: 'best-effort-realtime',
  ORDERED: 'ordered',
  EXACTLY_ONCE_NOT_REALTIME: 'exactly-once-not-realtime',
} as const);
/** Ordering and delivery guarantee selected for a route. */
export type DeliverySemantics =
  (typeof DeliverySemantics)[keyof typeof DeliverySemantics];

/** Runtime missing-media behavior. */
export const LossPolicy = Object.freeze({
  CONCEAL_FOR_AUDIO: 'conceal-for-audio',
  MUST_DELIVER_OR_FAIL: 'must-deliver-or-fail',
  DROP_ALLOWED: 'drop-allowed',
} as const);
/** How a route treats missing media. */
export type LossPolicy = (typeof LossPolicy)[keyof typeof LossPolicy];

/** Runtime frame-memory behavior compiled for a route. */
export const CopyPolicy = Object.freeze({
  MOVE_EXCLUSIVE: 'move-exclusive',
  SHARE_READ_ONLY: 'share-read-only',
  COPY_TO_BRANCH_POOL: 'copy-to-branch-pool',
} as const);
/** Frame-memory behavior compiled for a route. */
export type CopyPolicy = (typeof CopyPolicy)[keyof typeof CopyPolicy];

/** How frame memory may be transferred between native branches. */
export type FrameOwnership = 'move' | 'share' | 'copy';

/** Runtime observation levels retained for a route. */
export const RouteObservability = Object.freeze({
  OFF: 'off',
  COUNTERS: 'counters',
  FULL: 'full',
  rank(value: 'off' | 'counters' | 'full'): number {
    if (value === 'off') return 0;
    if (value === 'counters') return 1;
    return 2;
  },
} as const);
/** Native observations retained for a route. */
export type RouteObservability =
  | typeof RouteObservability.OFF
  | typeof RouteObservability.COUNTERS
  | typeof RouteObservability.FULL;

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

  /** Native delivery defaults for bounded off-realtime signals. */
  public static boundedAsync(): DeliveryPolicy {
    return new DeliveryPolicy(nativeAddon().NativeDeliveryPolicy.buffered());
  }

  /** @deprecated Use `boundedAsync()`. */
  public static buffered(): DeliveryPolicy {
    return DeliveryPolicy.boundedAsync();
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
  public get backpressure(): BackpressurePolicy {
    return backpressureFromNative(this.#native.backpressure);
  }

  /** @deprecated Use `backpressure`. */
  public get queuePressure(): QueuePressure {
    return queuePressureFromPolicy(this.backpressure);
  }

  /** Ordering and delivery guarantee. */
  public get delivery(): DeliverySemantics {
    return this.#native.delivery as DeliverySemantics;
  }

  /** Missing-media behavior. */
  public get loss(): LossPolicy {
    return lossFromNative(this.#native.loss);
  }

  /** Frame-memory behavior compiled for this route. */
  public get copyPolicy(): CopyPolicy {
    return copyPolicyFromNative(this.#native.copyPolicy);
  }

  /** @deprecated Use `copyPolicy`. */
  public get frameOwnership(): FrameOwnership {
    return frameOwnershipFromPolicy(this.copyPolicy);
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
  public withBackpressure(value: BackpressurePolicy): DeliveryPolicy {
    return new DeliveryPolicy(
      nativeCallSync(() => this.#native.withBackpressure(queuePressureFromPolicy(value))),
    );
  }

  /** Return a copy with an explicit missing-media guarantee. */
  public withLoss(value: LossPolicy): DeliveryPolicy {
    return new DeliveryPolicy(nativeCallSync(() => this.#native.withLoss(value)));
  }

  /** Return a copy with different frame-memory behavior. */
  public withCopyPolicy(value: CopyPolicy): DeliveryPolicy {
    return new DeliveryPolicy(
      nativeCallSync(() => this.#native.withCopyPolicy(frameOwnershipFromPolicy(value))),
    );
  }

  /** @deprecated Use `withBackpressure()`. */
  public withQueuePressure(value: QueuePressure): DeliveryPolicy {
    return this.withBackpressure(backpressureFromNative(value));
  }

  /** @deprecated Use `withCopyPolicy()`. */
  public withFrameOwnership(value: FrameOwnership): DeliveryPolicy {
    return this.withCopyPolicy(copyPolicyFromNative(value));
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

  /** Native media and delivery defaults for bounded off-realtime signals. */
  public static boundedAsync(): RouteSettings {
    return new RouteSettings(nativeAddon().NativeRouteSettings.buffered());
  }

  /** @deprecated Use `boundedAsync()`. */
  public static buffered(): RouteSettings {
    return RouteSettings.boundedAsync();
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
  public get deliveryPolicy(): DeliveryPolicy {
    return DeliveryPolicy._fromNative(this.#native.deliveryPolicy);
  }

  /** Ordering and delivery guarantee selected for this route. */
  public get delivery(): DeliverySemantics {
    return this.deliveryPolicy.delivery;
  }

  public get clock(): ClockDomain {
    return this.deliveryPolicy.clock;
  }

  public get latencyBudgetMs(): number | undefined {
    return this.deliveryPolicy.latencyBudgetMs;
  }

  public get jitterBudgetMs(): number | undefined {
    return this.deliveryPolicy.jitterBudgetMs;
  }

  public get backpressure(): BackpressurePolicy {
    return this.deliveryPolicy.backpressure;
  }

  public get loss(): LossPolicy {
    return this.deliveryPolicy.loss;
  }

  public get copyPolicy(): CopyPolicy {
    return this.deliveryPolicy.copyPolicy;
  }

  public get observability(): RouteObservability {
    return this.deliveryPolicy.observability;
  }

  public get maxPayloadBytes(): number | undefined {
    return this.deliveryPolicy.maxPayloadBytes;
  }

  /** Return a copy with different media requirements. */
  public withMedia(media: MediaCaps): RouteSettings {
    return new RouteSettings(this.#native.withMedia(media._nativeHandle()));
  }

  /** Return a copy with different delivery behavior. */
  public withDeliveryPolicy(delivery: DeliveryPolicy): RouteSettings {
    return new RouteSettings(
      this.#native.withDelivery(delivery._nativeHandle()),
    );
  }

  /** @deprecated Use `withDeliveryPolicy()`. */
  public withDelivery(delivery: DeliveryPolicy): RouteSettings {
    return this.withDeliveryPolicy(delivery);
  }

  public withBackpressure(policy: BackpressurePolicy): RouteSettings {
    return this.withDeliveryPolicy(this.deliveryPolicy.withBackpressure(policy));
  }

  public withCopyPolicy(policy: CopyPolicy): RouteSettings {
    return this.withDeliveryPolicy(this.deliveryPolicy.withCopyPolicy(policy));
  }

  public withJitterBudgetMs(value?: number): RouteSettings {
    return this.withDeliveryPolicy(this.deliveryPolicy.withJitterBudgetMs(value));
  }

  public withMaxPayloadBytes(value: number): RouteSettings {
    return this.withDeliveryPolicy(this.deliveryPolicy.withMaxPayloadBytes(value));
  }

  /** @internal */
  public _nativeHandle(): NativeRouteSettingsHandle {
    return this.#native;
  }
}

function backpressureFromNative(value: string): BackpressurePolicy {
  switch (value) {
    case 'drop-newest':
      return BackpressurePolicy.DROP_NEWEST;
    case 'drop-oldest':
      return BackpressurePolicy.DROP_OLDEST;
    case 'buffer':
    case 'bounded-queue':
      return BackpressurePolicy.BOUNDED_QUEUE;
    case 'fail':
    case 'block-forbidden':
      return BackpressurePolicy.BLOCK_FORBIDDEN;
    default:
      throw new RangeError(`unsupported backpressure policy ${value}`);
  }
}

function queuePressureFromPolicy(value: BackpressurePolicy): QueuePressure {
  switch (value) {
    case 'drop-newest':
    case 'drop-oldest':
      return value;
    case 'bounded-queue':
      return 'buffer';
    case 'block-forbidden':
      return 'fail';
  }
}

function copyPolicyFromNative(value: string): CopyPolicy {
  switch (value) {
    case 'move':
    case 'move-exclusive':
      return CopyPolicy.MOVE_EXCLUSIVE;
    case 'share':
    case 'share-read-only':
      return CopyPolicy.SHARE_READ_ONLY;
    case 'copy':
    case 'copy-to-branch-pool':
      return CopyPolicy.COPY_TO_BRANCH_POOL;
    default:
      throw new RangeError(`unsupported copy policy ${value}`);
  }
}

function frameOwnershipFromPolicy(value: CopyPolicy): FrameOwnership {
  switch (value) {
    case 'move-exclusive':
      return 'move';
    case 'share-read-only':
      return 'share';
    case 'copy-to-branch-pool':
      return 'copy';
  }
}

function lossFromNative(value: string): LossPolicy {
  switch (value) {
    case 'conceal-audio':
    case 'conceal-for-audio':
      return LossPolicy.CONCEAL_FOR_AUDIO;
    case 'deliver-or-fail':
    case 'must-deliver-or-fail':
      return LossPolicy.MUST_DELIVER_OR_FAIL;
    case 'drop-allowed':
      return LossPolicy.DROP_ALLOWED;
    default:
      throw new RangeError(`unsupported loss policy ${value}`);
  }
}

/** Configuration value marked for native redaction. */
export interface SecretValue {
  /** Unredacted value passed to the registered implementation. */
  readonly value: string;
  /** Marker that prevents this value from appearing in diagnostics and traces. */
  readonly secret: true;
  /** Redacted form used by JSON diagnostics and structured logs. */
  toJSON(): '<redacted>';
}

/** String configuration passed to a registered native implementation. */
export type ConfigurationValue = string | SecretValue;
/** Immutable configuration map for an Operator or Endpoint. */
export type Configuration = Readonly<Record<string, ConfigurationValue>>;
/** Object or entry sequence accepted by immutable configuration values. */
export type ConfigurationInput =
  | Configuration
  | Iterable<readonly [string, ConfigurationValue]>;
/** Object or entry sequence accepted by a registered Source declaration. */
export type SourceConfigurationInput =
  | Readonly<Record<string, string>>
  | Iterable<readonly [string, string]>;

/** Mark a configuration value for redaction in diagnostics and traces. */
export function secret(value: string): SecretValue {
  if (typeof value !== 'string') {
    throw new TypeError('secret configuration value must be a string');
  }
  const protectedValue = { value, secret: true } as SecretValue;
  Object.defineProperties(protectedValue, {
    toJSON: {
      value: (): '<redacted>' => '<redacted>',
      enumerable: false,
    },
    [Symbol.for('nodejs.util.inspect.custom')]: {
      value: (): string => 'secret(<redacted>)',
      enumerable: false,
    },
  });
  secretValues.add(protectedValue);
  return Object.freeze(protectedValue);
}

const secretValues = new WeakSet<object>();

function configurationValues(
  configuration: ConfigurationInput,
): readonly (readonly [string, ConfigurationValue])[] {
  const values = Symbol.iterator in Object(configuration)
    ? [...configuration as Iterable<readonly [string, ConfigurationValue]>]
    : Object.entries(configuration as Configuration);
  const seen = new Set<string>();
  for (const [key, value] of values) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError('configuration keys must be non-empty strings');
    }
    if (seen.has(key)) throw new TypeError(`duplicate configuration key ${key}`);
    if (typeof value !== 'string' && !isSecretValue(value)) {
      throw new TypeError('configuration values must be strings or SecretValue');
    }
    seen.add(key);
  }
  return Object.freeze(
    values
      .map(([key, value]) => Object.freeze([key, value] as const))
      .sort(([left], [right]) => compareExactText(left, right)),
  );
}

function isSecretValue(value: unknown): value is SecretValue {
  return typeof value === 'object' && value !== null && secretValues.has(value);
}

function compareExactText(left: string, right: string): number {
  const leftCodePoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightCodePoints = Array.from(right, (value) => value.codePointAt(0)!);
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftCodePoint = leftCodePoints[index]!;
    const rightCodePoint = rightCodePoints[index]!;
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint < rightCodePoint ? -1 : 1;
    }
  }
  return leftCodePoints.length - rightCodePoints.length;
}

function sourceConfigurationValues(
  configuration: SourceConfigurationInput,
): readonly (readonly [string, string])[] {
  return configurationValues(configuration as ConfigurationInput).map(
    ([key, value]) => {
      if (typeof value !== 'string') {
        throw new TypeError('Source configuration values must be strings');
      }
      return Object.freeze([key, value] as const);
    },
  );
}

/** Immutable configuration for one open Operator declaration. */
export class OperatorConfiguration {
  public readonly values: readonly (readonly [string, ConfigurationValue])[];

  public constructor(values: ConfigurationInput = {}) {
    this.values = configurationValues(values);
    Object.freeze(this);
  }

  public withValue(key: string, value: ConfigurationValue): OperatorConfiguration {
    return new OperatorConfiguration({ ...this.toObject(), [key]: value });
  }

  /** @internal */
  public toObject(): Configuration {
    return Object.freeze(Object.fromEntries(this.values));
  }
}

/** Immutable configuration for one open Source declaration. */
export class SourceConfiguration {
  public readonly values: readonly (readonly [string, string])[];

  public constructor(values: SourceConfigurationInput = {}) {
    this.values = Object.freeze([...sourceConfigurationValues(values)]);
    Object.freeze(this);
  }

  public withValue(key: string, value: string): SourceConfiguration {
    return new SourceConfiguration({ ...this.toObject(), [key]: value });
  }

  /** @internal */
  public toObject(): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries(this.values));
  }
}

/** Immutable configuration for one open Endpoint declaration. */
export class EndpointConfiguration {
  public readonly values: readonly (readonly [string, ConfigurationValue])[];

  public constructor(values: ConfigurationInput = {}) {
    this.values = configurationValues(values);
    Object.freeze(this);
  }

  public withValue(key: string, value: ConfigurationValue): EndpointConfiguration {
    return new EndpointConfiguration({ ...this.toObject(), [key]: value });
  }

  /** @internal */
  public toObject(): Configuration {
    return Object.freeze(Object.fromEntries(this.values));
  }
}

function configurationEntries(
  configuration:
    | Configuration
    | OperatorConfiguration
    | EndpointConfiguration = {},
): NativeConfigurationEntry[] {
  const values = configuration instanceof OperatorConfiguration ||
      configuration instanceof EndpointConfiguration
    ? configuration.values
    : configurationValues(configuration);
  return values.map(([key, entry]) =>
      typeof entry === 'string'
        ? { key, value: entry }
        : { key, value: entry.value, sensitive: true },
    );
}

/** Declares one configured Operator implementation by its stable identifier. */
export class Operator {
  readonly #native: NativeOperatorHandle;
  /** Stable identifier of the registered implementation. */
  public readonly operatorId: string;
  /** Immutable declaration configuration. */
  public readonly configuration: OperatorConfiguration;

  /** Declare one configured Operator. No worker starts in the constructor. */
  public constructor(
    operatorId: string,
    configuration: Configuration | OperatorConfiguration = {},
  ) {
    this.operatorId = operatorId;
    this.configuration = configuration instanceof OperatorConfiguration
      ? configuration
      : new OperatorConfiguration(configuration);
    this.#native = nativeCallSync(
      () => new (nativeAddon().NativeOperator)(
        operatorId,
        configurationEntries(this.configuration),
      ),
    );
    Object.freeze(this);
  }

  /** @deprecated Use `operatorId`. */
  public get id(): string {
    return this.operatorId;
  }

  /** @internal */
  public _nativeHandle(): NativeOperatorHandle {
    return this.#native;
  }
}

/** Declares one configured Endpoint implementation by its stable identifiers. */
export class EndpointDescriptor {
  readonly #native: NativeEndpointDefinitionHandle;
  /** Stable node type resolved by the Core compiler. */
  public readonly nodeTypeId: string;
  /** Stable identifier of the registered Endpoint implementation. */
  public readonly operatorId: string;
  /** Immutable Endpoint declaration configuration. */
  public readonly configuration: EndpointConfiguration;
  /** Optional route override compiled for this Endpoint. */
  public readonly routeSettings: RouteSettings | undefined;

  /** Declare one configured native destination. */
  public constructor(
    nodeTypeId: string,
    operatorId: string,
    options: {
      configuration?: Configuration | EndpointConfiguration;
      routeSettings?: RouteSettings;
      /** @deprecated Use `routeSettings`. */
      route?: RouteSettings;
    } = {},
  ) {
    if (
      options.routeSettings !== undefined &&
      options.route !== undefined &&
      options.routeSettings !== options.route
    ) {
      throw new TypeError('routeSettings and route must match when both are provided');
    }
    this.nodeTypeId = nodeTypeId;
    this.operatorId = operatorId;
    this.configuration = options.configuration instanceof EndpointConfiguration
      ? options.configuration
      : new EndpointConfiguration(options.configuration);
    this.routeSettings = options.routeSettings ?? options.route;
    this.#native = nativeCallSync(
      () =>
        new (nativeAddon().NativeEndpointDefinition)(
          nodeTypeId,
          operatorId,
          configurationEntries(this.configuration),
          this.routeSettings?._nativeHandle(),
        ),
    );
    Object.freeze(this);
  }

  /** @deprecated Use `nodeTypeId`. */
  public get nodeType(): string {
    return this.nodeTypeId;
  }

  /** @internal */
  public _nativeHandle(): NativeEndpointDefinitionHandle {
    return this.#native;
  }
}

/** @deprecated Use `EndpointDescriptor`. */
export class EndpointDefinition extends EndpointDescriptor {}

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
