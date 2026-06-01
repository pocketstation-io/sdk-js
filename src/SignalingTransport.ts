/**
 * SignalingTransport — WebSocket wrapper for the PocketStation relay signaling
 * protocol.
 *
 * Invariant: one transport per session. Not reusable after close().
 * Ownership: caller owns all callbacks; transport does not hold external state.
 * Failure behavior: network errors reject the open() promise or call onError.
 *
 * Phase scope: Phase 5.
 */
import { ClientMessage, ServerMessage, PocketStationError } from './types.js';

export type MessageHandler = (msg: ServerMessage) => void;
export type ErrorHandler = (err: Error) => void;

export class SignalingTransport {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private onMessage: MessageHandler | null = null;
  private onError: ErrorHandler | null = null;

  constructor(relayUrl: string) {
    const wsUrl = relayUrl.replace(/^http/, 'ws');
    this.url = `${wsUrl.replace(/\/$/, '')}/v1/signal`;
  }

  /** Open the WebSocket connection. Resolves when the connection is open. */
  open(onMessage: MessageHandler, onError: ErrorHandler): Promise<void> {
    this.onMessage = onMessage;
    this.onError = onError;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => resolve();

      this.ws.onerror = () => {
        const err = new PocketStationError('WebSocket connection failed', 'ws_error');
        reject(err);
        onError(err);
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          this.onMessage?.(msg);
        } catch {
          this.onError?.(new PocketStationError('Failed to parse server message', 'parse_error'));
        }
      };

      this.ws.onclose = () => {
        // Normal closure — callers that need to know should check session state.
      };
    });
  }

  /** Send a client message to the relay. */
  send(msg: ClientMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new PocketStationError('WebSocket is not open', 'ws_not_open');
    }
    this.ws.send(JSON.stringify(msg));
  }

  /** Close the WebSocket connection gracefully. */
  close(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'client_close');
    }
    this.ws = null;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
