import { jest } from '@jest/globals';

import { PocketStationError } from '../errors.js';
import { SecretToken } from '../control/types.js';
import { RelayPublisher } from '../browser/relay-publisher.js';

const access = {
  signalUrl: 'ws://127.0.0.1:4800/v1/signal',
  sessionId: 'session-001',
  busId: 'user-microphone',
  publisherToken: new SecretToken('publisher-token'),
  iceServers: [{
    urls: ['stun:relay.example:3478'],
    username: null,
    credential: null,
  }],
} as const;

class FakeTrack extends EventTarget {
  public readonly kind = 'audio';
  public readonly id = 'track-001';
  public readonly label = 'test microphone';
  public readonly enabled = true;
  public readonly muted = false;
  public readonly readyState = 'live';
  public readonly stop = jest.fn();
}

class FakeStream {
  readonly #tracks: FakeTrack[];

  public constructor(tracks: FakeTrack[]) {
    this.#tracks = tracks;
  }

  public getAudioTracks(): FakeTrack[] {
    return [...this.#tracks];
  }
}

class FakePeerConnection {
  public static instances: FakePeerConnection[] = [];
  public static emitCandidateDuringLocalDescription = false;
  public readonly configuration: RTCConfiguration;
  public connectionState: RTCPeerConnectionState = 'new';
  public remoteDescription: RTCSessionDescription | null = null;
  public onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  public onconnectionstatechange: (() => void) | null = null;
  public readonly sender = {
    track: null as FakeTrack | null,
    getParameters: jest.fn(() => ({ encodings: [{}] })),
    setParameters: jest.fn(async () => undefined),
  };
  public readonly addTransceiver = jest.fn((track: FakeTrack) => {
    this.sender.track = track;
    return { sender: this.sender };
  });
  public readonly close = jest.fn(() => {
    this.connectionState = 'closed';
    this.onconnectionstatechange?.();
  });
  public packetsSent = 1;
  public includeAudioStats = true;

  public constructor(configuration: RTCConfiguration) {
    this.configuration = configuration;
    FakePeerConnection.instances.push(this);
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'v=0\r\n' };
  }

  public async setLocalDescription(): Promise<void> {
    if (FakePeerConnection.emitCandidateDuringLocalDescription) {
      this.onicecandidate?.({
        candidate: { candidate: 'candidate:early-publisher' },
      } as unknown as RTCPeerConnectionIceEvent);
    }
  }

  public async setRemoteDescription(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    this.remoteDescription = description as RTCSessionDescription;
    this.connectionState = 'connected';
    queueMicrotask(() => this.onconnectionstatechange?.());
  }

  public async addIceCandidate(): Promise<void> {}

  public getSenders(): RTCRtpSender[] {
    return [this.sender as unknown as RTCRtpSender];
  }

  public async getStats(): Promise<RTCStatsReport> {
    const thisConnection = this;
    const audio = {
      type: 'outbound-rtp',
      kind: 'audio',
      timestamp: 1234,
      packetsSent: this.packetsSent,
      bytesSent: 960,
      headerBytesSent: 48,
      totalSamplesSent: 960,
      totalSamplesDuration: 0.02,
      audioLevel: 0.25,
      totalAudioEnergy: 0.5,
    };
    return {
      forEach(callback: (value: RTCStats) => void): void {
        callback({
          type: 'outbound-rtp',
          kind: 'video',
          packetsSent: 999,
        } as unknown as RTCStats);
        callback({
          type: 'outbound-rtp',
          packetsSent: 999,
        } as unknown as RTCStats);
        if (thisConnection.includeAudioStats) {
          callback(audio as unknown as RTCStats);
        }
      },
    } as RTCStatsReport;
  }
}

type SocketListener = (event: Event) => void;

class FakeWebSocket {
  public static readonly OPEN = 1;
  public static readonly CLOSED = 3;
  public static instances: FakeWebSocket[] = [];
  public static rejectPublish = false;
  public readyState = 0;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public readonly sent: unknown[] = [];
  readonly #listeners = new Map<string, Set<SocketListener>>();

  public constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.#emit('open');
    });
  }

  public addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<SocketListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: SocketListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  public send(value: string): void {
    const message = JSON.parse(value) as Record<string, unknown>;
    this.sent.push(message);
    if (message.type !== 'PUBLISH') return;
    const response = FakeWebSocket.rejectPublish
      ? { type: 'ERROR', code: 'bad_token', message: 'invalid capability' }
      : { type: 'SDP_ANSWER', sdp_answer: 'v=0\r\n' };
    queueMicrotask(() => {
      this.onmessage?.(
        { data: JSON.stringify(response) } as MessageEvent<string>,
      );
    });
  }

  public close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
    this.#emit('close');
  }

  public receive(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent<string>);
  }

  #emit(type: string): void {
    const event = new Event(type);
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

function streamWith(track: FakeTrack): MediaStream {
  return new FakeStream([track]) as unknown as MediaStream;
}

beforeEach(() => {
  FakePeerConnection.instances = [];
  FakePeerConnection.emitCandidateDuringLocalDescription = false;
  FakeWebSocket.instances = [];
  FakeWebSocket.rejectPublish = false;
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    value: FakePeerConnection,
  });
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
  Reflect.deleteProperty(globalThis, 'WebSocket');
});

describe('RelayPublisher', () => {
  it('publishes one exact bus only after media packets exist and preserves track ownership', async () => {
    const states: string[] = [];
    const track = new FakeTrack();
    const stream = streamWith(track);
    const publisher = new RelayPublisher(access, {
      onStateChange: (state) => states.push(state),
    });

    await publisher.publish(stream);

    expect(publisher.state).toBe('publishing');
    expect(publisher.stream).toBe(stream);
    expect(states).toEqual(['signaling', 'connecting', 'publishing']);
    expect(FakePeerConnection.instances[0]?.addTransceiver).toHaveBeenCalledWith(
      track,
      { direction: 'sendonly', streams: [stream] },
    );
    expect(FakeWebSocket.instances[0]?.sent).toContainEqual({
      type: 'PUBLISH',
      session_id: access.sessionId,
      bus_id: access.busId,
      token: access.publisherToken.exposeSecret(),
      sdp_offer: 'v=0\r\n',
    });
    await expect(publisher.observe()).resolves.toMatchObject({
      sessionId: access.sessionId,
      busId: access.busId,
      packetsSent: 1,
      bytesSent: 960,
      trackState: 'live',
      trackMuted: false,
    });

    await publisher.disconnect();
    await publisher.disconnect();

    expect(publisher.state).toBe('closed');
    expect(publisher.access).toBeNull();
    expect(publisher.stream).toBeNull();
    expect(track.stop).not.toHaveBeenCalled();
    expect(FakePeerConnection.instances[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('sends early browser ICE only after the authorized publication exists', async () => {
    FakePeerConnection.emitCandidateDuringLocalDescription = true;
    const publisher = new RelayPublisher(access);

    await publisher.publish(streamWith(new FakeTrack()));

    expect(FakeWebSocket.instances[0]?.sent.slice(0, 2)).toEqual([
      {
        type: 'PUBLISH',
        session_id: access.sessionId,
        bus_id: access.busId,
        token: access.publisherToken.exposeSecret(),
        sdp_offer: 'v=0\r\n',
      },
      { type: 'ICE', candidate: 'candidate:early-publisher' },
    ]);
    await publisher.disconnect();
  });

  it('does not report publishing while outbound packet delivery remains absent', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const track = new FakeTrack();
      const publisher = new RelayPublisher(access, { connectTimeoutMs: 30 });
      const publication = publisher.publish(streamWith(track));
      await Promise.resolve();
      const connection = FakePeerConnection.instances[attempt];
      if (connection === undefined) throw new Error('missing fake PeerConnection');
      connection.packetsSent = 0;

      await expect(publication).rejects.toMatchObject({
        code: 'relay.publisher_connect_timeout',
      });
      expect(publisher.state).toBe('failed');
      expect(track.stop).not.toHaveBeenCalled();
    }
  });

  it('fails closed when Relay rejects the source capability', async () => {
    FakeWebSocket.rejectPublish = true;
    const publisher = new RelayPublisher(access);

    await expect(publisher.publish(streamWith(new FakeTrack()))).rejects.toMatchObject({
      code: 'relay.bad_token',
    });

    expect(publisher.state).toBe('failed');
    expect(FakePeerConnection.instances[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('reattaches without stopping the caller track after an explicit reconnect', async () => {
    const track = new FakeTrack();
    const stream = streamWith(track);
    const publisher = new RelayPublisher(access);
    await publisher.publish(stream);
    const first = FakePeerConnection.instances[0];
    if (first === undefined) throw new Error('missing first fake PeerConnection');
    first.connectionState = 'disconnected';
    first.onconnectionstatechange?.();
    expect(publisher.state).toBe('disconnected');

    await publisher.reconnect();

    expect(publisher.state).toBe('publishing');
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(track.stop).not.toHaveBeenCalled();
    await publisher.disconnect();
  });

  it('performs one bounded reattachment when Relay requests ICE recovery', async () => {
    const track = new FakeTrack();
    const publisher = new RelayPublisher(access);
    await publisher.publish(streamWith(track));
    const firstSocket = FakeWebSocket.instances[0];
    if (firstSocket === undefined) throw new Error('missing first fake WebSocket');

    firstSocket.receive({ type: 'ICE_RESTART', use_turn: true });
    for (
      let attempt = 0;
      attempt < 20 && FakePeerConnection.instances.length < 2;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(publisher.state).toBe('publishing');
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(track.stop).not.toHaveBeenCalled();
    await publisher.disconnect();
  });

  it('applies codec guidance and reports bounded unit-bearing latency', async () => {
    const hints: unknown[] = [];
    const publisher = new RelayPublisher(access, {
      onCodecHint: (hint) => hints.push(hint),
    });
    await publisher.publish(streamWith(new FakeTrack()));
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('missing fake WebSocket');

    socket.onmessage?.({
      data: JSON.stringify({
        type: 'CODEC_HINT',
        codec_hint: {
          bitrate_kbps: 32,
          complexity: 5,
          fec: true,
          dtx: false,
          frame_ms: 20,
        },
      }),
    } as MessageEvent<string>);
    await Promise.resolve();

    expect(publisher.lastCodecHint).toEqual({
      bitrateKbps: 32,
      complexity: 5,
      fec: true,
      dtx: false,
      frameMs: 20,
    });
    expect(hints).toEqual([publisher.lastCodecHint]);
    expect(FakePeerConnection.instances[0]?.sender.setParameters).toHaveBeenCalledWith({
      encodings: [{ maxBitrate: 32_000 }],
    });

    publisher.reportLatency({
      captureMs: 4,
      encodeMs: 3,
      relayRttMs: 22,
      jitterBufferMs: 7,
      decodeMs: 2,
      packetLossPct: 0.5,
      clockDriftPpm: -3,
    });
    expect(socket.sent).toContainEqual({
      type: 'LATENCY_REPORT',
      session_id: access.sessionId,
      latency_report: {
        session_id: access.sessionId,
        capture_ms: 4,
        encode_ms: 3,
        relay_rtt_ms: 22,
        jitter_buffer_ms: 7,
        decode_ms: 2,
        packet_loss_pct: 0.5,
        clock_drift_ppm: -3,
      },
    });
    expect(() =>
      publisher.reportLatency({
        captureMs: -1,
        encodeMs: 0,
        relayRttMs: 0,
        jitterBufferMs: 0,
        decodeMs: 0,
        packetLossPct: 0,
        clockDriftPpm: 0,
      }),
    ).toThrow(RangeError);
    await publisher.disconnect();
  });

  it('rejects invalid bus identity and streams without exactly one live audio track', async () => {
    expect(
      () => new RelayPublisher({ ...access, busId: 'not portable!' }),
    ).toThrow(TypeError);
    const publisher = new RelayPublisher(access);
    const empty = new FakeStream([]) as unknown as MediaStream;

    await expect(publisher.publish(empty)).rejects.toMatchObject({
      code: 'relay.publisher_audio_track_count',
    });
  });

  it('snapshots authority, ICE, deadlines, and callbacks at construction', async () => {
    const originalStates: string[] = [];
    const replacementStates: string[] = [];
    const urls = ['stun:original.example:3478'];
    const mutableAccess = {
      signalUrl: access.signalUrl,
      sessionId: access.sessionId,
      busId: access.busId,
      publisherToken: access.publisherToken,
      iceServers: [{ urls, username: null, credential: null }],
    };
    const mutableOptions = {
      connectTimeoutMs: 2_000,
      disconnectTimeoutMs: 1_000,
      onStateChange: (state: string) => originalStates.push(state),
    };
    const publisher = new RelayPublisher(mutableAccess, mutableOptions);

    mutableAccess.signalUrl = 'ws://attacker.invalid/v1/signal';
    mutableAccess.sessionId = 'attacker-session';
    mutableAccess.busId = 'attacker-bus';
    mutableAccess.publisherToken = new SecretToken('attacker-token');
    urls[0] = 'stun:attacker.invalid:3478';
    mutableOptions.connectTimeoutMs = 0;
    mutableOptions.onStateChange = (state: string) => replacementStates.push(state);

    await publisher.publish(streamWith(new FakeTrack()));

    expect(FakeWebSocket.instances[0]?.url).toBe(access.signalUrl);
    expect(FakeWebSocket.instances[0]?.sent).toContainEqual(
      expect.objectContaining({
        session_id: access.sessionId,
        bus_id: access.busId,
        token: access.publisherToken.exposeSecret(),
      }),
    );
    expect(FakePeerConnection.instances[0]?.configuration).toEqual({
      iceServers: [{ urls: ['stun:original.example:3478'] }],
    });
    expect(publisher.access).toMatchObject({
      signalUrl: access.signalUrl,
      sessionId: access.sessionId,
      busId: access.busId,
      publisherToken: access.publisherToken,
    });
    expect(Object.isFrozen(publisher.access)).toBe(true);
    expect(Object.isFrozen(publisher.access.iceServers)).toBe(true);
    expect(Object.isFrozen(publisher.access.iceServers?.[0]?.urls)).toBe(true);
    expect(originalStates).toEqual(['signaling', 'connecting', 'publishing']);
    expect(replacementStates).toEqual([]);
    await publisher.disconnect();
  });

  it('rejects reconnect before publication asynchronously', async () => {
    const publisher = new RelayPublisher(access);
    const reconnect = publisher.reconnect();

    await expect(reconnect).rejects.toMatchObject({
      code: 'relay.publisher_stream_missing',
    });
  });

  it('does not let an observer callback tear down healthy publication', async () => {
    const callbackErrors: Error[] = [];
    const publisher = new RelayPublisher(access, {
      onStateChange: () => {
        throw new Error('UI observer failed');
      },
      onError: (error) => callbackErrors.push(error),
    });

    await publisher.publish(streamWith(new FakeTrack()));

    expect(publisher.state).toBe('publishing');
    expect(callbackErrors).toEqual([
      expect.objectContaining({ code: 'relay.publisher_callback_failed' }),
      expect.objectContaining({ code: 'relay.publisher_callback_failed' }),
      expect.objectContaining({ code: 'relay.publisher_callback_failed' }),
    ]);
    await publisher.disconnect();
  });

  it('does not accept video or missing-kind RTP reports as audio readiness', async () => {
    const publisher = new RelayPublisher(access, { connectTimeoutMs: 30 });
    const publication = publisher.publish(streamWith(new FakeTrack()));
    await Promise.resolve();
    const connection = FakePeerConnection.instances[0];
    if (connection === undefined) throw new Error('missing fake PeerConnection');
    connection.includeAudioStats = false;

    await expect(publication).rejects.toMatchObject({
      code: 'relay.publisher_connect_timeout',
    });
  });
});

it('uses the shared PocketStation error type for publisher failures', () => {
  const failure = new PocketStationError('relay.test', 'test message');
  expect(failure).toBeInstanceOf(Error);
});
