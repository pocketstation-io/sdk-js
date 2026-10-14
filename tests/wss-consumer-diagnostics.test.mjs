import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createServer, connect } from 'node:tls';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

// Evaluate the exact consumer-owned fixture functions without importing any
// addon or executing the installed-consumer top level. Native Session is mocked.
const source = readFileSync(new URL('../tools/native-matrix-consumer.mjs', import.meta.url), 'utf8');
const prefixStart = source.indexOf('const proxyVariables = ');
const prefixEnd = source.indexOf('\nfunction textFrame(');
const fixtureStart = source.indexOf('\nfunction der(');
const fixtureEnd = source.indexOf('\nconst require = createRequire(');
assert.ok(prefixStart >= 0 && prefixEnd > prefixStart && fixtureStart > prefixEnd && fixtureEnd > fixtureStart);
const fixtureSource = source.slice(prefixStart, prefixEnd) + source.slice(fixtureStart, fixtureEnd);

function fixture(logs) {
  return runInNewContext(fixtureSource + '\n({ safeWssDiagnosticError, createWssDiagnostic, assertWssTlsStartupRefusal, assertWssClientClosure, exerciseInstalledWssTrustRefusal });', {
    assert, Buffer, Error, Set, WeakMap, Map, Date, performance, setTimeout, clearTimeout,
    createTlsServer: createServer, createHash, generateKeyPairSync, sign, once,
    process: { env: {}, stderr: { write: (line) => logs.push(line) } },
  });
}

function reports(logs) {
  return logs.map((line) => {
    assert.ok(line.startsWith('PKS_INSTALLED_WSS_DIAGNOSTIC '));
    return JSON.parse(line.slice('PKS_INSTALLED_WSS_DIAGNOSTIC '.length));
  });
}

test('diagnostics redact URL/token values and bound event retention without changing state', () => {
  const logs = [];
  const api = fixture(logs);
  const error = Object.assign(new Error('TLS failed https://user:secret-token@example.invalid/path?token=private bearer secret-token 12345'),
    { code: 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA' });
  const safe = api.safeWssDiagnosticError(error);
  assert.equal(safe.name, 'Error');
  assert.equal(safe.code, error.code);
  assert.ok(safe.message.length <= 320);
  assert.equal(/secret-token|example\.invalid|private|12345|https:/.test(JSON.stringify(safe)), false);
  const state = { connections: 1, secureConnections: 0, tlsRejections: 1, outstandingSockets: 0, serverListening: false };
  let elapsed = 0;
  const logger = api.createWssDiagnostic(() => elapsed, (line) => logs.push(line), () => state);
  for (let i = 0; i < 40; i += 1) {
    elapsed += 2;
    logger.observe('tcp-close', { socketId: 1, hadError: false });
  }
  logger.emit('consumer-error', error, Object.assign(new Error('private-token'), { code: 'secret-token', name: 'secret-token' }));
  const [report] = reports(logs);
  assert.equal(report.events.length, 32);
  assert.equal(report.droppedEvents, 8);
  assert.equal(report.events[0].sequence, 1);
  assert.equal(report.events[31].relativeMs, 64);
  assert.equal(report.refusal.name, '[redacted]');
  assert.equal(report.refusal.code, '[redacted]');
  assert.equal(JSON.stringify(report).includes('private-token'), false);
  assert.deepEqual(state, { connections: 1, secureConnections: 0, tlsRejections: 1, outstandingSockets: 0, serverListening: false });
});

test('owned TLS fixture retains actual rejection and close order with a mocked Session', { timeout: 10000 }, async () => {
  const logs = [];
  const api = fixture(logs);
  let client;
  class MockSession {
    audioInput() { return { output: { publish() {} } }; }
    relay(options) { this.options = options; return {}; }
    async start() {
      const url = new URL(this.options.url);
      client = connect({ host: url.hostname, port: Number(url.port), rejectUnauthorized: true });
      const closed = new Promise((resolve) => client.once('close', resolve));
      const failure = await new Promise((resolve, reject) => {
        client.once('error', resolve);
        client.once('secureConnect', () => reject(new Error('mock fixture unexpectedly trusted certificate')));
      });
      client.destroy();
      await closed;
      throw Object.assign(new Error('Relay TLS handshake failed', { cause: failure }),
        { name: 'SessionStartError', code: 'session.endpoint_prepare_failed' });
    }
  }
  try {
    const result = await api.exerciseInstalledWssTrustRefusal(MockSession);
    assert.equal(result.classification, 'LOOPBACK-ONLY');
    const [report] = reports(logs);
    assert.equal(report.event, 'cleanup-complete');
    assert.equal(report.connections, 1);
    assert.equal(report.secureConnections, 0);
    assert.ok(report.tlsRejections >= 1);
    assert.equal(report.outstandingSockets, 0);
    assert.equal(report.serverListening, false);
    const events = report.events.map((event) => event.event);
    assert.ok(events.includes('tls-client-error') && events.includes('tcp-close'));
    assert.ok(events.indexOf('tcp-connection') < events.indexOf('tcp-close'));
    assert.ok(events.indexOf('fixture-close-start') < events.indexOf('fixture-close-complete'));
    assert.ok(report.events.every((event, index, all) => index === 0 || event.relativeMs >= all[index - 1].relativeMs));
    assert.equal(result.positiveTrustedWss, false);
  } finally {
    client?.destroy();
  }
});

test('mock startup refusal without a TLS connection retains timeout FAIL and actual cleanup', { timeout: 10000 }, async () => {
  const logs = [];
  const api = fixture(logs);
  class MockSession {
    audioInput() { return { output: { publish() {} } }; }
    relay() { return {}; }
    async start() {
      throw Object.assign(new Error('Relay TLS handshake failed https://private.invalid/?token=secret-token'),
        { name: 'SessionStartError', code: 'session.endpoint_prepare_failed' });
    }
  }
  await assert.rejects(api.exerciseInstalledWssTrustRefusal(MockSession),
    { message: 'fixture TLS rejection/close observation deadline exceeded' });
  const output = reports(logs);
  assert.equal(output.length, 2);
  assert.equal(output[0].event, 'consumer-error');
  assert.equal(output[0].error.name, 'AssertionError');
  assert.equal(output[0].refusal.name, 'SessionStartError');
  assert.equal(output[0].refusal.code, 'session.endpoint_prepare_failed');
  assert.equal(output[0].connections, 0);
  assert.equal(output[0].tlsRejections, 0);
  assert.equal(output[1].event, 'cleanup-complete');
  assert.equal(output[1].serverListening, false);
  assert.equal(output[1].outstandingSockets, 0);
  assert.ok(output[1].events.some((event) => event.event === 'fixture-close-complete'));
  assert.equal(/private\.invalid|secret-token/.test(logs.join('')), false);
});

function typedTlsRefusal() {
  return Object.assign(new Error('Relay TLS handshake failed'),
    { name: 'SessionStartError', code: 'session.endpoint_prepare_failed' });
}

test('portable closure predicate accepts the observed Windows event shape without requiring a server alert', () => {
  const api = fixture([]);
  api.assertWssTlsStartupRefusal(typedTlsRefusal());
  api.assertWssClientClosure({ connections: 1, secureConnections: 1, tlsRejections: 0,
    tcpCloses: 1, outstandingSockets: 0, tlsApplicationBytes: 0, forcedClosures: 0 });
});

test('refusal predicate rejects success, unrelated errors, wrong phase and non-TLS refusal', () => {
  const api = fixture([]);
  for (const refusal of [undefined, new Error('Relay TLS handshake failed'),
    Object.assign(typedTlsRefusal(), { code: 'session.endpoint_start_failed' }),
    Object.assign(typedTlsRefusal(), { message: 'WebSocket connection timed out' })]) {
    assert.throws(() => api.assertWssTlsStartupRefusal(refusal));
  }
});

test('closure predicate rejects application traffic, missing close, extra connections and timeout-caused close', () => {
  const api = fixture([]);
  const closed = { connections: 1, tcpCloses: 1, outstandingSockets: 0, tlsApplicationBytes: 0, forcedClosures: 0 };
  for (const changed of [{ tlsApplicationBytes: 1 }, { connections: 0 }, { connections: 2 },
    { tcpCloses: 0 }, { outstandingSockets: 1 }, { forcedClosures: 1 }]) {
    assert.throws(() => api.assertWssClientClosure({ ...closed, ...changed }));
  }
});

test('accepted untrusted startup remains FAIL with an owned real TLS connection', { timeout: 10000 }, async () => {
  const logs = [];
  const api = fixture(logs);
  let client;
  class AcceptingSession {
    audioInput() { return { output: { publish() {} } }; }
    relay(options) { this.options = options; return {}; }
    async start() {
      const url = new URL(this.options.url);
      // Deliberately broken MOCKED client, confined to this negative test.
      // The consumer/SDK trust settings and system trust store are unchanged.
      client = connect({ host: url.hostname, port: Number(url.port), rejectUnauthorized: false });
      client.on('error', () => {});
      await once(client, 'secureConnect');
      return { stop: async () => { client.destroy(); } };
    }
  }
  try {
    await assert.rejects(api.exerciseInstalledWssTrustRefusal(AcceptingSession),
      { message: 'ordinary addon accepted an untrusted WSS certificate' });
    const output = reports(logs);
    assert.equal(output[0].event, 'consumer-error');
    assert.equal(output.at(-1).event, 'cleanup-complete');
    const events = output.at(-1).events.map((event) => event.event);
    assert.ok(events.indexOf('tcp-close') >= 0);
    assert.ok(events.indexOf('tcp-close') < events.indexOf('fixture-close-complete'));
    assert.equal(output.at(-1).outstandingSockets, 0);
    assert.equal(output.at(-1).serverListening, false);
  } finally { client?.destroy(); }
});

test('untrusted HTTP upgrade bytes cannot pass despite a spoofed typed TLS error and client closure', { timeout: 10000 }, async () => {
  const logs = [];
  const api = fixture(logs);
  let client;
  class SendingSession {
    audioInput() { return { output: { publish() {} } }; }
    relay(options) { this.options = options; return {}; }
    async start() {
      const url = new URL(this.options.url);
      client = connect({ host: url.hostname, port: Number(url.port), rejectUnauthorized: false });
      client.on('error', () => {});
      await once(client, 'secureConnect');
      const closed = once(client, 'close');
      client.end('GET / HTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      await closed;
      throw typedTlsRefusal();
    }
  }
  try {
    await assert.rejects(api.exerciseInstalledWssTrustRefusal(SendingSession),
      { name: 'AssertionError', code: 'ERR_ASSERTION',
        message: /^untrusted TLS client sent application bytes(?:\n|$)/ });
    const output = reports(logs);
    assert.ok(output[0].tlsApplicationBytes > 0);
    assert.equal(output[0].forcedClosures, 0);
    assert.equal(output.at(-1).outstandingSockets, 0);
    assert.equal(output.at(-1).serverListening, false);
  } finally { client?.destroy(); }
});
