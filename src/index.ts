/**
 * @pocketstation/client — PocketStation TypeScript/JavaScript SDK.
 *
 * Phase 5 implementation. Connects to the PocketStation relay for
 * real-time audio transport.
 *
 * @example
 * ```ts
 * import { RoomClient } from '@pocketstation/client';
 *
 * const client = new RoomClient({
 *   apiUrl: 'https://api.pocketstation.io',
 *   relayUrl: 'wss://relay.pocketstation.io',
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
  PocketStationConfig,
  RoomCredentials,
  SessionStats,
  ConnectOptions,
} from './RoomClient.js';
export type {
  ClientMessage,
  ServerMessage,
  MessageType,
} from './types.js';
export { PocketStationError } from './types.js';

export const version = '0.1.0';
