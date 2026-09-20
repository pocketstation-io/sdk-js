import type { InterruptionTrigger } from './configuration.js';
import {
  immutableArray,
  immutableStrings,
  requireBoolean,
  requireFiniteNumber,
  requireOptionalPositiveInteger,
  validateSampleRates,
} from './validation.js';

/** Options for speech-recognition behavior supported by one transcriber. */
export interface TranscriptionCapabilitiesOptions {
  readonly streaming: boolean;
  readonly transcriptRevisions?: boolean;
  readonly stablePrefix?: boolean;
  readonly providerTimestamps?: boolean;
  readonly supportedSampleRatesHz?: readonly number[];
  readonly inputFormats?: readonly string[];
  readonly maximumSessionDurationS?: number;
}

/** Speech-recognition behavior supported by one transcriber. */
export class TranscriptionCapabilities {
  public readonly streaming: boolean;
  public readonly transcriptRevisions: boolean;
  public readonly stablePrefix: boolean;
  public readonly providerTimestamps: boolean;
  public readonly supportedSampleRatesHz: readonly number[];
  public readonly inputFormats: readonly string[];
  public readonly maximumSessionDurationS: number | undefined;

  public constructor(options: TranscriptionCapabilitiesOptions) {
    const sampleRates = options.supportedSampleRatesHz ?? [];
    requireBoolean('streaming', options.streaming);
    requireBoolean('transcriptRevisions', options.transcriptRevisions ?? false);
    requireBoolean('stablePrefix', options.stablePrefix ?? false);
    requireBoolean('providerTimestamps', options.providerTimestamps ?? false);
    validateSampleRates(sampleRates);
    if (options.maximumSessionDurationS !== undefined) {
      requireFiniteNumber(
        'maximumSessionDurationS',
        options.maximumSessionDurationS,
        0,
        86_400,
      );
    }
    this.streaming = options.streaming;
    this.transcriptRevisions = options.transcriptRevisions ?? false;
    this.stablePrefix = options.stablePrefix ?? false;
    this.providerTimestamps = options.providerTimestamps ?? false;
    this.supportedSampleRatesHz = immutableArray(sampleRates);
    this.inputFormats = immutableStrings(options.inputFormats ?? []);
    this.maximumSessionDurationS = options.maximumSessionDurationS;
    Object.freeze(this);
  }
}

/** Options for incremental response behavior. */
export interface ResponseCapabilitiesOptions {
  readonly streaming: boolean;
  readonly speculativeRequests?: boolean;
  readonly cancellation?: boolean;
  readonly tools?: boolean;
  readonly usageReporting?: boolean;
  readonly providerHistoryTruncation?: boolean;
  readonly maximumContextCharacters?: number;
}

/** Incremental response behavior supported by one response model. */
export class ResponseCapabilities {
  public readonly streaming: boolean;
  public readonly speculativeRequests: boolean;
  public readonly cancellation: boolean;
  public readonly tools: boolean;
  public readonly usageReporting: boolean;
  public readonly providerHistoryTruncation: boolean;
  public readonly maximumContextCharacters: number | undefined;

  public constructor(options: ResponseCapabilitiesOptions) {
    requireBoolean('streaming', options.streaming);
    requireBoolean('speculativeRequests', options.speculativeRequests ?? false);
    requireBoolean('cancellation', options.cancellation ?? false);
    requireBoolean('tools', options.tools ?? false);
    requireBoolean('usageReporting', options.usageReporting ?? false);
    requireBoolean(
      'providerHistoryTruncation',
      options.providerHistoryTruncation ?? false,
    );
    requireOptionalPositiveInteger(
      'maximumContextCharacters',
      options.maximumContextCharacters,
    );
    this.streaming = options.streaming;
    this.speculativeRequests = options.speculativeRequests ?? false;
    this.cancellation = options.cancellation ?? false;
    this.tools = options.tools ?? false;
    this.usageReporting = options.usageReporting ?? false;
    this.providerHistoryTruncation =
      options.providerHistoryTruncation ?? false;
    this.maximumContextCharacters = options.maximumContextCharacters;
    Object.freeze(this);
  }
}

/** Options for generated-audio behavior. */
export interface SynthesisCapabilitiesOptions {
  readonly streaming: boolean;
  readonly cancellation?: boolean;
  readonly outputFormats?: readonly string[];
  readonly supportedSampleRatesHz?: readonly number[];
  readonly usageReporting?: boolean;
}

/** Generated-audio behavior supported by one speech synthesizer. */
export class SynthesisCapabilities {
  public readonly streaming: boolean;
  public readonly cancellation: boolean;
  public readonly outputFormats: readonly string[];
  public readonly supportedSampleRatesHz: readonly number[];
  public readonly usageReporting: boolean;

  public constructor(options: SynthesisCapabilitiesOptions) {
    const sampleRates = options.supportedSampleRatesHz ?? [];
    requireBoolean('streaming', options.streaming);
    requireBoolean('cancellation', options.cancellation ?? false);
    requireBoolean('usageReporting', options.usageReporting ?? false);
    validateSampleRates(sampleRates);
    this.streaming = options.streaming;
    this.cancellation = options.cancellation ?? false;
    this.outputFormats = immutableStrings(options.outputFormats ?? []);
    this.supportedSampleRatesHz = immutableArray(sampleRates);
    this.usageReporting = options.usageReporting ?? false;
    Object.freeze(this);
  }
}

/** Options for speech-activity information. */
export interface SpeechDetectionCapabilitiesOptions {
  readonly streaming?: boolean;
  readonly provisionalEvents?: boolean;
  readonly confidence?: boolean;
  readonly providerTimestamps?: boolean;
  readonly supportedSampleRatesHz?: readonly number[];
}

/** Speech-activity information supported by one detector. */
export class SpeechDetectionCapabilities {
  public readonly streaming: boolean;
  public readonly provisionalEvents: boolean;
  public readonly confidence: boolean;
  public readonly providerTimestamps: boolean;
  public readonly supportedSampleRatesHz: readonly number[];

  public constructor(options: SpeechDetectionCapabilitiesOptions = {}) {
    const sampleRates = options.supportedSampleRatesHz ?? [];
    requireBoolean('streaming', options.streaming ?? true);
    requireBoolean('provisionalEvents', options.provisionalEvents ?? false);
    requireBoolean('confidence', options.confidence ?? false);
    requireBoolean('providerTimestamps', options.providerTimestamps ?? false);
    validateSampleRates(sampleRates);
    this.streaming = options.streaming ?? true;
    this.provisionalEvents = options.provisionalEvents ?? false;
    this.confidence = options.confidence ?? false;
    this.providerTimestamps = options.providerTimestamps ?? false;
    this.supportedSampleRatesHz = immutableArray(sampleRates);
    Object.freeze(this);
  }
}

/** Options for one stateful duplex voice connection. */
export interface DuplexVoiceCapabilitiesOptions {
  readonly transcriptRevisions?: boolean;
  readonly stablePrefix?: boolean;
  readonly providerSpeechDetection?: boolean;
  readonly interruption?: boolean;
  readonly interruptionTriggers?: readonly InterruptionTrigger[];
  readonly responseCancellation?: boolean;
  readonly providerHistoryTruncation?: boolean;
  readonly receiverPlayoutClear?: boolean;
  readonly playoutAcknowledgement?: boolean;
  readonly tools?: boolean;
  readonly usageReporting?: boolean;
  readonly inputFormats?: readonly string[];
  readonly outputFormats?: readonly string[];
  readonly supportedSampleRatesHz?: readonly number[];
  readonly maximumSessionDurationS?: number;
}

const INTERRUPTION_TRIGGERS = new Set<InterruptionTrigger>([
  'speech-started',
  'transcript-update',
]);

/** Voice behavior supplied through one stateful audio connection. */
export class DuplexVoiceCapabilities {
  public readonly transcriptRevisions: boolean;
  public readonly stablePrefix: boolean;
  public readonly providerSpeechDetection: boolean;
  public readonly interruption: boolean;
  public readonly interruptionTriggers: readonly InterruptionTrigger[];
  public readonly responseCancellation: boolean;
  public readonly providerHistoryTruncation: boolean;
  public readonly receiverPlayoutClear: boolean;
  public readonly playoutAcknowledgement: boolean;
  public readonly tools: boolean;
  public readonly usageReporting: boolean;
  public readonly inputFormats: readonly string[];
  public readonly outputFormats: readonly string[];
  public readonly supportedSampleRatesHz: readonly number[];
  public readonly maximumSessionDurationS: number | undefined;

  public constructor(options: DuplexVoiceCapabilitiesOptions = {}) {
    const triggers = options.interruptionTriggers ?? [];
    const sampleRates = options.supportedSampleRatesHz ?? [];
    const interruption = options.interruption ?? false;
    const flags: readonly [string, boolean][] = [
      ['transcriptRevisions', options.transcriptRevisions ?? false],
      ['stablePrefix', options.stablePrefix ?? false],
      ['providerSpeechDetection', options.providerSpeechDetection ?? false],
      ['interruption', interruption],
      ['responseCancellation', options.responseCancellation ?? false],
      ['providerHistoryTruncation', options.providerHistoryTruncation ?? false],
      ['receiverPlayoutClear', options.receiverPlayoutClear ?? false],
      ['playoutAcknowledgement', options.playoutAcknowledgement ?? false],
      ['tools', options.tools ?? false],
      ['usageReporting', options.usageReporting ?? false],
    ];
    for (const [name, value] of flags) requireBoolean(name, value);
    validateSampleRates(sampleRates);
    if (new Set(triggers).size !== triggers.length) {
      throw new RangeError('interruptionTriggers must not contain duplicates');
    }
    if (triggers.some((trigger) => !INTERRUPTION_TRIGGERS.has(trigger))) {
      throw new RangeError('interruptionTriggers contains an unsupported value');
    }
    if (interruption && triggers.length === 0) {
      throw new RangeError(
        'interruptionTriggers is required when interruption is supported',
      );
    }
    if (!interruption && triggers.length > 0) {
      throw new RangeError(
        'interruptionTriggers requires interruption to be supported',
      );
    }
    if (options.maximumSessionDurationS !== undefined) {
      requireFiniteNumber(
        'maximumSessionDurationS',
        options.maximumSessionDurationS,
        0,
        86_400,
      );
    }
    this.transcriptRevisions = options.transcriptRevisions ?? false;
    this.stablePrefix = options.stablePrefix ?? false;
    this.providerSpeechDetection = options.providerSpeechDetection ?? false;
    this.interruption = interruption;
    this.interruptionTriggers = immutableArray(triggers);
    this.responseCancellation = options.responseCancellation ?? false;
    this.providerHistoryTruncation =
      options.providerHistoryTruncation ?? false;
    this.receiverPlayoutClear = options.receiverPlayoutClear ?? false;
    this.playoutAcknowledgement = options.playoutAcknowledgement ?? false;
    this.tools = options.tools ?? false;
    this.usageReporting = options.usageReporting ?? false;
    this.inputFormats = immutableStrings(options.inputFormats ?? []);
    this.outputFormats = immutableStrings(options.outputFormats ?? []);
    this.supportedSampleRatesHz = immutableArray(sampleRates);
    this.maximumSessionDurationS = options.maximumSessionDurationS;
    Object.freeze(this);
  }
}

/** Options describing one validated provider-neutral voice composition. */
export interface VoiceCapabilitiesOptions {
  readonly transcription?: TranscriptionCapabilities;
  readonly response?: ResponseCapabilities;
  readonly synthesis?: SynthesisCapabilities;
  readonly speechDetection?: SpeechDetectionCapabilities;
  readonly duplex?: DuplexVoiceCapabilities;
}

/** Capabilities of one validated voice composition. */
export class VoiceCapabilities {
  public readonly transcription: TranscriptionCapabilities | undefined;
  public readonly response: ResponseCapabilities | undefined;
  public readonly synthesis: SynthesisCapabilities | undefined;
  public readonly speechDetection: SpeechDetectionCapabilities | undefined;
  public readonly duplex: DuplexVoiceCapabilities | undefined;

  public constructor(options: VoiceCapabilitiesOptions = {}) {
    if (
      options.duplex !== undefined &&
      (options.transcription !== undefined ||
        options.response !== undefined ||
        options.synthesis !== undefined)
    ) {
      throw new RangeError(
        'duplex capabilities cannot be combined with separate transcription, response, or synthesis capabilities',
      );
    }
    this.transcription = options.transcription;
    this.response = options.response;
    this.synthesis = options.synthesis;
    this.speechDetection = options.speechDetection;
    this.duplex = options.duplex;
    Object.freeze(this);
  }
}
