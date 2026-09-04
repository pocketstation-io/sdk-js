import { PocketStationError } from '../errors.js';
import type { RelayClientMessage, RelayServerMessage } from './types.js';

export type MessageHandler = (message: RelayServerMessage) => void;
export type ErrorHandler = (error: Error) => void;

/** Owns one WebSocket connection to the Relay signaling service. */
export class SignalingTransport {
  readonly #url: string;
  #socket: WebSocket | null = null;
  #onMessage: MessageHandler | null = null;
  #onError: ErrorHandler | null = null;

  public constructor(relayUrl: string) {
    const websocketUrl = relayUrl.replace(/^http/, 'ws');
    this.#url = `${websocketUrl.replace(/\/$/, '')}/v1/signal`;
  }

  /** Open the WebSocket and install message and error handlers. */
  public open(onMessage: MessageHandler, onError: ErrorHandler): Promise<void> {
    this.#onMessage = onMessage;
    this.#onError = onError;

    return new Promise<void>((resolve, reject) => {
      this.#socket = new WebSocket(this.#url);
      this.#socket.onopen = () => resolve();
      this.#socket.onerror = () => {
        const failure = new PocketStationError(
          'relay.websocket_failed',
          'Relay WebSocket connection failed',
        );
        reject(failure);
        onError(failure);
      };
      this.#socket.onmessage = (event: MessageEvent) => {
        try {
          this.#onMessage?.(JSON.parse(event.data as string) as RelayServerMessage);
        } catch (cause) {
          this.#onError?.(
            new PocketStationError(
              'relay.invalid_message',
              'Relay returned an invalid signaling message',
              { cause },
            ),
          );
        }
      };
    });
  }

  /** Send one signaling message. */
  public send(message: RelayClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      throw new PocketStationError(
        'relay.websocket_not_open',
        'Relay WebSocket is not open',
      );
    }
    this.#socket.send(JSON.stringify(message));
  }

  /** Close the WebSocket if it is open. */
  public close(): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.close(1000, 'client_close');
    }
    this.#socket = null;
  }

  /** Whether the WebSocket is ready to send messages. */
  public get isOpen(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }
}
