/** Configuration for connecting to a PocketStation relay. */
export interface PocketStationConfig {
  /** Base URL of the api-server (e.g. https://api.pocketstation.io). */
  apiUrl: string;
  /** Base URL of the relay WebSocket server (e.g. wss://relay.pocketstation.io). */
  relayUrl: string;
}

/** Credentials returned by POST /v1/rooms. */
export interface RoomCredentials {
  roomId: string;
  sourceToken: string;
  listenerToken: string;
  /** ICE server list when embedded TURN is configured (ADR-023). */
  iceServers?: RTCIceServer[];
}

/** Statistics snapshot from a live session. */
export interface SessionStats {
  packetsReceived: number;
  packetsLost: number;
  bytesReceived: number;
  jitterMs: number;
  roundTripTimeMs: number | null;
}

/** Signaling message types (matches relay/internal/signaling). */
export type MessageType =
  | 'PUBLISH'
  | 'SUBSCRIBE'
  | 'ICE'
  | 'LEAVE'
  | 'SDP_ANSWER'
  | 'ROOM_STATE'
  | 'ERROR'
  | 'KEY_EXCHANGE'
  | 'CODEC_HINT';

export interface ClientMessage {
  type: MessageType;
  token?: string;
  sdp_offer?: string;
  candidate?: string;
  sframe_key?: string;
}

export interface ServerMessage {
  type: MessageType;
  sdp_answer?: string;
  candidate?: string;
  source_active?: boolean;
  listener_count?: number;
  codec?: string;
  code?: string;
  message?: string;
  sframe_key?: string;
  codec_hint?: {
    bitrate_kbps: number;
    complexity: number;
    fec: boolean;
    dtx: boolean;
  };
}

export class PocketStationError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PocketStationError';
    this.code = code;
  }
}
