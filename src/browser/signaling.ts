import { PocketStationError } from '../errors.js';
import type { RelayClientMessage, RelayServerMessage } from './types.js';

const MAX_MESSAGE_BYTES = 64 * 1024;

interface OpenOptions {
  readonly signal: AbortSignal;
  readonly onMessage: (message: RelayServerMessage) => void;
  readonly onClose: () => void;
  readonly onError: (error: PocketStationError) => void;
}

/** @internal Owns one finite WebSocket signaling connection. */
export class SignalingTransport {
  readonly #url: string;
  #socket: WebSocket | null = null;
  #opened = false;

  public constructor(signalUrl: string) {
    const url = parseSignalUrl(signalUrl);
    this.#url = url.href;
  }

  public open(options: OpenOptions): Promise<void> {
    if (this.#socket !== null) {
      throw new PocketStationError(
        'relay.signaling_already_open',
        'Relay signaling has already started',
      );
    }
    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    socket.onmessage = (event) => {
      try {
        options.onMessage(parseServerMessage(event.data));
      } catch (cause) {
        options.onError(
          cause instanceof PocketStationError
            ? cause
            : new PocketStationError(
                'relay.invalid_message',
                'Relay returned an invalid signaling message',
                { cause },
              ),
        );
      }
    };
    socket.onclose = () => {
      this.#opened = false;
      if (this.#socket === socket) this.#socket = null;
      options.onClose();
    };
    socket.onerror = () => {
      options.onError(
        new PocketStationError(
          'relay.websocket_failed',
          'Relay signaling connection failed',
        ),
      );
    };

    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        finish();
        try {
          socket.close(1000, 'connect_cancelled');
        } catch {
          // The browser is already discarding the failed connection.
        }
        reject(abortFailure(options.signal.reason));
      };
      const onOpen = (): void => {
        this.#opened = true;
        finish();
        resolve();
      };
      const onError = (): void => {
        finish();
        reject(
          new PocketStationError(
            'relay.websocket_failed',
            'Relay signaling connection failed before it opened',
          ),
        );
      };
      const onClose = (): void => {
        if (this.#opened) return;
        finish();
        reject(
          new PocketStationError(
            'relay.websocket_closed',
            'Relay signaling closed before it opened',
          ),
        );
      };
      const finish = (): void => {
        options.signal.removeEventListener('abort', onAbort);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
      socket.addEventListener('close', onClose, { once: true });
      if (options.signal.aborted) onAbort();
    });
  }

  public send(message: RelayClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      throw new PocketStationError(
        'relay.websocket_not_open',
        'Relay signaling is not ready to send messages',
      );
    }
    this.#socket.send(JSON.stringify(message));
  }

  public async close(timeoutMs: number): Promise<void> {
    const socket = this.#socket;
    if (socket === null || socket.readyState === WebSocket.CLOSED) {
      this.#socket = null;
      this.#opened = false;
      return;
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    await new Promise<void>((resolve, reject) => {
      const onClose = (): void => {
        finish();
        resolve();
      };
      const onTimeout = (): void => {
        finish();
        reject(
          new PocketStationError(
            'relay.websocket_close_timeout',
            `Relay signaling did not close within ${timeoutMs} ms`,
          ),
        );
      };
      const finish = (): void => {
        socket.removeEventListener('close', onClose);
        timeout.removeEventListener('abort', onTimeout);
      };
      socket.addEventListener('close', onClose, { once: true });
      timeout.addEventListener('abort', onTimeout, { once: true });
      try {
        socket.close(1000, 'client_close');
      } catch (cause) {
        finish();
        reject(
          new PocketStationError(
            'relay.websocket_close_failed',
            'Relay signaling could not be closed',
            { cause },
          ),
        );
      }
    });
    if (this.#socket === socket) this.#socket = null;
    this.#opened = false;
  }

  public get isOpen(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }
}

function parseSignalUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new PocketStationError(
      'relay.invalid_signal_url',
      'Relay signalUrl must be an absolute WebSocket URL',
      { cause },
    );
  }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
    throw new PocketStationError(
      'relay.invalid_signal_url',
      'Relay signalUrl must use ws or wss and cannot contain credentials',
    );
  }
  return url;
}

function parseServerMessage(data: unknown): RelayServerMessage {
  if (typeof data !== 'string' || new TextEncoder().encode(data).byteLength > MAX_MESSAGE_BYTES) {
    throw new PocketStationError(
      'relay.invalid_message',
      `Relay signaling messages must be text no larger than ${MAX_MESSAGE_BYTES} bytes`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch (cause) {
    throw new PocketStationError(
      'relay.invalid_message',
      'Relay returned malformed JSON',
      { cause },
    );
  }
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw invalidMessage('Relay message is missing its type');
  }
  switch (value.type) {
    case 'SDP_ANSWER':
      return { type: value.type, sdp_answer: requiredText(value, 'sdp_answer') };
    case 'ICE':
      return { type: value.type, candidate: requiredText(value, 'candidate') };
    case 'SESSION_STATE':
      return {
        type: value.type,
        session_id: optionalText(value, 'session_id'),
        bus_id: optionalText(value, 'bus_id'),
        source_active: optionalBoolean(value, 'source_active') ?? false,
        subscription_count: optionalCount(value, 'subscription_count') ?? 0,
        codec: optionalText(value, 'codec'),
      };
    case 'ERROR':
      return {
        type: value.type,
        code: optionalText(value, 'code'),
        message: optionalText(value, 'message'),
      };
    case 'KEY_EXCHANGE':
      return { type: value.type, sframe_key: requiredText(value, 'sframe_key') };
    case 'CODEC_HINT':
    case 'LATENCY_REPORT':
      return { type: value.type };
    case 'ICE_RESTART':
      return {
        type: value.type,
        use_turn: optionalBoolean(value, 'use_turn'),
      };
    default:
      throw invalidMessage(`Relay returned unsupported message type ${value.type}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: Record<string, unknown>, name: string): string {
  const field = value[name];
  if (typeof field !== 'string' || field.length === 0) {
    throw invalidMessage(`Relay message is missing ${name}`);
  }
  return field;
}

function optionalText(
  value: Record<string, unknown>,
  name: string,
): string | undefined {
  const field = value[name];
  if (field === undefined) return undefined;
  if (typeof field !== 'string') throw invalidMessage(`Relay message has invalid ${name}`);
  return field;
}

function optionalBoolean(
  value: Record<string, unknown>,
  name: string,
): boolean | undefined {
  const field = value[name];
  if (field === undefined) return undefined;
  if (typeof field !== 'boolean') throw invalidMessage(`Relay message has invalid ${name}`);
  return field;
}

function optionalCount(
  value: Record<string, unknown>,
  name: string,
): number | undefined {
  const field = value[name];
  if (field === undefined) return undefined;
  if (!Number.isSafeInteger(field) || (field as number) < 0) {
    throw invalidMessage(`Relay message has invalid ${name}`);
  }
  return field as number;
}

function invalidMessage(message: string): PocketStationError {
  return new PocketStationError('relay.invalid_message', message);
}

function abortFailure(reason: unknown): PocketStationError {
  return new PocketStationError(
    'relay.connect_cancelled',
    reason instanceof Error ? reason.message : 'Relay connection was cancelled',
    { cause: reason },
  );
}
