/**
 * Provider-neutral contracts for finite live-voice composition.
 *
 * This package contains immutable values and lifecycle protocols only. It does
 * not load the Node native addon, browser media code, or a provider.
 */
export {
  DuplexVoiceCapabilities,
  ResponseCapabilities,
  SpeechDetectionCapabilities,
  SynthesisCapabilities,
  TranscriptionCapabilities,
  VoiceCapabilities,
  type DuplexVoiceCapabilitiesOptions,
  type ResponseCapabilitiesOptions,
  type SpeechDetectionCapabilitiesOptions,
  type SynthesisCapabilitiesOptions,
  type TranscriptionCapabilitiesOptions,
  type VoiceCapabilitiesOptions,
} from './capabilities.js';
export {
  ConversationConfig,
  InterruptionConfig,
  VoiceDeadlines,
  VoiceLimits,
  type ConversationConfigOptions,
  type ConversationConfigParts,
  type InterruptionConfigOptions,
  type InterruptionTrigger,
  type VoiceDeadlinesOptions,
  type VoiceLimitsOptions,
} from './configuration.js';
export {
  type DuplexConnectResult,
  type DuplexVoiceConnection,
  DuplexVoiceContext,
  type DuplexVoiceModel,
} from './duplex.js';
export {
  MissingProviderCredentialError,
  ProviderStartupError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  UnsupportedVoiceCapabilityError,
  VoiceConfigurationError,
  VoiceError,
  type VoiceErrorOptions,
} from './errors.js';
export {
  VoiceEvent,
  type ConversationEvent,
  type VoiceEventOptions,
} from './events.js';
export {
  ConversationResponse,
  type ConversationResponseChunk,
  ResponseChunk,
  type ResponseChunkOptions,
  type ResponseItem,
  type ResponseModel,
  ResponseRequest,
  type ResponseResult,
  ToolEvent,
} from './response.js';
export {
  SpeechActivity,
  type SpeechActivityKind,
  type SpeechActivityOptions,
  type SpeechDetectionInput,
  type SpeechDetector,
} from './speech-detection.js';
export {
  type SpeechSynthesizer,
  SynthesisChunk,
  type SynthesisChunkOptions,
  type SynthesisItem,
  SynthesisRequest,
  type SynthesisResult,
} from './synthesis.js';
export {
  type StreamingTranscriber,
  TranscriptUpdate,
  type TranscriptUpdateOptions,
  type TranscriptionConnection,
  type TranscriptionInput,
} from './transcription.js';
export {
  ConversationContext,
  type ConversationDisposition,
  ConversationMessage,
  type ConversationMessageOptions,
  ConversationOutcome,
  type ConversationOutcomeOptions,
  type ConversationRole,
  ConversationTurn,
  type ConversationTurnOptions,
} from './turns.js';
