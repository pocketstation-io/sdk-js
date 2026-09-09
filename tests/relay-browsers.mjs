#!/usr/bin/env node

import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, firefox, webkit } from '@playwright/test';

const DEFAULT_PORT = 24_802;
const DEFAULT_TIMEOUT_MS = 30_000;

const arguments_ = parseArguments(process.argv.slice(2));
const packageRoot = await realpath(arguments_.packageRoot);
const distributionRoot = await realpath(join(packageRoot, 'dist'));
const manifest = JSON.parse(await readFile(arguments_.manifest, 'utf8'));
const output = [];

const server = createStaticServer(distributionRoot);
server.listen(arguments_.port, '127.0.0.1');
await once(server, 'listening');

try {
  for (const [name, browserType] of [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    const receiverAccess = manifest.browsers?.[name];
    if (typeof receiverAccess !== 'object' || receiverAccess === null) {
      throw new Error(`Receiver manifest is missing ${name}`);
    }
    const browser = await browserType.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(arguments_.timeoutMs);
      await page.goto(`http://127.0.0.1:${arguments_.port}`, {
        waitUntil: 'domcontentloaded',
      });
      const result = await page.evaluate(
        async ({ access, timeoutMs }) => {
          const { RelayReceiver } = await import('/pocketstation/browser/index.js');
          const states = {};
          const failures = [];
          const receivers = Object.entries(access).map(([bus, invitation]) => {
            states[bus] = [];
            return [
              bus,
              new RelayReceiver(invitation, {
                connectTimeoutMs: timeoutMs,
                disconnectTimeoutMs: 2_000,
                onStateChange: (state) => states[bus].push(state),
                onError: (error) => failures.push({ bus, message: String(error) }),
              }),
            ];
          });
          const streams = await Promise.all(
            receivers.map(async ([bus, receiver]) => [bus, await receiver.connect()]),
          );
          for (const [bus, stream] of streams) {
            const audio = document.createElement('audio');
            audio.dataset.bus = bus;
            audio.autoplay = true;
            audio.muted = true;
            audio.srcObject = stream;
            document.body.append(audio);
            await audio.play();
          }
          const deadline = Date.now() + timeoutMs;
          let observations = [];
          while (Date.now() < deadline) {
            observations = await Promise.all(
              receivers.map(async ([bus, receiver]) => [bus, await receiver.observe()]),
            );
            if (
              observations.every(
                ([, observation]) =>
                  observation.packetsReceived !== null &&
                  observation.packetsReceived > 0 &&
                  observation.trackState === 'live',
              )
            ) {
              break;
            }
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
          }
          const result = {
            userAgent: navigator.userAgent,
            failures,
            buses: Object.fromEntries(
              receivers.map(([bus, receiver], index) => [
                bus,
                {
                  state: receiver.state,
                  states: states[bus],
                  sessionState: receiver.sessionState,
                  observation: observations[index]?.[1] ?? null,
                  audioTracks: streams[index][1].getAudioTracks().length,
                },
              ]),
            ),
          };
          await Promise.all(receivers.map(([, receiver]) => receiver.disconnect()));
          return result;
        },
        { access: receiverAccess, timeoutMs: arguments_.timeoutMs },
      );
      assertBrowserResult(name, result);
      output.push({ browser: name, status: 'passed', ...result });
    } catch (cause) {
      output.push({ browser: name, status: 'failed', error: String(cause) });
      throw cause;
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
  await once(server, 'close');
  await writeFile(arguments_.output, `${JSON.stringify(output, null, 2)}\n`);
}

console.log(`Relay browser proof passed in Chromium, Firefox, and WebKit: ${arguments_.output}`);

function parseArguments(values) {
  const parsed = {
    packageRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    manifest: '',
    output: '',
    port: DEFAULT_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 0; index < values.length; index += 1) {
    switch (values[index]) {
      case '--package-root':
        parsed.packageRoot = resolve(requiredValue(values, ++index, '--package-root'));
        break;
      case '--manifest':
        parsed.manifest = resolve(requiredValue(values, ++index, '--manifest'));
        break;
      case '--output':
        parsed.output = resolve(requiredValue(values, ++index, '--output'));
        break;
      case '--port':
        parsed.port = positiveInteger(requiredValue(values, ++index, '--port'), '--port');
        break;
      case '--timeout-ms':
        parsed.timeoutMs = positiveInteger(
          requiredValue(values, ++index, '--timeout-ms'),
          '--timeout-ms',
        );
        break;
      default:
        throw new Error(`Unknown argument: ${values[index]}`);
    }
  }
  if (parsed.manifest.length === 0 || parsed.output.length === 0) {
    throw new Error('Use --manifest <file> and --output <file>');
  }
  if (parsed.port > 65_535 || parsed.timeoutMs > 120_000) {
    throw new Error('--port must be at most 65535 and --timeout-ms at most 120000');
  }
  return parsed;
}

function requiredValue(values, index, name) {
  const value = values[index];
  if (value === undefined || value.length === 0) throw new Error(`${name} requires a value`);
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function createStaticServer(root) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><meta charset="utf-8"><title>PocketStation Relay receiver</title>');
        return;
      }
      if (!url.pathname.startsWith('/pocketstation/')) {
        response.writeHead(404).end();
        return;
      }
      const requested = resolve(root, url.pathname.slice('/pocketstation/'.length));
      const contained = relative(root, requested);
      if (contained.startsWith(`..${sep}`) || contained === '..' || resolve(requested) === root) {
        response.writeHead(404).end();
        return;
      }
      const metadata = await stat(requested);
      if (!metadata.isFile()) throw new Error('not a file');
      const contentType = extname(requested) === '.js' ? 'text/javascript' : 'application/octet-stream';
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': metadata.size,
        'Content-Type': contentType,
      });
      response.end(await readFile(requested));
    } catch {
      response.writeHead(404).end();
    }
  });
}

function assertBrowserResult(name, result) {
  if (result.failures.length !== 0) {
    throw new Error(`${name} reported asynchronous Relay failures: ${JSON.stringify(result.failures)}`);
  }
  for (const bus of ['application', 'microphone']) {
    const value = result.buses[bus];
    if (
      value?.state !== 'connected' ||
      value.audioTracks !== 1 ||
      value.observation?.packetsReceived === null ||
      value.observation?.packetsReceived < 1 ||
      value.observation?.trackState !== 'live' ||
      value.observation?.acousticOutput !== 'unavailable'
    ) {
      throw new Error(`${name} did not receive live ${bus} audio: ${JSON.stringify(value)}`);
    }
  }
}
