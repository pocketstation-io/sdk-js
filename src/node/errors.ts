const NATIVE_ERROR_SEPARATOR = '|';

import { PocketStationError } from '../errors.js';
import type { OperatorInstanceId } from './identity.js';

export { PocketStationError } from '../errors.js';

/** Base failure from Session declaration, startup, or runtime ownership. */
export class SessionError extends PocketStationError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, { cause });
    this.name = 'SessionError';
  }
}

/** The Session draft, selector, route, or declaration is invalid. */
export class SessionDeclarationError extends SessionError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = 'SessionDeclarationError';
  }
}

/** Fields that locate one native Session compile failure. */
export interface SessionCompileDiagnosticOptions {
  readonly code: string;
  readonly nodeIndex?: number;
  readonly edgeIndex?: number;
  readonly operatorId?: string;
  readonly operatorInstanceId?: OperatorInstanceId;
  readonly nodeTypeId?: string;
  readonly sourceTypeId?: string;
  readonly portName?: string;
  readonly direction?: string;
  readonly expected?: string;
  readonly actual?: string;
}

/** Immutable location and validation details for a Session compile failure. */
export class SessionCompileDiagnostic {
  public readonly code: string;
  public readonly nodeIndex: number | undefined;
  public readonly edgeIndex: number | undefined;
  public readonly operatorId: string | undefined;
  public readonly operatorInstanceId: OperatorInstanceId | undefined;
  public readonly nodeTypeId: string | undefined;
  public readonly sourceTypeId: string | undefined;
  public readonly portName: string | undefined;
  public readonly direction: string | undefined;
  public readonly expected: string | undefined;
  public readonly actual: string | undefined;

  public constructor(options: SessionCompileDiagnosticOptions) {
    if (options.code.trim().length === 0) {
      throw new TypeError('Session compile diagnostic code cannot be empty');
    }
    this.code = options.code;
    this.nodeIndex = optionalIndex('nodeIndex', options.nodeIndex);
    this.edgeIndex = optionalIndex('edgeIndex', options.edgeIndex);
    this.operatorId = options.operatorId;
    this.operatorInstanceId = options.operatorInstanceId;
    this.nodeTypeId = options.nodeTypeId;
    this.sourceTypeId = options.sourceTypeId;
    this.portName = options.portName;
    this.direction = options.direction;
    this.expected = options.expected;
    this.actual = options.actual;
    Object.freeze(this);
  }
}

/** Transactional Session startup failed before delivery became active. */
export class SessionStartError extends SessionError {
  public readonly diagnostic: SessionCompileDiagnostic | undefined;

  public constructor(
    code: string,
    message: string,
    diagnostic?: SessionCompileDiagnostic,
    cause?: unknown,
  ) {
    super(code, message, cause);
    this.name = 'SessionStartError';
    this.diagnostic = diagnostic;
  }
}

/** The running Session or its native owner became unavailable. */
export class SessionRuntimeError extends SessionError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = 'SessionRuntimeError';
  }
}

/** Capture authorization, availability, or backend startup failed. */
export class CaptureError extends SessionStartError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, undefined, cause);
    this.name = 'CaptureError';
  }
}

/** A graph, signal, port, edge, or media declaration is invalid. */
export class GraphError extends PocketStationError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, { cause });
    this.name = 'GraphError';
  }
}

/** An application-authored Source failed validation or lifecycle work. */
export class SourceError extends PocketStationError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, { cause });
    this.name = 'SourceError';
  }
}

/** An application-authored Operator failed validation or lifecycle work. */
export class OperatorError extends PocketStationError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, { cause });
    this.name = 'OperatorError';
  }
}

/** Connector registration, declaration, or runtime ownership failed. */
export class ConnectorRuntimeError extends PocketStationError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, { cause });
    this.name = 'ConnectorRuntimeError';
  }
}

/** Base failure for managed consumption of one bounded stream. */
export class StreamError extends PocketStationError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, { cause });
    this.name = 'StreamError';
  }
}

/** A stream cannot change consumption mode after its first read. */
export class StreamModeError extends StreamError {
  /** Permanently selected reader mode. */
  public readonly activeMode: string;
  /** Incompatible mode requested by the caller. */
  public readonly requestedMode: string;

  public constructor(activeMode: string, requestedMode: string) {
    super(
      'stream.mode_conflict',
      `Stream already uses ${activeMode}; cannot switch to ${requestedMode}`,
    );
    this.name = 'StreamModeError';
    this.activeMode = activeMode;
    this.requestedMode = requestedMode;
  }
}

/** Another caller already owns the stream's selected reader mode. */
export class StreamInUseError extends StreamError {
  /** Reader mode currently in use. */
  public readonly mode: string;

  public constructor(mode: string) {
    super('stream.in_use', `Stream already has an active ${mode} reader`);
    this.name = 'StreamInUseError';
    this.mode = mode;
  }
}

/** Native extension loading or descriptor validation failed. */
export class ExtensionError extends PocketStationError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, { cause });
    this.name = 'ExtensionError';
  }
}

/** A Session-owned child process failed. */
export class SidecarError extends PocketStationError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, { cause });
    this.name = 'SidecarError';
  }
}

/** A sidecar queue rejected a message because its configured capacity was full. */
export class SidecarBackpressureError extends SidecarError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = 'SidecarBackpressureError';
  }
}

/** A sidecar sent or received an invalid PKSS message. */
export class SidecarProtocolError extends SidecarError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = 'SidecarProtocolError';
  }
}

/** A sidecar missed a configured lifecycle or processing deadline. */
export class SidecarTimeoutError extends SidecarError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = 'SidecarTimeoutError';
  }
}

/** Base failure from one bounded application-owned PCM input. */
export class AudioInputError extends PocketStationError {
  public constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.name = 'AudioInputError';
  }
}

/** Core had no capacity for another complete frame. */
export class AudioInputFullError extends AudioInputError {
  public constructor(message = 'audio input is full', options?: { cause?: unknown }) {
    super('audio_input.full', message, options);
    this.name = 'AudioInputFullError';
  }
}

/** A write was attempted after the AudioInput closed. */
export class AudioInputClosedError extends AudioInputError {
  public constructor(message = 'audio input is closed', options?: { cause?: unknown }) {
    super('audio_input.closed', message, options);
    this.name = 'AudioInputClosedError';
  }
}

/** The owning Session cancelled an AudioInput before accepting the frame. */
export class AudioInputCancelledError extends AudioInputError {
  public constructor(
    message = 'audio input Session was cancelled',
    options?: { cause?: unknown },
  ) {
    super('audio_input.cancelled', message, options);
    this.name = 'AudioInputCancelledError';
  }
}

/** Samples did not match the configured contiguous float32 frame. */
export class AudioInputBufferError extends AudioInputError {
  public constructor(
    message: string,
    options?: { cause?: unknown; code?: string },
  ) {
    super(options?.code ?? 'audio_input.invalid_buffer', message, options);
    this.name = 'AudioInputBufferError';
  }
}

/** An AudioInput name, format, frame size, or capacity is invalid. */
export class AudioInputConfigurationError extends AudioInputBufferError {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, { ...options, code: 'audio_input.invalid_configuration' });
    this.name = 'AudioInputConfigurationError';
  }
}

/** Core did not have capacity before the AudioInput write deadline. */
export class AudioInputTimeoutError extends AudioInputError {
  public readonly timeoutMs: number;

  public constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(
      'audio_input.timeout',
      `audio input remained full for ${timeoutMs} ms`,
      options,
    );
    this.name = 'AudioInputTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** A write targeted a replaceable output that is no longer active. */
export class OutputCancelledError extends AudioInputError {
  public constructor(
    message = 'output is no longer active',
    options?: { cause?: unknown },
  ) {
    super('audio_input.output_cancelled', message, options);
    this.name = 'OutputCancelledError';
  }
}

/** A replaceable output belongs to a different AudioInput. */
export class OutputOwnershipError extends AudioInputError {
  public constructor(message: string, options?: { cause?: unknown }) {
    super('audio_input.wrong_output_input', message, options);
    this.name = 'OutputOwnershipError';
  }
}

/** Core cannot assign another output identity to this AudioInput. */
export class OutputGenerationLimitError extends AudioInputError {
  public constructor(message: string, options?: { cause?: unknown }) {
    super('audio_input.output_generation_limit', message, options);
    this.name = 'OutputGenerationLimitError';
  }
}

/** An AbortSignal stopped a pending AudioInput write. */
export class AudioInputAbortError extends AudioInputError {
  public readonly reason: unknown;

  public constructor(reason?: unknown, options?: { cause?: unknown }) {
    super('audio_input.aborted', 'audio input write was aborted', options);
    this.name = 'AbortError';
    this.reason = reason;
  }
}

/** Base failure from bounded typed-event ingress. */
export class EventInputError extends PocketStationError {
  public constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.name = 'EventInputError';
  }
}

/** The bounded EventInput has no free capacity. */
export class EventInputFullError extends EventInputError {
  public constructor(message = 'event input is full') {
    super('event_input.full', message);
    this.name = 'EventInputFullError';
  }
}

/** The EventInput no longer accepts writes. */
export class EventInputClosedError extends EventInputError {
  public constructor(message = 'event input is closed') {
    super('event_input.closed', message);
    this.name = 'EventInputClosedError';
  }
}

export function fromNativeError(failure: unknown): PocketStationError {
  if (failure instanceof PocketStationError) {
    return failure;
  }
  const message = (failure instanceof Error ? failure.message : String(failure))
    .replace(/^Error:\s*/, '');
  const separator = message.indexOf(NATIVE_ERROR_SEPARATOR);
  if (separator < 1) {
    return new PocketStationError('session.internal', message, { cause: failure });
  }
  const code = message.slice(0, separator);
  const detail = message.slice(separator + NATIVE_ERROR_SEPARATOR.length);
  if (code === 'audio_input.full') {
    return new AudioInputFullError(detail, { cause: failure });
  }
  if (code === 'audio_input.closed') {
    return new AudioInputClosedError(detail, { cause: failure });
  }
  if (code === 'audio_input.cancelled') {
    return new AudioInputCancelledError(detail, { cause: failure });
  }
  if (code === 'audio_input.invalid_configuration') {
    return new AudioInputConfigurationError(detail, { cause: failure });
  }
  if (code === 'audio_input.invalid_buffer' || code === 'audio_input.declaration_failed') {
    return new AudioInputBufferError(detail, { cause: failure, code });
  }
  if (code === 'audio_input.output_cancelled') {
    return new OutputCancelledError(detail, { cause: failure });
  }
  if (code === 'audio_input.wrong_output_input') {
    return new OutputOwnershipError(detail, { cause: failure });
  }
  if (code === 'audio_input.output_generation_limit') {
    return new OutputGenerationLimitError(detail, { cause: failure });
  }
  if (code.startsWith('audio_input.')) {
    return new AudioInputError(code, detail, { cause: failure });
  }
  if (code.startsWith('capture.')) {
    return new CaptureError(code, detail, failure);
  }
  if (code.startsWith('graph.')) {
    return new GraphError(code, detail, failure);
  }
  if (code.startsWith('source.')) {
    return new SourceError(code, detail, failure);
  }
  if (code.startsWith('operator.')) {
    return new OperatorError(code, detail, failure);
  }
  if (code.startsWith('connector.')) {
    return new ConnectorRuntimeError(code, detail, failure);
  }
  if (code.startsWith('extension.')) {
    return new ExtensionError(code, detail, failure);
  }
  if (code === 'sidecar.queue_full' || code === 'sidecar.control_queue_full') {
    return new SidecarBackpressureError(code, detail, failure);
  }
  if (
    code === 'sidecar.protocol' ||
    code === 'sidecar.unexpected_eof' ||
    code === 'sidecar.frame_too_large' ||
    code === 'sidecar.unexpected_message' ||
    code === 'sidecar.invalid_message_kind' ||
    code === 'sidecar.invalid_read'
  ) {
    return new SidecarProtocolError(code, detail, failure);
  }
  if (code === 'sidecar.timeout' || code === 'sidecar.processing_timeout') {
    return new SidecarTimeoutError(code, detail, failure);
  }
  if (code.startsWith('sidecar.')) {
    return new SidecarError(code, detail, failure);
  }
  if (code.startsWith('stream.')) {
    return new StreamError(code, detail, failure);
  }
  if (
    code.startsWith('session.start_') ||
    SESSION_START_CODES.has(code)
  ) {
    return new SessionStartError(code, detail, undefined, failure);
  }
  if (code.startsWith('session.')) {
    if (SESSION_DECLARATION_CODES.has(code)) {
      return new SessionDeclarationError(code, detail, failure);
    }
    return new SessionRuntimeError(code, detail, failure);
  }
  return new PocketStationError(code, detail, { cause: failure });
}

export async function nativeCall<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (failure) {
    throw fromNativeError(failure);
  }
}

export function nativeCallSync<T>(operation: () => T): T {
  try {
    return operation();
  } catch (failure) {
    throw fromNativeError(failure);
  }
}

const SESSION_START_CODES = new Set([
  'session.host_setup_failed',
  'session.unsupported_platform',
  'session.declaration_invalid',
  'session.compile_failed',
  'session.runtime_prepare_failed',
  'session.invalid_start_options',
  'session.unsupported_source_topology',
  'session.missing_endpoint_declaration',
  'session.endpoint_prepare_failed',
  'session.endpoint_start_failed',
  'session.runtime_start_failed',
  'session.missing_audio_receipt',
  'session.missing_recording_configuration',
  'session.missing_event_receiver',
  'session.trace_recorder_setup_failed',
]);

const SESSION_DECLARATION_CODES = new Set([
  'session.no_sources',
  'session.no_routes',
  'session.no_source_outputs',
  'session.invalid_selector',
  'session.invalid_frame_duration',
  'session.invalid_endpoint',
  'session.invalid_operator',
  'session.invalid_route',
  'session.foreign_endpoint',
  'session.draft_frozen',
  'session.id_exhausted',
  'session.unsupported_version',
  'session.unknown_endpoint',
  'session.unknown_stem',
  'session.unknown_source',
  'session.unknown_operator_instance',
  'session.operator_has_no_destination',
]);

function optionalIndex(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}
