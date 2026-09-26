import { jest } from '@jest/globals';

import { PocketStationError } from '../errors.js';
import {
  RelayReceiver,
  resolveRelayInvitation,
} from '../browser/relay-session.js';

const resolution = {
  session_id: 'session-001',
  bus_id: 'application',
  subscriber_token: 'subscriber-token',
  signal_url: 'ws://127.0.0.1:4800/v1/signal',
  ice_servers: [
    { urls: ['stun:relay.example:3478'] },
    {
      urls: 'turn:relay.example:3478',
      username: 'user',
      credential: 'secret',
    },
  ],
} as const;

function mockFetch(body: unknown, status = 200): jest.Mock {
  const call = jest.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  globalThis.fetch = call;
  return call;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'fetch');
});

describe('Relay invitation resolution', () => {
  it('maps current Session, AudioBus, subscriber, signal, and ICE fields', async () => {
    const fetch = mockFetch(resolution);

    await expect(
      resolveRelayInvitation({
        controlUrl: 'https://control.example.com',
        joinCode: 'one-time-code',
      }),
    ).resolves.toEqual({
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: resolution.subscriber_token,
      iceServers: resolution.ice_servers,
    });

    expect(fetch).toHaveBeenCalledWith(
      new URL('https://control.example.com/v1/invitations/one-time-code'),
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'omit',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('keeps HTTP rejection distinct from malformed response data', async () => {
    mockFetch({ error: 'invitation_not_found' }, 404);
    await expect(
      resolveRelayInvitation({
        controlUrl: 'https://control.example.com',
        joinCode: 'expired',
      }),
    ).rejects.toMatchObject({ code: 'relay.invitation_rejected' });

    mockFetch({ session_id: 'session-001' });
    await expect(
      resolveRelayInvitation({
        controlUrl: 'https://control.example.com',
        joinCode: 'invalid',
      }),
    ).rejects.toMatchObject({ code: 'relay.invalid_invitation_response' });
  });

  it('rejects oversized control-plane responses', async () => {
    mockFetch({ value: 'x'.repeat(17_000) });
    await expect(
      resolveRelayInvitation({
        controlUrl: 'https://control.example.com',
        joinCode: 'large',
      }),
    ).rejects.toMatchObject({ code: 'relay.invitation_response_too_large' });
  });
});

describe('RelayReceiver before connection', () => {
  it('accepts direct access and reports unavailable live values explicitly', () => {
    const receiver = new RelayReceiver({
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: resolution.subscriber_token,
    });

    expect(receiver.state).toBe('idle');
    expect(receiver.stream).toBeNull();
    expect(receiver.sessionState).toBeNull();
    expect(receiver.lastError).toBeNull();
    expect(receiver.access?.busId).toBe('application');
  });

  it('rejects invalid origins and unbounded deadlines during construction', () => {
    expect(
      () =>
        new RelayReceiver({ controlUrl: 'file:///tmp/control', joinCode: 'code' }),
    ).toThrow(PocketStationError);
    expect(
      () =>
        new RelayReceiver(
          { controlUrl: 'https://control.example.com', joinCode: 'code' },
          {
            connectTimeoutMs: 0,
          },
        ),
    ).toThrow(RangeError);
  });

  it('uses the shared PocketStation error type', () => {
    const failure = new PocketStationError('test.code', 'test message');
    expect(failure).toBeInstanceOf(Error);
    expect(failure.code).toBe('test.code');
  });
});

describe('RelayReceiver connected protocol', () => {
  class FakeTrack extends EventTarget {
    public readonly kind = 'audio';
    public readyState: MediaStreamTrackState = 'live';

    public stop(): void {
      this.readyState = 'ended';
    }
  }

  class FakeMediaStream {
    readonly #tracks: FakeTrack[] = [];

    public addTrack(track: FakeTrack): void {
      this.#tracks.push(track);
    }

    public getTracks(): FakeTrack[] {
      return [...this.#tracks];
    }

    public getAudioTracks(): FakeTrack[] {
      return [...this.#tracks];
    }
  }

  class FakePeerConnection {
    public static instances: FakePeerConnection[] = [];
    public readonly configuration: RTCConfiguration;
    public connectionState: RTCPeerConnectionState = 'new';
    public remoteDescription: RTCSessionDescription | null = null;
    public onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
    public onconnectionstatechange: (() => void) | null = null;
    public ontrack: ((event: RTCTrackEvent) => void) | null = null;

    public constructor(configuration: RTCConfiguration) {
      this.configuration = configuration;
      FakePeerConnection.instances.push(this);
    }

    public addTransceiver(): void {}

    public async createOffer(): Promise<RTCSessionDescriptionInit> {
      return { type: 'offer', sdp: 'v=0\r\n' };
    }

    public async setLocalDescription(): Promise<void> {}

    public async setRemoteDescription(
      description: RTCSessionDescriptionInit,
    ): Promise<void> {
      this.remoteDescription = description as RTCSessionDescription;
      this.connectionState = 'connected';
      const track = new FakeTrack();
      queueMicrotask(() => {
        this.onconnectionstatechange?.();
        this.ontrack?.({ track, streams: [] } as unknown as RTCTrackEvent);
      });
    }

    public async addIceCandidate(): Promise<void> {}

    public async getStats(): Promise<RTCStatsReport> {
      return { forEach(): void {} } as RTCStatsReport;
    }

    public close(): void {
      this.connectionState = 'closed';
    }
  }

  type SocketListener = (event: Event) => void;

  class FakeWebSocket {
    public static readonly OPEN = 1;
    public static readonly CLOSED = 3;
    public static instances: FakeWebSocket[] = [];
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
      if (message.type === 'SUBSCRIBE') {
        queueMicrotask(() => {
          this.onmessage?.({
            data: JSON.stringify({ type: 'SDP_ANSWER', sdp_answer: 'v=0\r\n' }),
          } as MessageEvent<string>);
        });
      }
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

  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakePeerConnection.instances = [];
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      value: FakePeerConnection,
    });
    Object.defineProperty(globalThis, 'MediaStream', {
      configurable: true,
      value: FakeMediaStream,
    });
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
    Reflect.deleteProperty(globalThis, 'MediaStream');
    Reflect.deleteProperty(globalThis, 'WebSocket');
  });

  it('rejects state for a different Session instead of accepting poisoned identity', async () => {
    const receiver = new RelayReceiver({
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: resolution.subscriber_token,
    });
    await receiver.connect();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('missing fake WebSocket');

    socket.receive({
      type: 'SESSION_STATE',
      session_id: 'different-session',
      bus_id: resolution.bus_id,
      source_active: true,
      subscription_count: 1,
    });
    await Promise.resolve();

    expect(receiver.lastError?.code).toBe('relay.receiver_state_identity_mismatch');
    expect(receiver.state).toBe('failed');
  });

  it('reports latency and fails explicitly when encrypted media is unsupported', async () => {
    const receiver = new RelayReceiver({
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: resolution.subscriber_token,
    });
    await receiver.connect();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('missing fake WebSocket');

    receiver.reportLatency({
      captureMs: 0,
      encodeMs: 0,
      relayRttMs: 18,
      jitterBufferMs: 6,
      decodeMs: 2,
      packetLossPct: 1,
      clockDriftPpm: 4,
    });
    expect(socket.sent).toContainEqual(
      expect.objectContaining({ type: 'LATENCY_REPORT' }),
    );

    socket.receive({ type: 'KEY_EXCHANGE', sframe_key: 'opaque-key' });
    await Promise.resolve();
    expect(receiver.lastError?.code).toBe('relay.sframe_unsupported');
    expect(receiver.state).toBe('failed');
  });

  it('snapshots direct authority, ICE, deadlines, and callbacks at construction', async () => {
    const originalStates: string[] = [];
    const replacementStates: string[] = [];
    const urls = ['stun:original.example:3478'];
    const mutableAccess = {
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: resolution.subscriber_token,
      iceServers: [{ urls }],
    };
    const mutableOptions = {
      connectTimeoutMs: 2_000,
      disconnectTimeoutMs: 1_000,
      onStateChange: (state: string) => originalStates.push(state),
    };
    const receiver = new RelayReceiver(mutableAccess, mutableOptions);

    mutableAccess.signalUrl = 'ws://attacker.invalid/v1/signal';
    mutableAccess.sessionId = 'attacker-session';
    mutableAccess.busId = 'attacker-bus';
    mutableAccess.subscriberToken = 'attacker-token';
    urls[0] = 'stun:attacker.invalid:3478';
    mutableOptions.connectTimeoutMs = 0;
    mutableOptions.onStateChange = (state: string) => replacementStates.push(state);

    const stream = await receiver.connect();

    expect(FakeWebSocket.instances[0]?.url).toBe(resolution.signal_url);
    expect(FakeWebSocket.instances[0]?.sent).toContainEqual(
      expect.objectContaining({
        session_id: resolution.session_id,
        bus_id: resolution.bus_id,
        token: resolution.subscriber_token,
      }),
    );
    expect(FakePeerConnection.instances[0]?.configuration).toEqual({
      iceServers: [{ urls: ['stun:original.example:3478'] }],
    });
    expect(receiver.access).toMatchObject({
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: resolution.subscriber_token,
    });
    expect(Object.isFrozen(receiver.access)).toBe(true);
    expect(Object.isFrozen(receiver.access?.iceServers)).toBe(true);
    expect(Object.isFrozen(receiver.access?.iceServers?.[0]?.urls)).toBe(true);
    expect(originalStates).toEqual(['signaling', 'connecting', 'connected']);
    expect(replacementStates).toEqual([]);

    const track = stream.getAudioTracks()[0] as unknown as FakeTrack;
    expect(track.readyState).toBe('live');
    await receiver.disconnect();
    await receiver.disconnect();
    expect(track.readyState).toBe('ended');
    expect(receiver.access).toBeNull();
    expect(receiver.stream).toBeNull();
  });

  it('snapshots an invitation before its asynchronous redemption', async () => {
    const invitation = {
      controlUrl: 'https://control.example.com',
      joinCode: 'original-code',
    };
    const fetch = mockFetch(resolution);
    const receiver = new RelayReceiver(invitation);
    invitation.controlUrl = 'https://attacker.invalid';
    invitation.joinCode = 'attacker-code';

    await receiver.connect();

    expect(fetch).toHaveBeenCalledWith(
      new URL('https://control.example.com/v1/invitations/original-code'),
      expect.any(Object),
    );
    await receiver.disconnect();
  });

  it('does not let an observer callback tear down healthy receiving', async () => {
    const callbackErrors: Error[] = [];
    const receiver = new RelayReceiver(
      {
        signalUrl: resolution.signal_url,
        sessionId: resolution.session_id,
        busId: resolution.bus_id,
        subscriberToken: resolution.subscriber_token,
      },
      {
        onStateChange: () => {
          throw new Error('UI observer failed');
        },
        onError: (error) => callbackErrors.push(error),
      },
    );

    await receiver.connect();

    expect(receiver.state).toBe('connected');
    expect(callbackErrors).toEqual([
      expect.objectContaining({ code: 'relay.receiver_callback_failed' }),
      expect.objectContaining({ code: 'relay.receiver_callback_failed' }),
      expect.objectContaining({ code: 'relay.receiver_callback_failed' }),
    ]);
    await receiver.disconnect();
  });
});
