import { inspect } from 'node:util';
import { jest } from '@jest/globals';
import { ControlClient, InvitationUnavailableError, SecretToken } from '../control/index.js';
import { parseRelayInvitationLocation, resolveRelayInvitation } from '../browser/relay-session.js';

const code = '4a54c6b9-fdc2-4e0c-a740-715efdcf03de';
const other = '00000000-0000-4000-8000-000000000000';
const access = { session_id: 'session_123', bus_id: 'application', subscriber_token: 'subscriber-capability', signal_url: 'wss://relay.example/v1/signal', whep_url: 'https://relay.example/v1/sessions/session_123/whep', ice_servers: [] };

describe('readable navigation has no independent authority', () => {
  test.each(['quiet-willow', 'quiet-willow-river'])('%s requires original code in control and browser clients', async (words) => {
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
