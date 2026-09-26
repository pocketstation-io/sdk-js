import { ControlClient } from '../control/index.js';
import {
  RelayError,
  RelaySession,
  RelayTimeoutError,
  Session,
  Source,
} from '../node/index.js';

const createResponse = {
  session_id: 'session_123',
  required_buses: ['application', 'microphone'],
  source_token: 'source-secret',
  whip_url: 'https://relay.example/v1/sessions/session_123/whip',
  whep_url: 'https://relay.example/v1/sessions/session_123/whep',
  ice_servers: [],
};

describe('Node RelaySession composition', () => {
  it('composes Core routes, readiness, a safe invitation, and idempotent close', async () => {
    const requests: Array<{ method: string; path: string; authorization: string | null }> = [];
    const snapshots = [snapshot(true, 0), snapshot(true, 1)];
    const control = new ControlClient('https://control.example', {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          authorization: request.headers.get('authorization'),
        });
        const path = new URL(request.url).pathname;
        if (request.method === 'POST' && path === '/v1/sessions') {
          return json(201, createResponse);
        }
        if (request.method === 'GET') return json(200, snapshots.shift());
        if (request.method === 'POST' && path.endsWith('/invitations')) {
          return json(201, {
            join_code: 'opaque-code',
            join_url: 'https://receiver.example/?join=opaque-code',
            expires_at: '2026-09-21T18:00:00Z',
          });
        }
        return new Response(null, { status: 204 });
      },
    });
    const remote = await RelaySession.create({
      controlPlaneUrl: 'https://control.example',
      controlClient: control,
    });
    const session = new Session();
    const application = session.capture(Source.applicationName('PocketStation Fixture'));
    const microphone = session.capture(Source.defaultMicrophone());
    const publisher = remote.publisher(session);
    const applicationRoute = application.publish(publisher, 'application');
    const microphoneRoute = microphone.publish(publisher, 'microphone');

    await expect(remote.createReceiverInvitation()).rejects.toMatchObject({
      code: 'relay.publisher_not_active',
    });
    const publisherActivation = await remote.waitForPublisher({
      timeoutMs: 100,
      pollIntervalMs: 1,
    });
    const invitation = await remote.createReceiverInvitation();
    const receiverActivation = await remote.waitForReceiver({
      timeoutMs: 100,
      pollIntervalMs: 1,
    });

    expect(applicationRoute).toMatchObject({ busId: 'application' });
    expect(microphoneRoute).toMatchObject({ busId: 'microphone' });
    expect(applicationRoute.routeId).not.toBe(microphoneRoute.routeId);
    expect(publisherActivation.snapshot.ready).toBe(true);
    expect(receiverActivation.snapshot.subscriptionCount).toBe(1);
    expect(invitation).toMatchObject({
      joinCode: 'opaque-code',
      joinUrl: 'https://receiver.example/?join=opaque-code',
    });
    expect(invitation.sessionId.toString()).toBe('session_123');
    expect(remote.relayUrl).toBe('https://relay.example');
    expect(remote.toString()).not.toContain('source-secret');

    await remote.close();
    await remote.close();

    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ['POST', '/v1/sessions'],
      ['GET', '/v1/sessions/session_123'],
      ['POST', '/v1/sessions/session_123/invitations'],
      ['GET', '/v1/sessions/session_123'],
      ['DELETE', '/v1/sessions/session_123'],
    ]);
    expect(requests.slice(1).every(({ authorization }) => (
      authorization === 'Bearer source-secret'
    ))).toBe(true);
  });

  it('uses one bounded publisher deadline', async () => {
    const remote = await remoteWithFetch(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'POST') return json(201, createResponse);
      if (request.method === 'GET') return json(200, snapshot(false, 0));
      return new Response(null, { status: 204 });
    });

    await expect(remote.waitForPublisher({ timeoutMs: 5, pollIntervalMs: 1 }))
      .rejects.toBeInstanceOf(RelayTimeoutError);
    await remote.close();
  });

  it('forwards control-plane STUN servers into the native publisher', async () => {
    const remote = await remoteWithFetch(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'POST') {
        return json(201, {
          ...createResponse,
          ice_servers: [{
            urls: ['stun:stun.example:3478'],
            username: null,
            credential: null,
          }],
        });
      }
      return new Response(null, { status: 204 });
    });
    let publisherOptions: unknown;
    const session = {
      relay: (options: unknown) => {
        publisherOptions = options;
        return {};
      },
    } as unknown as Session;

    remote.publisher(session);

    expect(publisherOptions).toMatchObject({
      iceServers: [{ urls: ['stun:stun.example:3478'] }],
    });
    await remote.close();
  });

  it('rejects unsupported TURN credentials and deletes the remote Session', async () => {
    const requests: string[] = [];
    const control = new ControlClient('https://control.example', {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(`${request.method} ${new URL(request.url).pathname}`);
        if (request.method === 'POST') {
          return json(201, {
            ...createResponse,
            ice_servers: [{
              urls: ['turn:turn.example:3478'],
              username: 'publisher',
              credential: 'turn-secret',
            }],
          });
        }
        return new Response(null, { status: 204 });
      },
    });

    await expect(RelaySession.create({
      controlPlaneUrl: 'https://control.example',
      controlClient: control,
    })).rejects.toMatchObject({ code: 'relay.unsupported_ice_server' });
    expect(requests).toEqual([
      'POST /v1/sessions',
      'DELETE /v1/sessions/session_123',
    ]);
  });

  it('retries a transient control request failure within the same deadline', async () => {
    let reads = 0;
    const remote = await remoteWithFetch(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'POST') return json(201, createResponse);
      if (request.method === 'GET') {
        reads += 1;
        if (reads === 1) throw new TypeError('temporary transport failure');
        return json(200, snapshot(true, 0));
      }
      return new Response(null, { status: 204 });
    });

    await expect(remote.waitForPublisher({ timeoutMs: 100, pollIntervalMs: 1 }))
      .resolves.toMatchObject({ snapshot: { ready: true } });
    expect(reads).toBe(2);
    await remote.close();
  });

  it.each([
    'https://receiver.example/?join=wrong-code',
    'https://receiver.example/?join=opaque-code&token=subscriber-secret',
    'https://receiver.example/?join=opaque-code&session_id=session_123',
    'https://receiver.example/?join=opaque-code#session_123',
  ])('rejects an unsafe or mismatched invitation: %s', async (joinUrl) => {
    const remote = await remoteWithFetch(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === 'POST' && path === '/v1/sessions') {
        return json(201, createResponse);
      }
      if (request.method === 'GET') return json(200, snapshot(true, 0));
      if (request.method === 'POST' && path.endsWith('/invitations')) {
        return json(201, {
          join_code: 'opaque-code',
          join_url: joinUrl,
          expires_at: '2026-09-21T18:00:00Z',
        });
      }
      return new Response(null, { status: 204 });
    });
    await remote.waitForPublisher({ timeoutMs: 100, pollIntervalMs: 1 });

    await expect(remote.createReceiverInvitation()).rejects.toBeInstanceOf(RelayError);
    await remote.close();
  });

  it('rejects a non-origin relay URL before creating remote state', async () => {
    let called = false;
    const control = new ControlClient('https://control.example', {
      fetch: async () => {
        called = true;
        return json(201, createResponse);
      },
    });

    await expect(RelaySession.create({
      controlPlaneUrl: 'https://control.example',
      relayUrl: 'https://relay.example/not-an-origin',
      controlClient: control,
    })).rejects.toMatchObject({ code: 'relay.invalid_url' });
    expect(called).toBe(false);
  });

  it('deletes remote state when authoritative Relay endpoints disagree', async () => {
    const requests: string[] = [];
    const control = new ControlClient('https://control.example', {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(`${request.method} ${new URL(request.url).pathname}`);
        if (request.method === 'POST') {
          return json(201, {
            ...createResponse,
            whep_url: 'https://other-relay.example/v1/sessions/session_123/whep',
          });
        }
        return new Response(null, { status: 204 });
      },
    });

    await expect(RelaySession.create({
      controlPlaneUrl: 'https://control.example',
      controlClient: control,
    })).rejects.toMatchObject({ code: 'relay.response_identity' });
    expect(requests).toEqual([
      'POST /v1/sessions',
      'DELETE /v1/sessions/session_123',
    ]);
  });
});

async function remoteWithFetch(fetch: typeof globalThis.fetch): Promise<RelaySession> {
  const control = new ControlClient('https://control.example', { fetch });
  return RelaySession.create({
    controlPlaneUrl: 'https://control.example',
    relayUrl: 'https://relay.example',
    controlClient: control,
  });
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function snapshot(ready: boolean, subscriptionCount: number): object {
  return {
    session_id: 'session_123',
    state_revision: 2,
    relay_epoch: 'relay-epoch-1',
    relay_revision: 2,
    required_buses: ['application', 'microphone'],
    buses: ['application', 'microphone'].map((busId) => ({
      bus_id: busId,
      role: 'voice',
      source_active: ready,
      source_generation: ready ? 1 : 0,
    })),
    subscriptions: subscriptionCount === 0
      ? []
      : [{ subscriber_id: 'receiver_1', bus_id: 'mix' }],
    ready,
    source_active: ready,
    subscription_count: subscriptionCount,
    codec: 'opus',
  };
}
