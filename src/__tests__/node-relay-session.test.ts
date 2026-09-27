import { inspect } from 'node:util';

import { ControlClient, SecretUrl } from '../control/index.js';
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

const privateInvitationResponse = {
  join_code: '4a54c6b9-fdc2-4e0c-a740-715efdcf03de',
  join_url:
    'https://receiver.example/join/4a54c6b9-fdc2-4e0c-a740-715efdcf03de#secret=abcdefghijklmnopqrstuv',
  share_alias: 'quiet-willow-river',
  share_url:
    'https://receiver.example/quiet-willow-river#secret=abcdefghijklmnopqrstuv',
  visibility: 'private',
  expires_at: '2026-09-21T18:00:00Z',
};

describe('Node RelaySession composition', () => {
  it('composes Core routes, readiness, a safe invitation, and idempotent close', async () => {
    const requests: Array<{
      method: string;
      path: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const snapshots = [snapshot(true, 0), snapshot(true, 1)];
    const control = new ControlClient('https://control.example', {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          authorization: request.headers.get('authorization'),
          body: request.method === 'POST' ? await request.json() : null,
        });
        const path = new URL(request.url).pathname;
        if (request.method === 'POST' && path === '/v1/sessions') {
          return json(201, createResponse);
        }
        if (request.method === 'GET') return json(200, snapshots.shift());
        if (request.method === 'POST' && path.endsWith('/invitations')) {
          return json(201, privateInvitationResponse);
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

    await expect(remote.createReceiverInvitation({ busId: 'application' })).rejects.toMatchObject({
      code: 'relay.publisher_not_active',
    });
    const publisherActivation = await remote.waitForPublisher({
      timeoutMs: 100,
      pollIntervalMs: 1,
    });
    const invitation = await remote.createReceiverInvitation({
      busId: 'application',
      visibility: 'private',
    });
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
      busId: 'application',
      joinCode: '4a54c6b9-fdc2-4e0c-a740-715efdcf03de',
      shareAlias: 'quiet-willow-river',
      visibility: 'private',
    });
    expect(invitation.joinUrl).toBeInstanceOf(SecretUrl);
    expect(invitation.shareUrl).toBeInstanceOf(SecretUrl);
    expect(invitation.exposeShareUrl()).toBe(privateInvitationResponse.share_url);
    expect(JSON.stringify(invitation)).not.toContain('abcdefghijklmnopqrstuv');
    expect(String(invitation)).not.toContain('abcdefghijklmnopqrstuv');
    expect(inspect(invitation)).not.toContain('abcdefghijklmnopqrstuv');
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
    expect(requests[2]?.body).toEqual({
      bus_id: 'application',
      visibility: 'private',
    });
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
    [
      'wrong opaque-link path',
      { join_url: 'https://receiver.example/join/00000000-0000-4000-8000-000000000000#secret=abcdefghijklmnopqrstuv' },
    ],
    [
      'query-bearing readable link',
      { share_url: 'https://receiver.example/quiet-willow-river?token=leak#secret=abcdefghijklmnopqrstuv' },
    ],
    [
      'different private secrets',
      { share_url: 'https://receiver.example/quiet-willow-river#secret=zyxwvutsrqponmlkjihgfe' },
    ],
    [
      'public visibility with a three-word alias',
      {
        visibility: 'public',
        join_url: 'https://receiver.example/join/4a54c6b9-fdc2-4e0c-a740-715efdcf03de',
        share_url: 'https://receiver.example/quiet-willow-river',
      },
    ],
  ])('rejects an unsafe or mismatched invitation: %s', async (_name, delta) => {
    const remote = await remoteWithFetch(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === 'POST' && path === '/v1/sessions') {
        return json(201, createResponse);
      }
      if (request.method === 'GET') return json(200, snapshot(true, 0));
      if (request.method === 'POST' && path.endsWith('/invitations')) {
        return json(201, { ...privateInvitationResponse, ...delta });
      }
      return new Response(null, { status: 204 });
    });
    await remote.waitForPublisher({ timeoutMs: 100, pollIntervalMs: 1 });

    await expect(remote.createReceiverInvitation({ busId: 'application' }))
      .rejects.toMatchObject({ code: 'control.response_decode' });
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
