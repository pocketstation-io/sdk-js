import { inspect } from 'node:util';
import { jest } from '@jest/globals';
import { ControlClient, InvitationUnavailableError, SecretToken } from '../control/index.js';
import { parseRelayInvitationLocation, resolveRelayInvitation } from '../browser/relay-session.js';

const code = '4a54c6b9-fdc2-4e0c-a740-715efdcf03de';
const other = '00000000-0000-4000-8000-000000000000';
const access = { session_id: 'session_123', bus_id: 'application', subscriber_token: 'subscriber-capability', signal_url: 'wss://relay.example/v1/signal', whep_url: 'https://relay.example/v1/sessions/session_123/whep', ice_servers: [] };

describe('readable navigation has no independent authority', () => {
  test.each(['quiet-willow', 'quiet-willow-river', 'owl-sun', 'owl-sun-elm', 'rice-river', 'silly-mountain', 'lemon-corpus', 'amberaura-amberbadger', ...[4, 8, 15].map(count => Array(count).fill('mountain').join('-'))])('%s requires original code in control and browser clients', async (words) => {
    const fetch = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(access)));
    const client = new ControlClient('https://control.example', { fetch });
    globalThis.fetch = fetch;
    await expect(client.redeemInvitation(words)).rejects.toBeInstanceOf(InvitationUnavailableError);
    await expect(resolveRelayInvitation({ locator: words }, { controlPlaneUrl: 'https://control.example' })).rejects.toBeInstanceOf(InvitationUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
    await client.redeemInvitation(words, { joinCode: new SecretToken(code) });
    const parsed = parseRelayInvitationLocation(`https://receiver.example/${words}#join=${code}`);
    await resolveRelayInvitation(parsed, { controlPlaneUrl: 'https://control.example' });
    for (const [url, init] of fetch.mock.calls) {
      expect(String(url)).toBe(`https://control.example/v1/join/${words}`);
      expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ join_code: code }), redirect: 'error', referrerPolicy: 'no-referrer' });
    }
    for (const text of [JSON.stringify(parsed), inspect(parsed)]) expect(text).not.toContain(code);
  });

  test('opaque redemption keeps the capability out of request URLs and parsed values', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => { calls.push([String(url), init]); return new Response(JSON.stringify(access)); };
    globalThis.fetch = fetch;
    const client = new ControlClient('https://control.example', { fetch });
    await client.redeemInvitation(new SecretToken(code));
    const parsed = parseRelayInvitationLocation(`https://receiver.example/join#join=${code}`);
    expect(parsed.locator).toBeInstanceOf(SecretToken);
    await resolveRelayInvitation(parsed, { controlPlaneUrl: 'https://control.example' });
    expect(calls).toHaveLength(2);
    for (const [url, init] of calls) { expect(url).toBe('https://control.example/v1/join'); expect(init?.body).toBe(JSON.stringify({ join_code: code })); }
    expect(inspect(parsed)).not.toContain(code);
    await expect(client.inspectInvitation(new SecretToken(code))).rejects.toThrow('readable navigation alias');
    expect(calls).toHaveLength(2);
  });

  test('deprecated secret only aliases the same opaque code and conflicting credentials fail locally', async () => {
    const fetch = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(access)));
    const client = new ControlClient('https://control.example', { fetch });
    await client.redeemInvitation('quiet-willow', { secret: new SecretToken(code) });
    await expect(client.redeemInvitation('quiet-willow', { secret: new SecretToken('abcdefghijklmnopqrstuv') })).rejects.toThrow('opaque delegated join credential');
    await expect(client.redeemInvitation('quiet-willow', { joinCode: new SecretToken(code), secret: new SecretToken(other) })).rejects.toThrow('disagree');
    await expect(client.redeemInvitation(new SecretToken(code), { joinCode: new SecretToken(other) })).rejects.toBeInstanceOf(InvitationUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(() => parseRelayInvitationLocation('https://receiver.example/quiet-willow#secret=abcdefghijklmnopqrstuv')).toThrow();
  });
});

// These are syntax bounds, not a copy of Relay's owned vocabulary or authority.
test.each(['ab-river', 'rice-ab', 'rice-river-ab', 'a'.repeat(25) + '-river', 'rice/river', Array(16).fill('owl').join('-'), 'mountains-' + Array(14).fill('mountain').join('-')])('rejects malformed navigation %s without HTTP', async (words) => {
  const fetch = jest.fn(async () => new Response('{}'));
  const client = new ControlClient('https://control.example', { fetch });
  await expect(client.redeemInvitation(words, { joinCode: new SecretToken(code) })).rejects.toThrow();
  expect(() => parseRelayInvitationLocation(`https://receiver.example/${words}#join=${code}`)).toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test.each(['owl-sun', 'owl-sun-elm', 'rice-river', 'silly-mountain', 'lemon-corpus'])('accepts real service invitation response %s', async (words) => {
  const visibility = words.split('-').length === 2 ? 'public' : 'private';
  const fetch = jest.fn(async () => new Response(JSON.stringify({
    join_code: code, join_url: `https://receiver.example/join#join=${code}`,
    share_alias: words, share_url: `https://receiver.example/${words}#join=${code}`,
    visibility, expires_at: '2030-01-01T00:00:00Z',
  }), { status: 201 }));
  const client = new ControlClient('https://control.example', { fetch });
  const invitation = await client.createInvitation('session_123', new SecretToken('source-capability'), { visibility, busId: 'application' });
  expect(invitation.shareAlias).toBe(words);
  expect(JSON.stringify(invitation)).not.toContain(code);
});


test.each(Array.from({ length: 14 }, (_, index) => index + 2))('preserves returned %i-word metadata and request preference without inferring length from visibility', async (wordCount) => {
  const words = Array(wordCount).fill('mountain').join('-');
  const calls: RequestInit[] = [];
  const payload = { join_code: code, join_url: `https://receiver.example/join#join=${code}`,
    share_alias: words, share_url: `https://receiver.example/${words}#join=${code}`,
    word_count: wordCount, visibility: wordCount === 2 ? 'public' : 'private', expires_at: '2030-01-01T00:00:00Z' };
  const client = new ControlClient('https://service.example', { fetch: async (_url, init = {}) => {
    calls.push(init);
    return new Response(JSON.stringify(payload), { status: init.method === 'POST' ? 201 : 200 });
  } });
  const created = await client.createInvitation('session_123', new SecretToken('owner'), { busId: 'application', wordCount });
  expect(created.wordCount).toBe(wordCount);
  expect(created.shareAlias).toBe(words);
  expect((await client.inspectInvitation(words)).wordCount).toBe(wordCount);
  expect(JSON.parse(calls[0]!.body as string)).toEqual({ bus_id: 'application', word_count: wordCount });
  expect(JSON.stringify(created)).not.toContain(code);
});

test.each([null, true, '4', 1, 16, 2.5, NaN, Infinity])('invalid request wordCount %s is rejected before transport', async (wordCount) => {
  const fetch = jest.fn(async () => new Response('{}'));
  const client = new ControlClient('https://service.example', { fetch });
  await expect(client.createInvitation('session_123', new SecretToken('owner'), { busId: 'application', wordCount: wordCount as number })).rejects.toThrow('integer from 2 to 15');
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  { word_count: null }, { word_count: true }, { word_count: 'unknown-response-credential' },
  { word_count: 1 }, { word_count: 16 }, { word_count: 3.5 },
  { word_count: 4, visibility: 'public' }, { word_count: 5 },
  { share_alias: code, word_count: 5 },
])('rejects inconsistent or untrusted response word_count without propagating response bytes: %j', async (delta) => {
  const words = 'calm-moon-river-otter';
  const payload = { join_code: code, share_alias: words, word_count: 4, visibility: 'private', expires_at: '2030-01-01T00:00:00Z', ...delta };
  const client = new ControlClient('https://service.example', { fetch: async () => new Response(JSON.stringify(payload), { status: 201 }) });
  let failure: unknown;
  try { await client.createInvitation('session_123', new SecretToken('owner'), { busId: 'application' }); } catch (error) { failure = error; }
  expect(failure).toBeDefined();
  expect(inspect(failure) + JSON.stringify(failure)).not.toContain('unknown-response-credential');
});

test('legacy responses infer only two or three words and explicit length mismatches fail', async () => {
  for (const count of [2, 3, 4]) {
    const words = Array(count).fill('mountain').join('-');
    const payload = { join_code: code, share_alias: words, visibility: count === 2 ? 'public' : 'private', expires_at: '2030-01-01T00:00:00Z' };
    const client = new ControlClient('https://service.example', { fetch: async () => new Response(JSON.stringify(payload), { status: 201 }) });
    const operation = client.createInvitation('session_123', new SecretToken('owner'), { busId: 'application' });
    if (count <= 3) expect((await operation).wordCount).toBe(count);
    else await expect(operation).rejects.toThrow('word_count');
  }
  const client = new ControlClient('https://service.example', { fetch: async () => new Response(JSON.stringify({ join_code: code, share_alias: 'calm-moon-river-otter', visibility: 'private', word_count: 4, expires_at: '2030-01-01T00:00:00Z' }), { status: 201 }) });
  await expect(client.createInvitation('session_123', new SecretToken('owner'), { busId: 'application', wordCount: 5 })).rejects.toThrow('requested length');
});
