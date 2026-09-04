/** URLs used to create a Relay session and exchange WebRTC signaling. */
export interface RelayConfig {
  /** Base URL of the PocketStation control service. */
  controlUrl: string;
  /** Base URL of the PocketStation Relay service. */
  relayUrl: string;
}

/** Credentials returned when a Relay session is created. */
export interface RelayCredentials {
  /** Relay session identity. */
  sessionId: string;
  /** Short-lived credential used by a publisher. */
  publisherToken: string;
  /** Short-lived credential used by a receiver. */
  receiverToken: string;
  /** STUN and TURN servers supplied by the control service. */
  iceServers?: RTCIceServer[];
}

/** A point-in-time WebRTC statistics summary. */
export interface RelayStats {
  /** RTP packets received by this browser. */
  packetsReceived: number;
  /** RTP packets reported lost. */
  packetsLost: number;
  /** RTP payload and header bytes received. */
  bytesReceived: number;
  /** Largest inbound RTP jitter value, in milliseconds. */
  jitterMs: number;
  /** Remote inbound round-trip estimate in milliseconds, when reported. */
  roundTripTimeMs: number | null;
}

/** Client-to-Relay signaling messages. */
export interface RelayClientMessage {
  /** Signaling operation. */
  type: RelayMessageType;
  /** Short-lived publisher or receiver credential. */
  token?: string;
  /** WebRTC offer SDP. */
  sdp_offer?: string;
  /** ICE candidate string. */
  candidate?: string;
  /** Optional SFrame key used by the current protocol. */
  sframe_key?: string;
}

/** Relay-to-client signaling messages. */
export interface RelayServerMessage {
  /** Signaling operation. */
  type: RelayMessageType;
  /** WebRTC answer SDP. */
  sdp_answer?: string;
  /** ICE candidate string. */
  candidate?: string;
  /** Whether the Relay currently has an active source. */
  source_active?: boolean;
  /** Number of connected receivers. */
  listener_count?: number;
  /** Negotiated audio codec name. */
  codec?: string;
  /** Stable Relay error code. */
  code?: string;
  /** Human-readable Relay error message. */
  message?: string;
  /** Optional SFrame key used by the current protocol. */
  sframe_key?: string;
  /** Optional codec settings suggested by the Relay. */
  codec_hint?: {
    /** Target bitrate in kilobits per second. */
    bitrate_kbps: number;
    /** Codec complexity setting. */
    complexity: number;
    /** Whether forward error correction is enabled. */
    fec: boolean;
    /** Whether discontinuous transmission is enabled. */
    dtx: boolean;
  };
}

/** Message names used by the current Relay signaling protocol. */
export type RelayMessageType =
  | 'PUBLISH'
  | 'SUBSCRIBE'
  | 'ICE'
  | 'LEAVE'
  | 'SDP_ANSWER'
  | 'ROOM_STATE'
  | 'ERROR'
  | 'KEY_EXCHANGE'
  | 'CODEC_HINT';
