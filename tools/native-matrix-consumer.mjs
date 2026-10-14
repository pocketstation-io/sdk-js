import assert from 'node:assert/strict';
import { exerciseAecBuild } from './aec-consumer.mjs';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { once } from 'node:events';

const proxyVariables = ['https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY', 'no_proxy', 'NO_PROXY'];

async function withProxyEnvironment(proxy, body) {
  const before = new Map(proxyVariables.map((key) => [key, process.env[key]]));
  for (const key of proxyVariables) delete process.env[key];
  process.env.https_proxy = proxy;
  process.env.HTTPS_PROXY = proxy;
  process.env.no_proxy = '';
  process.env.NO_PROXY = '';
  try {
    return await body();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function closeServer(server, sockets) {
  const closed = new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  for (const socket of sockets) socket.destroy();
  await closed;
}

function textFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  assert.ok(payload.length < 126);
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

function readHeader(buffer) {
  const end = buffer.indexOf('\r\n\r\n');
  assert.ok(end >= 0 || buffer.length <= 8192, 'fixture HTTP headers exceeded their bound');
  if (end < 0) return undefined;
  assert.ok(end <= 8192);
  const lines = buffer.subarray(0, end).toString('ascii').split('\r\n');
  const headers = new Map();
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    assert.ok(colon > 0);
    const name = line.slice(0, colon).toLowerCase();
    assert.equal(headers.has(name), false, 'duplicate fixture request header');
    headers.set(name, line.slice(colon + 1).trim());
  }
  return { first: lines[0], headers, remainder: buffer.subarray(end + 4) };
}

function readFrame(buffer) {
  if (buffer.length < 2) return undefined;
  assert.equal(buffer[0] & 0xf0, 0x80, 'fixture requires finite unfragmented WebSocket frames');
  assert.equal(buffer[1] & 0x80, 0x80, 'client WebSocket frames must be masked');
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  }
  assert.ok(length <= 2048, 'fixture WebSocket payload exceeded its bound');
  if (buffer.length < offset + 4 + length) return undefined;
  const mask = buffer.subarray(offset, offset + 4);
  const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
  for (let index = 0; index < length; index += 1) payload[index] ^= mask[index % 4];
  return { opcode: buffer[0] & 0x0f, payload, remainder: buffer.subarray(offset + 4 + length) };
}

function inspectPacket(packet, expected, previous) {
  assert.ok(packet.length > 40 && packet.length <= 1315);
  assert.deepEqual(packet.subarray(0, 8), Buffer.from([0x50, 0x4b, 0x53, 0x4f, 1, 1, 0, 0]));
  const sequence = packet.readBigUInt64BE(8);
  assert.equal(packet.readUInt32BE(16), Number((sequence * 960n) & 0xffffffffn));
  assert.equal(packet.readUInt16BE(20), 960);
  assert.equal(packet.readUInt16BE(22), packet.length - 40);
  assert.ok(packet.readBigUInt64BE(24) > 0n);
  assert.equal(packet.readBigUInt64BE(32), expected.generation);
  if (previous !== undefined) assert.ok(sequence > previous);
  return sequence;
}

async function exerciseInstalledRelayConnect(Session) {
  const sockets = new Set();
  const streams = new Map();
  const expected = new Map();
  let failure;
  let connections = 0;
  let fixturePhase = 'listen';
  let pcmWrites = 0;
  let pcmReads = 0;
  let stopObserved = false;
  const connectionObservations = [];
  const diagnostic = (event, error) => {
    process.stderr.write('PKS_INSTALLED_RELAY_DIAGNOSTIC ' + JSON.stringify({
      event, errorName: String(error?.name ?? '').slice(0, 64),
      errorCode: String(error?.code ?? '').slice(0, 64), fixturePhase,
      connections, pcmWrites, pcmReads, stopObserved,
      streams: [...streams.values()].map((stream) => ({ bus: stream.bus, packetCount: stream.count })),
      socketObservations: connectionObservations,
    }) + '\n');
  };
  const fail = (error) => {
    const firstError = failure === undefined;
    failure ??= error;
    if (firstError) diagnostic('first-server-error', error);
    for (const socket of sockets) socket.destroy();
  };
  const server = createTcpServer((socket) => {
    const observation = { connection: connections + 1, phase: 'connect', closeFrames: 0,
      stopResetCount: 0, closed: false, ended: false };
    if (connectionObservations.length < 3) connectionObservations.push(observation);
    sockets.add(socket);
    socket.on('end', () => { observation.ended = true; });
    socket.on('close', () => { observation.closed = true; sockets.delete(socket); });
    socket.on('error', (error) => {
      if (error.code === 'ECONNRESET' && ['stop', 'outcomes'].includes(fixturePhase)
          && observation.closeFrames === 1 && observation.stopResetCount === 0
          && pcmWrites === 16 && pcmReads === 16 && streams.size === 2
          && [...streams.values()].every((value) => value.count >= 8)
          && failure === undefined) {
        observation.stopResetCount += 1;
        return;
      }
      fail(error);
    });
    socket.setTimeout(2000, () => fail(new Error('fixture socket deadline exceeded')));
    connections += 1;
    if (connections > 2) return fail(new Error('fixture received an unexpected connection'));
    let phase = 'connect';
    let buffer = Buffer.alloc(0);
    let stream;
    socket.on('data', (chunk) => {
      try {
        assert.ok(buffer.length + chunk.length <= 65536);
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length > 0) {
          if (phase !== 'frames') {
            const request = readHeader(buffer);
            if (request === undefined) break;
            buffer = request.remainder;
            if (phase === 'connect') {
              assert.equal(request.first, 'CONNECT 127.0.0.1:80 HTTP/1.1');
              assert.equal(request.headers.get('proxy-authorization'), 'Basic Zml4dHVyZTpwcm94eQ==');
              assert.equal(request.headers.has('authorization'), false);
              socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
              phase = 'upgrade';
              observation.phase = phase;
              continue;
            }
            const [method, path, http] = request.first.split(' ');
            assert.equal(method, 'GET');
            assert.equal(http, 'HTTP/1.1');
            const url = new URL(path, 'http://127.0.0.1');
            assert.equal(url.pathname, '/v1/sessions/installed-session/audio');
            assert.equal([...url.searchParams].length, 1);
            const bus = url.searchParams.get('bus');
            assert.ok(expected.has(bus) && !streams.has(bus));
            assert.equal(request.headers.get('authorization'), 'Bearer fixture-source');
            assert.equal(request.headers.has('proxy-authorization'), false);
            assert.equal(request.headers.get('sec-websocket-protocol'), 'pks-opus-v1');
            const accept = createHash('sha1').update(
              request.headers.get('sec-websocket-key') + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
            ).digest('base64');
            socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
              + `Sec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: pks-opus-v1\r\n\r\n`);
            socket.write(textFrame({ type: 'READY', bus_id: bus, source_generation: 1 }));
            stream = { bus, count: 0, payloadBytes: 0, sequences: [], payloadHashes: [] };
            streams.set(bus, stream);
            phase = 'frames';
            observation.phase = phase;
            continue;
          }
          const frame = readFrame(buffer);
          if (frame === undefined) break;
          buffer = frame.remainder;
          if (frame.opcode === 8) {
            observation.closeFrames += 1;
            socket.end(Buffer.from([0x88, 0]));
            break;
          }
          assert.equal(frame.opcode, 2);
          assert.ok(stream.count < 64);
          const sequence = inspectPacket(frame.payload, expected.get(stream.bus), stream.sequences.at(-1));
          stream.count += 1;
          stream.payloadBytes += frame.payload.length - 40;
          stream.sequences.push(sequence);
          stream.payloadHashes.push(createHash('sha256').update(frame.payload.subarray(40)).digest('hex'));
        }
      } catch (error) {
        fail(error);
      }
    });
  });
  server.on('error', fail);
  const port = await listen(server);
  const deadline = Date.now() + 10000;
  const timer = setTimeout(() => fail(new Error('installed Relay fixture deadline exceeded')), 10000);
  let running;
  let stop;
  try {
    return await withProxyEnvironment(`http://fixture:proxy@127.0.0.1:${port}`, async () => {
      const session = new Session({ frameDurationMs: 20 });
      const publisher = session.relay({ url: 'http://127.0.0.1', sessionId: 'installed-session',
        sourceToken: 'fixture-source', transport: 'websocket', startupTimeoutMs: 2000 });
      const reader = session.audio();
      const sources = ['application', 'microphone'].map((bus, index) => {
        const input = session.audioInput(`installed ${bus}`);
        const generation = input.beginOutput();
        const route = input.output.publish(publisher, bus);
        input.output.send(reader);
        expected.set(bus, { sourceId: input.sourceId, streamId: input.streamId,
          generation: generation.id, routeId: route.routeId });
        return { bus, index, input, generation };
      });
      assert.notEqual(sources[0].input.sourceId, sources[1].input.sourceId);
      fixturePhase = 'startup';
      running = await session.start();
      fixturePhase = 'pcm';
      for (let count = 0; count < 8; count += 1) {
        for (const source of sources) {
          const samples = Float32Array.from({ length: 960 }, (_, index) =>
            0.2 * Math.sin(2 * Math.PI * (source.index ? 770 : 440) * (count * 960 + index) / 48000));
          await source.input.write(samples, { output: source.generation });
          pcmWrites += 1;
        }
        const received = new Set();
        for (let index = 0; index < 2; index += 1) {
          const frame = await running.audio.read({ timeoutMs: 1000 });
          pcmReads += 1;
          const source = sources.find((value) => value.input.sourceId === frame?.sourceId);
          assert.ok(source);
          assert.equal(received.has(source.bus), false);
          assert.equal(frame.streamId, source.input.streamId);
          assert.equal(frame.outputGenerationId, source.generation.id);
          assert.equal(frame.samples.length, 960);
          assert.ok(frame.samples.every(Number.isFinite));
          received.add(source.bus);
        }
        assert.equal(received.size, 2);
        if (failure) throw failure;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      fixturePhase = 'packets';
      while ([...expected.keys()].some((bus) => (streams.get(bus)?.count ?? 0) < 8)) {
        if (failure) throw failure;
        assert.ok(Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      fixturePhase = 'stop';
      stop = await running.stop();
      stopObserved = true;
      fixturePhase = 'outcomes';
      running = undefined;
      assert.equal(stop.success, true);
      assert.equal(stop.relayOutcomes.length, 2);
      for (const outcome of stop.relayOutcomes) {
        const selected = expected.get(outcome.busId);
        assert.ok(selected);
        assert.equal(outcome.routeId, selected.routeId);
        assert.equal(outcome.failuresTotal, 0n);
        assert.ok(outcome.framesReceivedTotal >= 8n);
      }
      const closeDeadline = Math.min(deadline, Date.now() + 1000);
      while (sockets.size !== 0) {
        if (failure) throw failure;
        assert.ok(Date.now() < closeDeadline, 'fixture completed-stop socket close deadline exceeded');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (failure) throw failure;
      assert.equal(connections, 2);
      assert.equal(connectionObservations.length, 2);
      assert.ok(connectionObservations.every((value) => value.closeFrames === 1 && value.closed));
      fixturePhase = 'complete';
      return { classification: 'LOOPBACK-ONLY', domainAuthorization: 'MOCKED',
        connectProxy: true, namedBuses: [...expected.keys()], pcmFramesPerBus: 8,
        actualOpusPackets: true, decodedAudio: false,
        completedStopSocketObservations: connectionObservations,
        buses: [...streams.values()].map((stream) => ({ bus: stream.bus,
          sourceId: String(expected.get(stream.bus).sourceId),
          streamId: String(expected.get(stream.bus).streamId),
          routeId: String(expected.get(stream.bus).routeId),
          outputGenerationId: String(expected.get(stream.bus).generation),
          packetCount: stream.count, payloadBytes: stream.payloadBytes,
          sequences: stream.sequences.map(String), payloadSha256: stream.payloadHashes })) };
    });
  } catch (error) {
    diagnostic('consumer-error', error);
    throw error;
  } finally {
    try {
      if (running !== undefined) await running.stop();
    } finally {
      clearTimeout(timer);
      await closeServer(server, sockets);
    }
  }
}

function der(tag, ...parts) {
  const body = Buffer.concat(parts);
  const size = body.length;
  const length = size < 128 ? Buffer.from([size]) : (() => {
    const hex = size.toString(16).padStart(Math.ceil(size.toString(16).length / 2) * 2, '0');
    const bytes = Buffer.from(hex, 'hex');
    return Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]);
  })();
  return Buffer.concat([Buffer.from([tag]), length, body]);
}

function untrustedFixtureCertificate() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const algorithm = Buffer.from('300d06092a864886f70d01010b0500', 'hex');
  const name = der(0x30, der(0x31, der(0x30, Buffer.from('0603550403', 'hex'),
    der(0x0c, Buffer.from('localhost')))));
  const san = der(0xa3, der(0x30, der(0x30, Buffer.from('0603551d11', 'hex'),
    der(0x04, der(0x30, der(0x87, Buffer.from([127, 0, 0, 1])))))));
  const tbs = der(0x30, der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, Buffer.from([1])),
    algorithm, name, der(0x30, der(0x17, Buffer.from('260101000000Z')),
      der(0x17, Buffer.from('350101000000Z'))), name,
    publicKey.export({ type: 'spki', format: 'der' }), san);
  const encoded = der(0x30, tbs, algorithm, der(0x03, Buffer.from([0]), sign('RSA-SHA256', tbs, privateKey)));
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: '-----BEGIN CERTIFICATE-----\n' + encoded.toString('base64').match(/.{1,64}/g).join('\n')
      + '\n-----END CERTIFICATE-----\n' };
}

// Only known diagnostic words/codes survive. URLs, credentials, unknown values
// and numbers from error messages are redacted rather than retained as evidence.
function safeWssDiagnosticError(error) {
  const names = new Set(['Error', 'TypeError', 'RangeError', 'AssertionError',
    'PocketStationError', 'SessionError', 'SessionStartError']);
  const codes = new Set(['GenericFailure', 'ERR_ASSERTION', 'ECONNRESET', 'ECONNREFUSED',
    'ETIMEDOUT', 'EPIPE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED',
    'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA', 'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE',
    'ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN', 'ERR_SSL_CERTIFICATE_VERIFY_FAILED',
    'session.host_setup_failed', 'session.unsupported_platform', 'session.compile_failed',
    'session.runtime_prepare_failed', 'session.endpoint_prepare_failed',
    'session.endpoint_start_failed', 'session.runtime_start_failed', 'session.internal']);
  const words = new Set(('fixture tls rejection close observation deadline exceeded '
    + 'ordinary addon accepted an untrusted wss certificate session startup start failed '
    + 'relay transport websocket connection connect reset refused timeout timed out '
    + 'self signed in chain unable to verify leaf signature issuer locally expired '
    + 'invalid peer unknown ca alert handshake eof error the a of for was is not '
    + 'runtime endpoint prepare preparation').split(' '));
  const name = String(error?.name ?? '').slice(0, 64);
  const code = String(error?.code ?? '').slice(0, 64);
  const message = String(error?.message ?? '').slice(0, 4096)
    .replace(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi, '[redacted]')
    .replace(/[A-Za-z0-9_.@/%+~=-]+/g, (word) => words.has(word.toLowerCase()) ? word : '[redacted]')
    .replace(/[^A-Za-z\s\[\]:,;.!?()'-]/g, '[redacted]')
    .slice(0, 320);
  return { name: names.has(name) ? name : '[redacted]',
    code: codes.has(code) ? code : (code === '' ? '' : '[redacted]'), message };
}

function createWssDiagnostic(now, write, state) {
  const started = now();
  const events = [];
  let droppedEvents = 0;
  let sequence = 0;
  return {
    observe(event, fields = {}) {
      sequence += 1;
      if (events.length < 32) events.push({ sequence, relativeMs: Math.max(0, Math.round(now() - started)),
        event, ...fields });
      else droppedEvents += 1;
    },
    emit(event, error, refusal) {
      write('PKS_INSTALLED_WSS_DIAGNOSTIC ' + JSON.stringify({ event,
        relativeMs: Math.max(0, Math.round(now() - started)), ...state(),
        error: safeWssDiagnosticError(error), refusal: safeWssDiagnosticError(refusal),
        events, droppedEvents }) + '\n');
    },
  };
}

async function exerciseInstalledWssTrustRefusal(Session) {
  const sockets = new Set();
  const socketIds = new WeakMap();
  let connections = 0;
  let secureConnections = 0;
  let tlsRejections = 0;
  let refusal;
  const diagnostic = createWssDiagnostic(() => performance.now(),
    (line) => process.stderr.write(line),
    () => ({ connections, secureConnections, tlsRejections, outstandingSockets: sockets.size,
      serverListening: server.listening }));
  const server = createTlsServer(untrustedFixtureCertificate(), (socket) => {
    secureConnections += 1;
    diagnostic.observe('secure-connection', { socketId: socketIds.get(socket) ?? null });
    socket.destroy();
  });
  server.on('connection', (socket) => {
    connections += 1;
    socketIds.set(socket, connections);
    sockets.add(socket);
    diagnostic.observe('tcp-connection', { socketId: connections });
    socket.on('end', () => diagnostic.observe('tcp-end', { socketId: socketIds.get(socket) }));
    socket.on('close', (hadError) => {
      sockets.delete(socket);
      diagnostic.observe('tcp-close', { socketId: socketIds.get(socket), hadError,
        outstandingSockets: sockets.size });
    });
    socket.on('error', (error) => diagnostic.observe('tcp-error',
      { socketId: socketIds.get(socket), error: safeWssDiagnosticError(error) }));
    socket.setTimeout(2000, () => {
      diagnostic.observe('tcp-inactivity-timeout', { socketId: socketIds.get(socket) });
      socket.destroy();
    });
  });
  server.on('tlsClientError', (error, socket) => {
    tlsRejections += 1;
    // Node's TLS socket need not be the raw TCP object. A missing correlation
    // stays null; the fixture never invents an identity from event order.
    diagnostic.observe('tls-client-error', { socketId: socketIds.get(socket) ?? null,
      error: safeWssDiagnosticError(error) });
  });
  const port = await listen(server);
  diagnostic.observe('listen-ready');
  const timer = setTimeout(() => {
    diagnostic.observe('fixture-hard-timeout', { outstandingSockets: sockets.size });
    for (const socket of sockets) socket.destroy();
  }, 5000);
  let running;
  try {
    return await withProxyEnvironment('', async () => {
      const session = new Session({ frameDurationMs: 20 });
      const input = session.audioInput('installed untrusted WSS');
      input.output.publish(session.relay({ url: `https://127.0.0.1:${port}`,
        sessionId: 'installed-session', sourceToken: 'fixture-source',
        transport: 'websocket', startupTimeoutMs: 2000 }), 'certificate-refusal');
      diagnostic.observe('session-start');
      try { running = await session.start(); } catch (error) {
        refusal = error;
        diagnostic.observe('startup-refusal', { error: safeWssDiagnosticError(error) });
      }
      assert.ok(refusal instanceof Error, 'ordinary addon accepted an untrusted WSS certificate');
      const observationDeadline = Date.now() + 1000;
      diagnostic.observe('observation-start');
      while (tlsRejections < 1 || sockets.size !== 0) {
        assert.ok(Date.now() < observationDeadline, 'fixture TLS rejection/close observation deadline exceeded');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(secureConnections, 0);
      assert.equal(connections, 1);
      assert.ok(tlsRejections >= 1);
      diagnostic.observe('observation-complete');
      return { classification: 'LOOPBACK-ONLY', untrustedCertificateRejected: true,
        positiveTrustedWss: false, systemTrustModified: false, privateCaInjection: false };
    });
  } catch (error) {
    diagnostic.emit('consumer-error', error, refusal);
    throw error;
  } finally {
    try {
      if (running !== undefined) {
        diagnostic.observe('running-stop-start');
        await running.stop();
        diagnostic.observe('running-stop-complete');
      }
    } catch (error) {
      diagnostic.emit('running-stop-error', error, refusal);
      throw error;
    } finally {
      clearTimeout(timer);
      diagnostic.observe('fixture-close-start', { outstandingSockets: sockets.size });
      try {
        await closeServer(server, sockets);
        diagnostic.observe('fixture-close-complete', { outstandingSockets: sockets.size });
        diagnostic.emit('cleanup-complete', undefined, refusal);
      } catch (error) {
        diagnostic.emit('fixture-close-error', error, refusal);
        throw error;
      }
    }
  }
}


const require = createRequire(import.meta.url);
const [target, expectedBinaryHash, expectedVersion, expectedCore] = process.argv.slice(2);
const names = ['pocketstation', ...['node', 'browser', 'control', 'demo', 'voice']
  .map((name) => `pocketstation/${name}`)];
for (const name of names) {
  const esm = await import(name);
  const cjs = require(name);
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
  for (const key of Object.keys(esm)) assert.equal(esm[key], cjs[key], `${name}.${key}`);
  assert.ok(realpathSync(require.resolve(name))
    .startsWith(realpathSync(resolve('node_modules/pocketstation')) + sep));
}
const nativePath = require.resolve(`@pocketstation/native-${target}`);
assert.ok(realpathSync(nativePath).startsWith(realpathSync(resolve('node_modules')) + sep));
const nativeSha256 = createHash('sha256').update(readFileSync(nativePath)).digest('hex');
assert.equal(nativeSha256, expectedBinaryHash);
const { Session, PlaybackReference, aecAvailable, runtimeCompatibility, OutputCancelledError, relayWebsocketAvailable } = require('pocketstation/node');
assert.equal(runtimeCompatibility.sdkVersion, expectedVersion);
assert.equal(runtimeCompatibility.coreVersion, expectedCore);
assert.equal(runtimeCompatibility.nativeAbi, 'napi8');
assert.equal(relayWebsocketAvailable(), true);
assert.throws(() => new Session().relay({ url: 'https://relay.example',
  sessionId: 'installed-session', sourceToken: 'fixture-source',
  transport: 'invalid' }), { code: 'relay.invalid_transport' });
const session = new Session({ frameDurationMs: 10 });
const input = session.audioInput('installed target PCM');
input.output.send(session.audio());
const abandoned = input.beginOutput();
const output = input.beginOutput();
assert.equal(abandoned.active, false);
assert.throws(() => input.tryWrite(new Float32Array(480), { output: abandoned }), OutputCancelledError);
const running = await session.start();
let frame;
try {
  await input.write(new Float32Array(480).fill(0.25), { output });
  frame = await running.audio.read({ timeoutMs: 1000 });
  assert.equal(frame.samples.length, 480);
  assert.ok(frame.samples.every((value) => value === 0.25));
  assert.equal(frame.sourceId, input.sourceId);
  assert.equal(frame.streamId, input.streamId);
  assert.equal(frame.outputGenerationId, output.id);
} finally {
  assert.equal((await running.stop()).success, true);
}
const header = process.report.getReport().header;
const aec = await exerciseAecBuild(Session, PlaybackReference, aecAvailable);
const relayTransport = await exerciseInstalledRelayConnect(Session);
const wssTrust = await exerciseInstalledWssTrustRefusal(Session);
console.log(JSON.stringify({
  passed: true, target, platform: process.platform, arch: process.arch,
  node: process.versions.node, napi: process.versions.napi,
  glibc: header.glibcVersionRuntime ?? null,
  nativeSha256, sdkVersion: expectedVersion, coreVersion: expectedCore,
  exports: names, samples: frame.samples.length, frames: 1,
  sourceIdentity: true, outputCancellation: true, stopSuccess: true,
  aec, relayWebsocketAvailable: true, relayTransport, wssTrust,
}));
