#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.log(
    'usage: browser-publisher.mjs --relay-url URL --session-id ID --bus-id ID ' +
      '--source-token TOKEN --output PATH [--duration-ms N] [--ice-servers-json JSON]',
  );
}

function parseArguments(values) {
  const options = { durationMs: 2_500, iceServers: [] };
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    const value = values[index + 1];
    if (value === undefined) throw new Error(`missing value for ${argument}`);
    switch (argument) {
      case '--relay-url':
        options.relayUrl = value;
        break;
      case '--session-id':
        options.sessionId = value;
        break;
      case '--bus-id':
        options.busId = value;
        break;
      case '--source-token':
        options.sourceToken = value;
        break;
      case '--output':
        options.output = resolve(value);
        break;
      case '--duration-ms':
        options.durationMs = Number(value);
        break;
      case '--ice-servers-json':
        options.iceServers = JSON.parse(value);
        break;
      default:
        throw new Error(`unknown argument: ${argument}`);
    }
    index += 1;
  }
  for (const name of ['relayUrl', 'sessionId', 'busId', 'sourceToken', 'output']) {
    if (typeof options[name] !== 'string' || options[name].length === 0) {
      throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
    }
  }
  if (!Number.isSafeInteger(options.durationMs) || options.durationMs < 500) {
    throw new Error('--duration-ms must be an integer of at least 500');
  }
  if (!Array.isArray(options.iceServers)) {
    throw new Error('--ice-servers-json must decode to an array');
  }
  return options;
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const requested = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (requested === '/') {
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end('<!doctype html><meta charset="utf-8"><title>PKS publisher proof</title>');
        return;
      }
      const candidate = normalize(join(sdkRoot, requested));
      if (!candidate.startsWith(join(sdkRoot, 'dist') + '/') || relative(sdkRoot, candidate).startsWith('..')) {
        response.writeHead(404).end();
        return;
      }
      const info = await stat(candidate);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': extname(candidate) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      createReadStream(candidate).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('static server did not expose a TCP port');
  }
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server) {
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
  });
}

async function run(options) {
  const { server, origin } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(async (configuration) => {
      const { RelayPublisher } = await import('/dist/browser/index.js');
      const audioContext = new AudioContext({ sampleRate: 48_000 });
      const oscillator = new OscillatorNode(audioContext, {
        frequency: 997,
        type: 'sine',
      });
      const gain = new GainNode(audioContext, { gain: 0.2 });
      const destination = new MediaStreamAudioDestinationNode(audioContext, {
        channelCount: 1,
      });
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      const states = [];
      const publisher = new RelayPublisher(
        {
          signalUrl: configuration.relayUrl,
          sessionId: configuration.sessionId,
          busId: configuration.busId,
          sourceToken: configuration.sourceToken,
          iceServers: configuration.iceServers,
        },
        {
          connectTimeoutMs: 15_000,
          disconnectTimeoutMs: 2_000,
          onStateChange: (state) => states.push(state),
        },
      );
      let observation = null;
      let failure = null;
      let stateBeforeDisconnect;
      let callerTrackStateAfterPublisherDisconnect;
      try {
        await publisher.publish(destination.stream);
        await new Promise((resolvePromise) => {
          window.setTimeout(resolvePromise, configuration.durationMs);
        });
        observation = await publisher.observe();
      } catch (error) {
        failure = {
          code:
            typeof error === 'object' && error !== null && 'code' in error
              ? String(error.code)
              : null,
          type: error?.constructor?.name ?? typeof error,
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        stateBeforeDisconnect = publisher.state;
        await publisher.disconnect();
        await publisher.disconnect();
        callerTrackStateAfterPublisherDisconnect =
          destination.stream.getAudioTracks()[0]?.readyState ?? null;
        oscillator.stop();
        await audioContext.close();
      }
      for (const track of destination.stream.getTracks()) track.stop();
      return {
        status: 'LOOPBACK-ONLY',
        succeeded: failure === null,
        source: {
          kind: 'browser-owned-media-stream',
          oscillatorHz: 997,
          requestedSampleRateHz: 48_000,
        },
        states,
        observation,
        failure,
        stateBeforeDisconnect,
        callerTrackStateAfterPublisherDisconnect,
        publisherState: publisher.state,
      };
    }, options);
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, {
      flag: 'wx',
    });
  } catch (error) {
    const failure = {
      status: 'LOOPBACK-ONLY',
      errorType: error?.constructor?.name ?? typeof error,
      error: error instanceof Error ? error.message : String(error),
    };
    await writeFile(options.output, `${JSON.stringify(failure, null, 2)}\n`, {
      flag: 'wx',
    }).catch(() => {});
    throw error;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    await closeServer(server).catch(() => {});
  }
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exitCode = 2;
}

if (options?.help === true) {
  usage();
} else if (options !== undefined) {
  await run(options);
}
