import {
  ControlClient,
  ControlPlaneError,
  SecretToken,
  SessionId,
  type ControlFetch,
} from '../control/index.js';

const CREATE_RESPONSE = {
  session_id: 'session_123',
  required_buses: ['application', 'microphone'],
  source_token: 'source-secret',
  whip_url: 'https://relay.example/v1/sessions/session_123/whip',
  whep_url: 'https://relay.example/v1/sessions/session_123/whep',
  ice_servers: [
    {
      urls: ['turn:turn.example:3478'],
      username: 'session_123',
      credential: 'turn-secret',
    },
  ],
};

function snapshot(ready: boolean, subscriptionCount: number): object {
  return {
    session_id: 'session_123',
    state_revision: 3,
    relay_epoch: ready ? 'relay-epoch-1' : '',
    relay_revision: ready ? 2 : 0,
    required_buses: ['application', 'microphone'],
    buses: ['application', 'microphone'].map((busId) => ({
      bus_id: busId,
      role: 'voice',
      source_active: ready,
      source_generation: ready ? 1 : 0,
    })),
    subscriptions:
      subscriptionCount === 0
        ? []
        : [{ subscriber_id: 'receiver_1', bus_id: 'mix' }],
    ready,
    source_active: ready,
    subscription_count: subscriptionCount,
    codec: 'opus',
  };
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ControlClient', () => {
  test('maps the complete Session lifecycle wire contract and redacts credentials', async () => {
    const requests: Array<{
      readonly method: string;
      readonly path: string;
      readonly authorization: string | null;
      readonly body: unknown;
    }> = [];
    const fetch: ControlFetch = async (input, init = {}) => {
      const url = new URL(input.toString());
      const headers = new Headers(init.headers);
      requests.push({
        method: init.method ?? 'GET',
        path: url.pathname,
        authorization: headers.get('authorization'),
        body:
          typeof init.body === 'string'
            ? (JSON.parse(init.body) as unknown)
            : undefined,
      });
      if (init.method === 'POST' && url.pathname.endsWith('/v1/sessions')) {
        return jsonResponse(201, CREATE_RESPONSE);
      }
      if (init.method === 'GET') return jsonResponse(200, snapshot(true, 1));
      if (url.pathname.endsWith('/subscribe')) {
        return jsonResponse(200, {
          session_id: 'session_123',
          bus_id: 'mix',
          subscriber_token: 'next-subscriber-secret',
        });
      }
      if (url.pathname.endsWith('/publish')) {
        return jsonResponse(200, {
          session_id: 'session_123',
          bus_id: 'microphone',
          publisher_token: 'publisher-only-secret',
          signal_url: 'wss://relay.example/v1/signal',
          ice_servers: [],
        });
      }
      if (url.pathname.endsWith('/invitations')) {
        return jsonResponse(201, {
          join_code: 'opaque-code',
          join_url:
            'https://receiver.example/?join=opaque-code&control=https%3A%2F%2Fcontrol.example',
          expires_at: '2026-08-21T18:00:00Z',
        });
      }
      return new Response(null, { status: 204 });
    };

    const client = new ControlClient(
      'https://control.example/base?discarded=yes#also-discarded',
      { fetch },
    );
    const credentials = await client.createSession();
    const current = await client.session(
      credentials.sessionId,
      credentials.sourceToken,
    );
    const subscriber = await client.issueSubscriberCredentials(
      credentials.sessionId,
      credentials.sourceToken,
    );
    const publisher = await client.issuePublisherCredentials(
      credentials.sessionId,
      credentials.sourceToken,
      { busId: 'microphone' },
    );
    const invitation = await client.createInvitation(
      credentials.sessionId,
      credentials.sourceToken,
    );
    await client.deleteSession(credentials.sessionId, credentials.sourceToken);
    client.close();
    client.close();

    expect(credentials.sessionId.toString()).toBe('session_123');
    expect(credentials.requiredBuses).toEqual(['application', 'microphone']);
    expect(credentials.sourceToken.exposeSecret()).toBe('source-secret');
    expect(String(credentials.sourceToken)).not.toContain('source-secret');
    expect(JSON.stringify(credentials)).not.toContain('source-secret');
    expect(JSON.stringify(credentials)).not.toContain('turn-secret');
    expect(credentials.iceServers[0]?.urls).toEqual([
      'turn:turn.example:3478',
    ]);
    expect(credentials.iceServers[0]?.credential?.exposeSecret()).toBe(
      'turn-secret',
    );
    expect(Object.isFrozen(credentials)).toBe(true);
    expect(Object.isFrozen(credentials.requiredBuses)).toBe(true);
    expect(Object.isFrozen(credentials.iceServers)).toBe(true);
    expect(current.ready).toBe(true);
    expect(current.subscriptionCount).toBe(1);
    expect(current.buses[0]?.sourceGeneration).toBe(1);
    expect(current.subscriptions[0]?.subscriberId).toBe('receiver_1');
    expect(subscriber.subscriberToken.exposeSecret()).toBe(
      'next-subscriber-secret',
    );
    expect(subscriber.busId).toBe('mix');
    expect(publisher.busId).toBe('microphone');
    expect(publisher.signalUrl).toBe('wss://relay.example/v1/signal');
    expect(publisher.publisherToken.exposeSecret()).toBe(
      'publisher-only-secret',
    );
    expect(JSON.stringify(publisher)).not.toContain('publisher-only-secret');
    expect(invitation.joinCode).toBe('opaque-code');
    expect(invitation.sessionId).toBe(credentials.sessionId);
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/base/v1/sessions',
        authorization: null,
        body: { required_buses: ['application', 'microphone'] },
      },
      {
        method: 'GET',
        path: '/base/v1/sessions/session_123',
        authorization: 'Bearer source-secret',
        body: undefined,
      },
      {
        method: 'POST',
        path: '/base/v1/sessions/session_123/subscribe',
        authorization: 'Bearer source-secret',
        body: { bus_id: 'mix' },
      },
      {
        method: 'POST',
        path: '/base/v1/sessions/session_123/publish',
        authorization: 'Bearer source-secret',
        body: { bus_id: 'microphone' },
      },
      {
        method: 'POST',
        path: '/base/v1/sessions/session_123/invitations',
        authorization: 'Bearer source-secret',
        body: { bus_id: 'mix' },
      },
      {
        method: 'DELETE',
        path: '/base/v1/sessions/session_123',
        authorization: 'Bearer source-secret',
        body: undefined,
      },
    ]);
  });

  test('honors custom buses and request deadlines', async () => {
    let observedBody: unknown;
    const fetch: ControlFetch = async (_input, init) => {
      observedBody = JSON.parse(init?.body as string) as unknown;
      return jsonResponse(201, {
        ...CREATE_RESPONSE,
        required_buses: ['meeting.remote'],
      });
    };
    const client = new ControlClient('https://control.example', {
      timeoutMs: 50,
      fetch,
    });
    const credentials = await client.createSession({
      requiredBuses: ['meeting.remote'],
      timeoutMs: 20,
    });
    expect(observedBody).toEqual({ required_buses: ['meeting.remote'] });
    expect(credentials.requiredBuses).toEqual(['meeting.remote']);
  });

  test('bounds successful and error response bodies', async () => {
    const successClient = new ControlClient('https://control.example', {
      fetch: async () => new Response(new Uint8Array(65_537), { status: 201 }),
    });
    await expect(successClient.createSession()).rejects.toMatchObject({
      code: 'control.response_too_large',
    });

    const errorClient = new ControlClient('https://control.example', {
      fetch: async () => new Response(new Uint8Array(4_097), { status: 500 }),
    });
    await expect(errorClient.createSession()).rejects.toMatchObject({
      code: 'control.response_too_large',
    });
  });

  test('redacts bearer credentials from HTTP, transport, and body-stream errors', async () => {
    const token = new SecretToken('must-not-leak');
    const httpClient = new ControlClient('https://control.example', {
      fetch: async () =>
        new Response('rejected must-not-leak', { status: 401 }),
    });
    const httpError = await rejected(
      httpClient.deleteSession('session_123', token),
    );
    expect(httpError).toBeInstanceOf(ControlPlaneError);
    expect(httpError.message).not.toContain('must-not-leak');
    expect(httpError.message).toContain('[redacted]');
    expect((httpError as ControlPlaneError).statusCode).toBe(401);

    const transportClient = new ControlClient('https://control.example', {
      fetch: async () => {
        throw new Error('transport included must-not-leak');
      },
    });
    const transportError = await rejected(
      transportClient.deleteSession('session_123', token),
    );
    expect(transportError.message).not.toContain('must-not-leak');
    expect(transportError.message).toContain('[redacted]');

    const streamClient = new ControlClient('https://control.example', {
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error('stream included must-not-leak'));
            },
          }),
          { status: 401 },
        ),
    });
    const streamError = await rejected(
      streamClient.deleteSession('session_123', token),
    );
    expect(streamError.message).not.toContain('must-not-leak');
    expect(streamError.message).toContain('[redacted]');
  });

  test.each(['', '../escape', 'with/slash', 'café'])(
    'rejects unsafe Session identifier %p',
    (value) => {
      expect(() => new SessionId(value)).toThrow(RangeError);
    },
  );

  test('bounds Session identifiers and credentials in UTF-8 bytes', () => {
    expect(() => new SessionId('a'.repeat(129))).toThrow(RangeError);
    expect(() => new SecretToken('')).toThrow(RangeError);
    expect(() => new SecretToken('🙂'.repeat(1_025))).toThrow(RangeError);
    expect(new SecretToken('a'.repeat(4_096)).exposeSecret()).toHaveLength(4_096);
  });

  test.each([
    'https://user:password@control.example',
    'ftp://control.example',
    '/relative',
  ])('rejects invalid control origin %p', (url) => {
    expect(() => new ControlClient(url)).toThrow(TypeError);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 300_001])(
    'rejects invalid timeout %p',
    (timeoutMs) => {
      expect(
        () =>
          new ControlClient('https://control.example', {
            timeoutMs,
          }),
      ).toThrow(RangeError);
    },
  );

  test('rejects invalid and duplicate requested AudioBus identifiers', async () => {
    const client = new ControlClient('https://control.example', {
      fetch: async () => {
        throw new Error('fetch must not be reached');
      },
    });
    await expect(client.createSession({ requiredBuses: [] })).rejects.toThrow(
      'between 1 and 16',
    );
    await expect(
      client.createSession({ requiredBuses: ['application', 'application'] }),
    ).rejects.toThrow('duplicate');
    await expect(
      client.issueSubscriberCredentials(
        'session_123',
        new SecretToken('secret'),
        { busId: 'with/slash' },
      ),
    ).rejects.toThrow(RangeError);
  });

  test.each([true, -1, 1.5])(
    'rejects invalid subscription count %p',
    async (subscriptionCount) => {
      const client = new ControlClient('https://control.example', {
        fetch: async () =>
          jsonResponse(200, {
            ...snapshot(true, 0),
            subscription_count: subscriptionCount,
          }),
      });
      await expect(
        client.session('session_123', new SecretToken('source-secret')),
      ).rejects.toMatchObject({ code: 'control.response_decode' });
    },
  );

  test.each([
    ['array body', [], 'control.response_decode'],
    ['invalid JSON', '{', 'control.response_decode'],
    ['invalid UTF-8', new Uint8Array([0xff]), 'control.response_decode'],
  ])('rejects %s', async (_name, body, code) => {
    const response =
      typeof body === 'string'
        ? new Response(body, { status: 201 })
        : body instanceof Uint8Array
          ? new Response(body, { status: 201 })
          : jsonResponse(201, body);
    const client = new ControlClient('https://control.example', {
      fetch: async () => response,
    });
    await expect(client.createSession()).rejects.toMatchObject({ code });
  });

  test('rejects malformed credentials, ICE servers, buses, and subscriptions', async () => {
    const malformed = [
      { ...CREATE_RESPONSE, session_id: '../escape' },
      { ...CREATE_RESPONSE, source_token: '' },
      { ...CREATE_RESPONSE, required_buses: [] },
      { ...CREATE_RESPONSE, ice_servers: 'wrong' },
      {
        ...CREATE_RESPONSE,
        ice_servers: [{ urls: [7] }],
      },
      {
        ...CREATE_RESPONSE,
        ice_servers: [{ urls: Array.from({ length: 17 }, () => 'turn:x') }],
      },
      {
        ...CREATE_RESPONSE,
        ice_servers: Array.from({ length: 33 }, () => ({ urls: [] })),
      },
    ];
    for (const payload of malformed) {
      const client = new ControlClient('https://control.example', {
        fetch: async () => jsonResponse(201, payload),
      });
      await expect(client.createSession()).rejects.toBeInstanceOf(
        ControlPlaneError,
      );
    }

    const malformedSnapshots = [
      { ...snapshot(true, 0), state_revision: 0 },
      { ...snapshot(true, 0), relay_revision: -1 },
      { ...snapshot(true, 0), buses: Array.from({ length: 17 }, () => ({})) },
      {
        ...snapshot(true, 0),
        subscriptions: Array.from({ length: 1_025 }, () => ({})),
      },
    ];
    for (const payload of malformedSnapshots) {
      const client = new ControlClient('https://control.example', {
        fetch: async () => jsonResponse(200, payload),
      });
      await expect(
        client.session('session_123', new SecretToken('source-secret')),
      ).rejects.toBeInstanceOf(ControlPlaneError);
    }
  });

  test('has bounded timeout, caller cancellation, close cancellation, and closed state', async () => {
    const pendingFetch: ControlFetch = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });

    const timeoutClient = new ControlClient('https://control.example', {
      timeoutMs: 10,
      fetch: pendingFetch,
    });
    await expect(timeoutClient.createSession()).rejects.toMatchObject({
      code: 'control.timeout',
    });

    const cancellationClient = new ControlClient('https://control.example', {
      fetch: pendingFetch,
    });
    const cancellation = new AbortController();
    const cancelled = cancellationClient.createSession({
      signal: cancellation.signal,
    });
    cancellation.abort('caller secret must not escape');
    await expect(cancelled).rejects.toMatchObject({
      code: 'control.cancelled',
      message: 'control-plane request was cancelled',
    });

    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    await expect(
      cancellationClient.createSession({ signal: alreadyCancelled.signal }),
    ).rejects.toMatchObject({ code: 'control.cancelled' });

    const closeClient = new ControlClient('https://control.example', {
      fetch: pendingFetch,
    });
    const closed = closeClient.createSession();
    closeClient.close();
    await expect(closed).rejects.toMatchObject({ code: 'control.closed' });
    await expect(closeClient.createSession()).rejects.toThrow(
      'ControlClient has closed',
    );
  });

  test('applies the same deadline while streaming the response body', async () => {
    const client = new ControlClient('https://control.example', {
      timeoutMs: 10,
      fetch: async (_input, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new DOMException('aborted', 'AbortError')),
                { once: true },
              );
            },
          }),
          { status: 201 },
        ),
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'control.timeout',
    });
  });
});

async function rejected(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`operation rejected with a non-Error: ${String(error)}`);
  }
  throw new Error('operation unexpectedly resolved');
}
