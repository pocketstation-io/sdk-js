import { PocketStationError } from '../errors.js';
import {
  RelaySession,
  requestRelayCredentials,
} from '../browser/relay-session.js';

const CONFIG = {
  controlUrl: 'http://localhost:8090',
  relayUrl: 'ws://localhost:8080',
};

function mockFetch(body: unknown, ok = true, status = 201): void {
  globalThis.fetch = async () =>
    ({
      ok,
      status,
      json: async () => body,
    }) as Response;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'fetch');
});

describe('Relay session creation with a simulated control service', () => {
  it('Given a valid response When requested Then public credentials are mapped', async () => {
    mockFetch({
      room_id: 'session-001',
      source_token: 'publisher',
      listener_token: 'receiver',
    });

    await expect(requestRelayCredentials(CONFIG)).resolves.toEqual({
      sessionId: 'session-001',
      publisherToken: 'publisher',
      receiverToken: 'receiver',
      iceServers: undefined,
    });
  });

  it('Given ICE servers When requested Then no hardcoded fallback replaces them', async () => {
    const iceServers = [
      { urls: ['stun:relay.example:3478'] },
      {
        urls: ['turn:relay.example:3478'],
        username: 'user',
        credential: 'secret',
      },
    ];
    mockFetch({
      room_id: 'session-001',
      source_token: 'publisher',
      listener_token: 'receiver',
      ice_servers: iceServers,
    });

    await expect(requestRelayCredentials(CONFIG)).resolves.toMatchObject({
      iceServers,
    });
  });

  it('Given an HTTP failure When requested Then the error has a stable code', async () => {
    mockFetch({}, false, 500);

    await expect(requestRelayCredentials(CONFIG)).rejects.toMatchObject({
      code: 'relay.session_create_failed',
    });
  });

  it('Given an invalid response When requested Then it fails before WebRTC starts', async () => {
    mockFetch({ room_id: 'session-001' });

    await expect(requestRelayCredentials(CONFIG)).rejects.toMatchObject({
      code: 'relay.invalid_session_response',
    });
  });
});

describe('RelaySession before connect', () => {
  it('has no session identity or remote stream', async () => {
    const session = new RelaySession(CONFIG);

    expect(session.sessionId).toBeNull();
    expect(session.remoteStream).toBeNull();
    await expect(session.getStats()).resolves.toBeNull();
  });

  it('uses the shared PocketStation error type', () => {
    const failure = new PocketStationError('test.code', 'test message');

    expect(failure).toBeInstanceOf(Error);
    expect(failure.code).toBe('test.code');
  });
});
