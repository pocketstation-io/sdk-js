const NATIVE_ERROR_SEPARATOR = '|';

import { PocketStationError } from '../errors.js';

export { PocketStationError } from '../errors.js';

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
  return new PocketStationError(
    message.slice(0, separator),
    message.slice(separator + NATIVE_ERROR_SEPARATOR.length),
    { cause: failure },
  );
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
