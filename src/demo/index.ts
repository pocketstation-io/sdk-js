/** Optional provider integrations and executable proof helpers kept outside Core. */

export {
  AudioWindowBuffer,
  downmix,
  mono16Khz,
  resample,
  type AudioWindow,
} from './audio-windows.js';
export {
  WhisperTranscriber,
  WhisperTranscriberConfiguration,
  WhisperCliModel,
  type AudioConverter,
  type WhisperInfo,
  type WhisperModel,
  type WhisperModelFactory,
  type WhisperResult,
  type WhisperSegment,
} from './faster-whisper.js';
export {
  OpenAIRealtime,
  RealtimeVoiceConfig,
  TranscriptProgress,
  encodeRealtimeMicrophoneFrame,
  transcriptEventValues,
  type RealtimeSocket,
  type RealtimeSocketFactory,
  type RealtimeInput,
  type RealtimeTranscriptValues,
  type RealtimeVoiceObservations,
} from './openai-realtime.js';
export { TRANSCRIPT_SIGNAL, Transcript } from './transcript.js';
