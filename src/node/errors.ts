const NATIVE_ERROR_SEPARATOR = '|';

import { PocketStationError } from '../errors.js';

export { PocketStationError } from '../errors.js';

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

/** A built-in Source failed validation, acquisition, or explicit recovery. */
export class SourceError extends PocketStationError {
  public constructor(code: string, message: string, cause?: unknown) {
    super(code, message, { cause });
    this.name = 'SourceError';
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

export function fromNativeError(failure: unknown): PocketStationError {
  if (failure instanceof PocketStationError) {
    return failure;
  }
  const message = (failure instanceof Error ? failure.message : String(failure))
    .replace(/^Error:\s*/, '');
  const separator = message.indexOf(NATIVE_ERROR_SEPARATOR);
  if (separator < 1) {
    return new PocketStationError('native.failure', message, { cause: failure });
  }
  const code = message.slice(0, separator);
  const detail = message.slice(separator + NATIVE_ERROR_SEPARATOR.length);
  if (code.startsWith('extension.')) {
    return new ExtensionError(code, detail, failure);
  }
  if (code.startsWith('source.')) {
    return new SourceError(code, detail, failure);
  }
  if (code === 'sidecar.queue_full' || code === 'sidecar.control_queue_full') {
    return new SidecarBackpressureError(code, detail, failure);
  }
  if (
    code === 'sidecar.protocol' ||
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
