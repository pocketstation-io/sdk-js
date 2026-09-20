/** Direct receiver access issued for one RelaySession AudioBus. */
export interface RelayReceiverAccess {
  /** Relay WebSocket endpoint, normally ending in `/v1/signal`. */
  readonly signalUrl: string;
  /** RelaySession identity. */
  readonly sessionId: string;
  /** AudioBus selected for this receiver. */
  readonly busId: string;
  /** Subscriber credential scoped to the selected AudioBus. */
  readonly subscriberToken: string;
  /** STUN or TURN servers issued for this RelaySession. */
  readonly iceServers?: readonly RTCIceServer[];
}

/** Direct publisher access issued for one RelaySession AudioBus. */
export interface RelayPublisherAccess {
  /** Relay WebSocket endpoint, normally ending in `/v1/signal`. */
  readonly signalUrl: string;
  /** RelaySession identity. */
  readonly sessionId: string;
  /** AudioBus selected for this publisher. */
  readonly busId: string;
  /** Media-only publisher credential scoped to the selected AudioBus. */
  readonly publisherToken: string;
  /** STUN or TURN servers issued for this RelaySession. */
  readonly iceServers?: readonly RTCIceServer[];
}

/** A one-time invitation issued by the PocketStation control plane. */
export interface RelayInvitation {
  /** PocketStation control-plane HTTP or HTTPS origin. */
  readonly controlUrl: string;
  /** Opaque one-time join code. */
  readonly joinCode: string;
}

/** Receiver startup and shutdown settings. */
export interface RelayReceiverOptions {
  /** Complete invitation, signaling, SDP, ICE, and track deadline. Defaults to 20 seconds. */
  readonly connectTimeoutMs?: number;
  /** WebSocket close deadline. Defaults to two seconds. */
  readonly disconnectTimeoutMs?: number;
  /** Called after each lifecycle transition. */
  readonly onStateChange?: (state: RelayReceiverState) => void;
  /** Called when Relay reports a transport-facing Session snapshot. */
  readonly onSessionState?: (state: RelaySessionState) => void;
  /** Called for asynchronous signaling or WebRTC failures. */
  readonly onError?: (error: Error) => void;
}

/** Publisher startup, observation, and shutdown settings. */
export interface RelayPublisherOptions {
  /** Complete signaling, SDP, ICE, and first-packet deadline. Defaults to 20 seconds. */
  readonly connectTimeoutMs?: number;
  /** WebSocket close deadline. Defaults to two seconds. */
  readonly disconnectTimeoutMs?: number;
  /** Called after each lifecycle transition. */
  readonly onStateChange?: (state: RelayPublisherState) => void;
  /** Called when Relay reports a transport-facing Session snapshot. */
  readonly onSessionState?: (state: RelaySessionState) => void;
  /** Called for asynchronous signaling, WebRTC, or source-track failures. */
  readonly onError?: (error: Error) => void;
  /** Called when Relay requests new browser encoder settings. */
  readonly onCodecHint?: (hint: RelayCodecHint) => void;
}

/** Observable lifecycle of one browser receiver. */
export type RelayReceiverState =
  | 'idle'
  | 'resolving-invitation'
  | 'signaling'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

/** Observable lifecycle of one browser publisher. */
export type RelayPublisherState =
  | 'idle'
  | 'signaling'
  | 'connecting'
  | 'publishing'
  | 'recovering'
  | 'disconnected'
  | 'failed'
  | 'closed';

/** Advisory browser encoder settings requested by Relay. */
export interface RelayCodecHint {
  readonly bitrateKbps: number;
  readonly complexity: number;
  readonly fec: boolean;
  readonly dtx: boolean;
  readonly frameMs: 10 | 20;
}

/** One unit-bearing client latency observation reported to Relay. */
export interface RelayLatencyReport {
  readonly captureMs: number;
  readonly encodeMs: number;
  readonly relayRttMs: number;
  readonly jitterBufferMs: number;
  readonly decodeMs: number;
  readonly packetLossPct: number;
  readonly clockDriftPpm: number;
}

/** Client-to-Relay signaling messages used by the browser receiver. */
export type RelayClientMessage =
  | {
      readonly type: 'PUBLISH';
      readonly session_id: string;
      readonly bus_id: string;
      readonly token: string;
      readonly sdp_offer: string;
    }
  | {
      readonly type: 'SUBSCRIBE';
      readonly session_id: string;
      readonly bus_id: string;
      readonly token: string;
      readonly sdp_offer: string;
    }
  | { readonly type: 'ICE'; readonly candidate: string }
  | {
      readonly type: 'LATENCY_REPORT';
      readonly session_id: string;
      readonly latency_report: {
        readonly session_id: string;
        readonly capture_ms: number;
        readonly encode_ms: number;
        readonly relay_rtt_ms: number;
        readonly jitter_buffer_ms: number;
        readonly decode_ms: number;
        readonly packet_loss_pct: number;
        readonly clock_drift_ppm: number;
      };
    };

/** Relay-to-client messages understood by the browser receiver. */
export type RelayServerMessage =
  | { readonly type: 'SDP_ANSWER'; readonly sdp_answer: string }
  | { readonly type: 'ICE'; readonly candidate: string }
  | {
      readonly type: 'SESSION_STATE';
      readonly session_id?: string;
      readonly bus_id?: string;
      readonly source_active: boolean;
      readonly subscription_count: number;
      readonly codec?: string;
    }
  | { readonly type: 'ERROR'; readonly code?: string; readonly message?: string }
  | { readonly type: 'KEY_EXCHANGE'; readonly sframe_key: string }
  | { readonly type: 'CODEC_HINT'; readonly codec_hint: RelayCodecHint }
  | { readonly type: 'ICE_RESTART'; readonly use_turn?: boolean };

/** Latest transport-facing state reported by Relay. */
export interface RelaySessionState {
  readonly sessionId: string;
  readonly busId: string;
  readonly sourceActive: boolean;
  readonly subscriptionCount: number;
  readonly codec: string | null;
}

/** Point-in-time WebRTC receiver and playout observations. */
export interface RelayPlayoutObservation {
  /** Monotonic observation revision within this RelayReceiver. */
  readonly revision: number;
  /** RelaySession identity. */
  readonly sessionId: string;
  /** Selected AudioBus. */
  readonly busId: string;
  /** Wall-clock observation time in milliseconds since Unix epoch. */
  readonly observedAtMs: number;
  /** Browser statistics timestamp in milliseconds, when reported. */
  readonly statsTimestampMs: number | null;
  readonly packetsReceived: number | null;
  readonly packetsLost: number | null;
  readonly bytesReceived: number | null;
  readonly jitterMs: number | null;
  readonly jitterBufferDelayMs: number | null;
  readonly jitterBufferEmittedCount: number | null;
  readonly totalSamplesReceived: number | null;
  readonly totalSamplesDurationSeconds: number | null;
  readonly estimatedPlayoutTimestampMs: number | null;
  /** Browser track state. This does not prove that a loudspeaker emitted sound. */
  readonly trackState: MediaStreamTrackState | null;
  /** Acoustic output cannot be observed through WebRTC statistics. */
  readonly acousticOutput: 'unavailable';
}

/** Point-in-time WebRTC publisher observations for one caller-owned audio stream. */
export interface RelayPublishObservation {
  /** Monotonic observation revision within this RelayPublisher. */
  readonly revision: number;
  /** RelaySession identity. */
  readonly sessionId: string;
  /** Selected AudioBus. */
  readonly busId: string;
  /** Wall-clock observation time in milliseconds since Unix epoch. */
  readonly observedAtMs: number;
  /** Browser statistics timestamp in milliseconds, when reported. */
  readonly statsTimestampMs: number | null;
  readonly packetsSent: number | null;
  readonly bytesSent: number | null;
  readonly headerBytesSent: number | null;
  readonly totalSamplesSent: number | null;
  readonly totalSamplesDurationSeconds: number | null;
  readonly audioLevel: number | null;
  readonly totalAudioEnergy: number | null;
  readonly connectionState: RTCPeerConnectionState;
  readonly trackState: MediaStreamTrackState;
  readonly trackMuted: boolean;
}
