/**
 * Native desktop audio capture and Session composition for Node.js.
 *
 * @packageDocumentation
 */
export { PocketStationError } from './errors.js';
export {
  EventStream,
  type EndpointFailureEvent,
  type EventReadOptions,
  type LifecycleEvent,
  type SessionControlFailureEvent,
  type SessionEvent,
  type SessionState,
  type SourceFailure,
  type SourceFailureEvent,
  type TerminalEvent,
} from './events.js';
export {
  Endpoint,
  RunningSession,
  Session,
  Stem,
  type SessionOptions,
  type StopResult,
} from './session.js';
export {
  CapturePermissionLifecycle,
  DiscoveredSource,
  Source,
  applicationCaptureAvailable,
  discoverSources,
  microphonePermissionObservation,
  type ApplicationPolicyObservation,
  type ApplicationSelection,
  type AuthorizationOptions,
  type CaptureAuthorizationSnapshot,
  type CaptureCapabilityState,
  type CaptureOpenOutcome,
  type CapturePermissionTransition,
  type CaptureScope,
  type CaptureSessionGrant,
  type PermissionObservation,
  type Platform,
  type ProcessInstanceSelector,
  type ProcessTreeScope,
  type SelectorPersistenceScope,
  type SourceIdentityStrength,
  type SourceKind,
  type SourceQuery,
  type SourceState,
  type StableSourceId,
} from './sources.js';
export {
  AudioStream,
  type AudioFrame,
  type AudioReadOptions,
} from './streams.js';
