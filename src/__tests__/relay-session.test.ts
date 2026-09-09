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
