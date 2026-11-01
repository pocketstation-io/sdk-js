import { jest } from '@jest/globals';
import { inspect } from 'node:util';

import { PocketStationError } from '../errors.js';
import { InvitationUnavailableError } from '../control/control-client.js';
import { SecretToken } from '../control/types.js';
import type { RelayReceiverOptions } from '../browser/types.js';
import {
  RelayReceiver,
  parseRelayInvitationLocation,
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
      urls: ['turn:relay.example:3478'],
      username: 'user',
      credential: 'secret',
    },
  ],
} as const;

const stereoOffer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:music\r\na=recvonly\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;stereo=0\r\n';

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
  it('parses location without trusting its origin and redeems through POST', async () => {
    const fetch = mockFetch(resolution);
    const invitation = parseRelayInvitationLocation(
      'https://untrusted.example/quiet-willow-river#join=4a54c6b9-fdc2-4e0c-a740-715efdcf03de',
    );

    const access = await resolveRelayInvitation(invitation, {
      controlPlaneUrl: 'https://control.example.com',
    });

    expect(access.signalUrl).toBe(resolution.signal_url);
    expect(access.sessionId).toBe(resolution.session_id);
    expect(access.busId).toBe(resolution.bus_id);
    expect(access.subscriberToken.exposeSecret()).toBe(resolution.subscriber_token);
    expect(access.iceServers?.[1]?.credential?.exposeSecret()).toBe('secret');
    expect(JSON.stringify(access)).not.toContain(resolution.subscriber_token);
    expect(JSON.stringify(access)).not.toContain('secret');

    expect(fetch).toHaveBeenCalledWith(
      new URL(
        'https://control.example.com/v1/join/quiet-willow-river',
      ),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ join_code: '4a54c6b9-fdc2-4e0c-a740-715efdcf03de' }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects an arbitrary control origin carried in the invitation location', () => {
    expect(() =>
      parseRelayInvitationLocation(
        'https://receiver.example/quiet-willow?control=https%3A%2F%2Fevil.example',
      ),
    ).toThrow(PocketStationError);
  });

  it('does not retain a private fragment secret in transport errors', async () => {
    const privateSecret = '4a54c6b9-fdc2-4e0c-a740-715efdcf03de';
    globalThis.fetch = jest.fn(async () => {
      throw new Error(`transport reflected ${privateSecret}`);
    });

    const failure = await resolveRelayInvitation(
      {
        locator: 'quiet-willow-river',
        joinCode: new SecretToken(privateSecret),
      },
      { controlPlaneUrl: 'https://control.example.com' },
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'relay.invitation_request_failed' });
    expect(String(failure)).not.toContain(privateSecret);
    expect(JSON.stringify(failure)).not.toContain(privateSecret);
    expect(inspect(failure)).not.toContain(privateSecret);
  });

  it('keeps HTTP rejection distinct from malformed response data', async () => {
    mockFetch({ error: 'invitation_not_found' }, 404);
    await expect(
      resolveRelayInvitation({
        locator: 'quiet-willow',
        joinCode: new SecretToken('4a54c6b9-fdc2-4e0c-a740-715efdcf03de'),
      }, { controlPlaneUrl: 'https://control.example.com' }),
    ).rejects.toBeInstanceOf(InvitationUnavailableError);

    mockFetch({ session_id: 'session-001' });
    await expect(
      resolveRelayInvitation({
        locator: 'quiet-willow',
        joinCode: new SecretToken('4a54c6b9-fdc2-4e0c-a740-715efdcf03de'),
      }, { controlPlaneUrl: 'https://control.example.com' }),
    ).rejects.toMatchObject({ code: 'relay.invalid_invitation_response' });
  });

  it('rejects oversized control-plane responses', async () => {
    mockFetch({ value: 'x'.repeat(17_000) });
    await expect(
      resolveRelayInvitation({
        locator: 'quiet-willow',
        joinCode: new SecretToken('4a54c6b9-fdc2-4e0c-a740-715efdcf03de'),
      }, { controlPlaneUrl: 'https://control.example.com' }),
    ).rejects.toMatchObject({ code: 'relay.invitation_response_too_large' });
  });
});

describe('RelayReceiver before connection', () => {
  it('accepts direct access and reports unavailable live values explicitly', () => {
    const receiver = new RelayReceiver({
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: new SecretToken(resolution.subscriber_token),
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
        new RelayReceiver(
          { locator: 'quiet-willow', joinCode: new SecretToken('4a54c6b9-fdc2-4e0c-a740-715efdcf03de') },
          { controlPlaneUrl: 'file:///tmp/control' },
        ),
    ).toThrow(PocketStationError);
    expect(
      () =>
        new RelayReceiver(
          { locator: 'quiet-willow', joinCode: new SecretToken('4a54c6b9-fdc2-4e0c-a740-715efdcf03de') },
          {
            controlPlaneUrl: 'https://control.example.com',
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
    public static emitCandidateDuringLocalDescription = false;
    public static offerSdp: string | undefined = 'v=0\r\n';
    public static acceptedSdp: ((sdp: string) => string) | null = null;
    public static omitLocalDescription = false;
    public static onLocalDescription: (() => void) | null = null;
    public static onCreateOffer: (() => void) | null = null;
    public static offerOperation: Promise<RTCSessionDescriptionInit> | null = null;
    public static localDescriptionOperation: Promise<void> | null = null;
    public static statistics: Record<string, unknown>[] = [];
    public readonly configuration: RTCConfiguration;
    public connectionState: RTCPeerConnectionState = 'new';
    public localDescription: RTCSessionDescription | null = null;
    public readonly localDescriptions: RTCSessionDescriptionInit[] = [];
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
      FakePeerConnection.onCreateOffer?.();
      return FakePeerConnection.offerOperation ?? { type: 'offer', sdp: FakePeerConnection.offerSdp };
    }

    public async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
      this.localDescriptions.push(description);
      if (!FakePeerConnection.omitLocalDescription) {
        this.localDescription = {
          ...description,
          sdp: FakePeerConnection.acceptedSdp?.(description.sdp ?? '') ?? description.sdp,
        } as RTCSessionDescription;
      }
      FakePeerConnection.onLocalDescription?.();
      if (FakePeerConnection.emitCandidateDuringLocalDescription) {
        this.onicecandidate?.({
          candidate: { candidate: 'candidate:early-receiver' },
        } as unknown as RTCPeerConnectionIceEvent);
      }
      if (FakePeerConnection.localDescriptionOperation !== null) {
        await FakePeerConnection.localDescriptionOperation;
      }
    }

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
      return new Map(FakePeerConnection.statistics.map((report) => [report.id, report])) as unknown as RTCStatsReport;
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
    FakePeerConnection.emitCandidateDuringLocalDescription = false;
    FakePeerConnection.offerSdp = 'v=0\r\n';
    FakePeerConnection.acceptedSdp = null;
    FakePeerConnection.omitLocalDescription = false;
    FakePeerConnection.onLocalDescription = null;
    FakePeerConnection.onCreateOffer = null;
    FakePeerConnection.offerOperation = null;
    FakePeerConnection.localDescriptionOperation = null;
    FakePeerConnection.statistics = [];
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

  function directReceiver(options: RelayReceiverOptions = {}): RelayReceiver {
    return new RelayReceiver({
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: new SecretToken(resolution.subscriber_token),
    }, options);
  }

  it.each([undefined, 'default'] as const)(
    'given profile %s when connecting then signals browser-accepted SDP without a stereo override',
    async (audioProfile) => {
      FakePeerConnection.offerSdp = stereoOffer;
      FakePeerConnection.acceptedSdp = (sdp) => sdp + 'a=x-browser-accepted:yes\r\n';
      const receiver = directReceiver({ audioProfile });
      await receiver.connect();
      expect(FakePeerConnection.instances[0].localDescriptions[0].sdp).toBe(stereoOffer);
      expect(FakeWebSocket.instances[0].sent[0]).toMatchObject({
        type: 'SUBSCRIBE', sdp_offer: stereoOffer + 'a=x-browser-accepted:yes\r\n',
      });
      await receiver.disconnect();
    },
  );

  it('given music-stereo when options mutate and reconnect then retains the constructor preference', async () => {
    FakePeerConnection.offerSdp = stereoOffer;
    const options: { audioProfile: 'default' | 'music-stereo' } = { audioProfile: 'music-stereo' };
    const receiver = directReceiver(options);
    options.audioProfile = 'default';
    await receiver.connect();
    await receiver.reconnect();
    expect(FakeWebSocket.instances).toHaveLength(2);
    for (const socket of FakeWebSocket.instances) {
      expect(socket.sent[0]).toMatchObject({ sdp_offer: stereoOffer.replace('stereo=0', 'stereo=1') });
    }
    await receiver.disconnect();
  });

  it('given music-stereo when Relay requests ICE restart then reuses the same receive preference', async () => {
    FakePeerConnection.offerSdp = stereoOffer;
    let connectedCount = 0;
    let ready: () => void = () => {};
    const restarted = new Promise<void>((resolve) => { ready = resolve; });
    const receiver = directReceiver({
      audioProfile: 'music-stereo',
      onStateChange: (state) => { if (state === 'connected' && ++connectedCount === 2) ready(); },
    });
    await receiver.connect();
    FakeWebSocket.instances[0].receive({ type: 'ICE_RESTART' });
    await restarted;
    expect(FakeWebSocket.instances[1].sent[0]).toMatchObject({
      sdp_offer: stereoOffer.replace('stereo=0', 'stereo=1'),
    });
    await receiver.disconnect();
  });

  it.each([null, false, 'voice-mono', '', 1])(
    'given invalid plain-JavaScript profile %s when constructing then rejects before opening resources',
    (audioProfile) => {
      expect(() => directReceiver({ audioProfile } as unknown as RelayReceiverOptions))
        .toThrow(expect.objectContaining({ code: 'relay.invalid_audio_profile' }));
      expect(FakePeerConnection.instances).toHaveLength(0);
      expect(FakeWebSocket.instances).toHaveLength(0);
    },
  );

  it.each(['missing-offer', 'missing-local', 'discarded-preference', 'no-opus'])(
    'given %s when requesting stereo then fails without subscription and closes resources',
    async (failure) => {
      FakePeerConnection.offerSdp = failure === 'missing-offer' ? undefined : stereoOffer;
      FakePeerConnection.omitLocalDescription = failure === 'missing-local';
      if (failure === 'discarded-preference') {
        FakePeerConnection.acceptedSdp = (sdp) => sdp.replace('stereo=1', 'stereo=0');
      }
      if (failure === 'no-opus') FakePeerConnection.offerSdp = 'v=0\r\n';
      const receiver = directReceiver({ audioProfile: 'music-stereo' });
      await expect(receiver.connect()).rejects.toMatchObject({
        code: failure.startsWith('missing') ? 'relay.sdp_offer_missing' : 'relay.stereo_receive_unsupported',
      });
      expect(FakeWebSocket.instances[0].sent).toHaveLength(0);
      expect(FakePeerConnection.instances[0].connectionState).toBe('closed');
      expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
      await receiver.disconnect();
    },
  );

  it.each(['offer', 'local-description'])(
    'given a hanging %s when startup is cancelled then joins signaling and closes WebRTC',
    async (stage) => {
      FakePeerConnection.offerSdp = stereoOffer;
      let entered: () => void = () => {};
      const started = new Promise<void>((resolve) => { entered = resolve; });
      if (stage === 'offer') {
        FakePeerConnection.onCreateOffer = entered;
        FakePeerConnection.offerOperation = new Promise(() => {});
      } else {
        FakePeerConnection.onLocalDescription = entered;
        FakePeerConnection.localDescriptionOperation = new Promise(() => {});
      }
      const receiver = directReceiver({ audioProfile: 'music-stereo' });
      const controller = new AbortController();
      const connected = receiver.connect({ signal: controller.signal });
      await started;
      controller.abort();
      await expect(connected).rejects.toMatchObject({ code: 'relay.connect_cancelled' });
      expect(FakeWebSocket.instances[0].sent).toHaveLength(0);
      expect(FakePeerConnection.instances[0].connectionState).toBe('closed');
      expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
      await receiver.disconnect();
    },
  );

  it('given selected codec identity when observing then resolves that codec rather than report order', async () => {
    const receiver = directReceiver();
    await receiver.connect();
    FakePeerConnection.statistics = [
      { id: 'unrelated', type: 'codec', mimeType: 'audio/PCMU', channels: 1, payloadType: 0 },
      { id: 'selected', type: 'codec', mimeType: 'audio/opus', clockRate: 48_000, channels: 2,
        payloadType: 111, sdpFmtpLine: 'minptime=10;stereo=1' },
      { id: 'audio', type: 'inbound-rtp', kind: 'audio', codecId: 'selected', packetsReceived: 7 },
      { id: 'video', type: 'inbound-rtp', kind: 'video', codecId: 'unrelated' },
    ];
    expect(await receiver.observe()).toMatchObject({
      codecMimeType: 'audio/opus', codecClockRateHz: 48_000, codecChannelCount: 2,
      codecPayloadType: 111, codecSdpFmtpLine: 'minptime=10;stereo=1', packetsReceived: 7,
      acousticOutput: 'unavailable',
    });
    await receiver.disconnect();
  });

  it.each(['missing', 'wrong-id', 'wrong-type', 'video-codec', 'invalid-values'])(
    'given %s codec metadata when observing then leaves unavailable fields null',
    async (fixture) => {
      const receiver = directReceiver();
      await receiver.connect();
      FakePeerConnection.statistics = fixture === 'missing' ? [] : [
        { id: 'audio', type: 'inbound-rtp', kind: 'audio', codecId: 'selected' },
        { id: fixture === 'wrong-id' ? 'other' : 'selected',
          type: fixture === 'wrong-type' ? 'candidate-pair' : 'codec',
          mimeType: fixture === 'video-codec' ? 'video/VP8' : 'audio/opus',
          clockRate: Number.NaN, channels: 0, payloadType: 128, sdpFmtpLine: null },
      ];
      expect(await receiver.observe()).toMatchObject({
        codecMimeType: fixture === 'invalid-values' ? 'audio/opus' : null,
        codecClockRateHz: null, codecChannelCount: null, codecPayloadType: null, codecSdpFmtpLine: null,
        acousticOutput: 'unavailable',
      });
      await receiver.disconnect();
    },
  );

  it('rejects state for a different Session instead of accepting poisoned identity', async () => {
    const receiver = new RelayReceiver({
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: new SecretToken(resolution.subscriber_token),
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

  it('sends early browser ICE only after the authorized subscription exists', async () => {
    FakePeerConnection.emitCandidateDuringLocalDescription = true;
    const receiver = new RelayReceiver({
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: new SecretToken(resolution.subscriber_token),
    });

    await receiver.connect();

    expect(FakeWebSocket.instances[0]?.sent.slice(0, 2)).toEqual([
      {
        type: 'SUBSCRIBE',
        session_id: resolution.session_id,
        bus_id: resolution.bus_id,
        token: resolution.subscriber_token,
        sdp_offer: 'v=0\r\n',
      },
      { type: 'ICE', candidate: 'candidate:early-receiver' },
    ]);
    await receiver.disconnect();
  });

  it('reports latency and fails explicitly when encrypted media is unsupported', async () => {
    const receiver = new RelayReceiver({
      signalUrl: resolution.signal_url,
      sessionId: resolution.session_id,
      busId: resolution.bus_id,
      subscriberToken: new SecretToken(resolution.subscriber_token),
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
      subscriberToken: new SecretToken(resolution.subscriber_token),
      iceServers: [{ urls, username: null, credential: null }],
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
    mutableAccess.subscriberToken = new SecretToken('attacker-token');
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
      subscriberToken: new SecretToken(resolution.subscriber_token),
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
      locator: 'quiet-willow',
      joinCode: new SecretToken('4a54c6b9-fdc2-4e0c-a740-715efdcf03de'),
    };
    const fetch = mockFetch(resolution);
    const receiver = new RelayReceiver(invitation, {
      controlPlaneUrl: 'https://control.example.com',
    });
    invitation.locator = 'attacker-code';

    await receiver.connect();

    expect(fetch).toHaveBeenCalledWith(
      new URL(
        'https://control.example.com/v1/join/quiet-willow',
      ),
      expect.objectContaining({ method: 'POST' }),
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
        subscriberToken: new SecretToken(resolution.subscriber_token),
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
