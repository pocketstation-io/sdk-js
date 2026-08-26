/**
 * @pocketstation/client — PocketStation TypeScript/JavaScript SDK.
 *
 * Early browser Relay client. The public README describes its compatibility
 * limits.
 *
 * @example
 * ```ts
 * import { RoomClient } from '@pocketstation/client';
 *
 * const client = new RoomClient({
 *   apiUrl: 'https://control.example.com',
 *   relayUrl: 'wss://relay.example.com',
 * });
 *
 * // As source (publish microphone audio):
 * const [track] = (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks();
 * await client.connect({ role: 'source', track });
 *
 * // As listener (subscribe to room audio):
 * const stream = await client.connect({ role: 'listener' });
 * audioElement.srcObject = stream;
 * ```
 */
export { RoomClient } from './RoomClient.js';
export { SignalingTransport } from './SignalingTransport.js';
export type {
  ConnectOptions,
} from './RoomClient.js';
export type {
  PocketStationConfig,
  RoomCredentials,
  SessionStats,
} from './types.js';
export type {
  ClientMessage,
  ServerMessage,
  MessageType,
} from './types.js';
export { PocketStationError } from './types.js';

export const version = '0.1.0';
