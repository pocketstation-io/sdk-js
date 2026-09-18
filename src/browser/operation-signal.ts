interface OperationSignal {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
}

/** @internal Owns one strongly referenced deadline and propagates caller cancellation. */
export function operationSignal(
  timeoutMs: number,
  ...sources: Array<AbortSignal | undefined>
): OperationSignal {
  const controller = new AbortController();
  const present = sources.filter(
    (source): source is AbortSignal => source !== undefined,
  );
  let disposed = false;
  const timeout = globalThis.setTimeout(() => {
    controller.abort(
      new DOMException(
        `Browser operation exceeded its ${timeoutMs} ms deadline`,
        'TimeoutError',
      ),
    );
  }, timeoutMs);
  const onAbort = (event: Event): void => {
    const source = event.currentTarget as AbortSignal;
    controller.abort(source.reason);
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    globalThis.clearTimeout(timeout);
    for (const source of present) source.removeEventListener('abort', onAbort);
  };

  controller.signal.addEventListener('abort', dispose, { once: true });
  for (const source of present) {
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    source.addEventListener('abort', onAbort, { once: true });
  }
  return Object.freeze({ signal: controller.signal, dispose });
}
