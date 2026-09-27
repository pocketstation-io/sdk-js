#!/usr/bin/env node

import { constants as fileConstants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { delimiter, extname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
  Transcript,
  WhisperTranscriber,
  WhisperTranscriberConfiguration,
} from 'pocketstation/demo';
import { Capture, RelaySession } from 'pocketstation/node';

const DEFAULT_CONTROL_PLANE_URL = 'https://pocketstation-api.fly.dev';
const DEFAULT_RELAY_URL = 'https://pocketstation-relay.fly.dev';
const DEFAULT_FRAME_LIMIT = 1_000;

const HELP = `Usage: pocketstation-demo [application] --model <path> [options]

Capture one desktop application and an optional microphone as independent Stems,
then transcribe both through a local whisper.cpp executable.

Options:
  --model <path>         local whisper.cpp model (or PKS_WHISPER_MODEL)
  --whisper-cli <path>   whisper.cpp executable (default: PKS_WHISPER_CLI or whisper-cli)
  --no-gpu               use the CPU model backend (default)
  --gpu                  explicitly enable the local GPU backend
  --cpu-threads <count>  total model CPU thread budget (default: 4)
  --inference-concurrency <count>  source-affine model workers (default: 1; maximum: 8)
  --initial-prompt <text> optional application vocabulary/context (maximum: 2048 UTF-8 bytes)
  --audio-context-seconds <seconds> whisper-cli encoder context (5–30; default: backend full context)
  --microphone           capture and transcribe the default microphone
  --record-to <path>     write independent application and microphone WAV Stems
  --relay                publish each Stem to a named Relay AudioBus
  --show-links           print credential-bearing receiver links (keep output private)
  --show-private-links   deprecated alias of --show-links
  --frames <count>       stop after this many local frames (default: ${DEFAULT_FRAME_LIMIT})
  --help                 show this help

Relay uses POCKETSTATION_CONTROL_PLANE_URL and POCKETSTATION_RELAY_URL when set.`;

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`pocketstation-demo: ${message}`);
  process.exitCode = 1;
});

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  const arguments_ = parseArguments(process.argv.slice(2));
  const model = arguments_.model ?? process.env.PKS_WHISPER_MODEL;
  if (model === undefined || model.trim().length === 0) {
    throw new RangeError(
      'a local Whisper model is required; pass --model <path> or set PKS_WHISPER_MODEL',
    );
  }
  await requireReadableModel(model);
  const requestedWhisperCli = arguments_.whisperCli
    ?? process.env.PKS_WHISPER_CLI
    ?? 'whisper-cli';
  if (requestedWhisperCli.trim().length === 0) {
    throw new RangeError('--whisper-cli and PKS_WHISPER_CLI cannot be empty');
  }
  const whisperCliExecutable = await requireExecutable(requestedWhisperCli);

  const application = arguments_.application ?? await askForApplication();
  if (arguments_.recordTo !== undefined) {
    await mkdir(arguments_.recordTo, { recursive: true });
  }

  const live = new Capture({
    application,
    microphone: arguments_.microphone,
    recordTo: arguments_.recordTo,
    streamAudio: true,
    frameDurationMs: 10,
  });
  const transcription = new WhisperTranscriber(
    new WhisperTranscriberConfiguration({
      model, whisperCliExecutable, inputFrameSamplesPerChannel: 480, useGpu: arguments_.useGpu,
      cpuThreads: arguments_.cpuThreads, inferenceConcurrency: arguments_.inferenceConcurrency,
      initialPrompt: arguments_.initialPrompt,
      audioContextSeconds: arguments_.audioContextSeconds,
    }),
  );
  // The Operator and its routes must be declared before Session.start().
  const transcriptSubscription = transcription.attachMany(live.session, live.stems);

  let remote;
  let removeOwnerFailure = () => {};
  const abort = new AbortController();
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    abort.abort(new Error('interrupted'));
  };
  process.once('SIGINT', interrupt);

  try {
    if (arguments_.relay) {
      remote = await RelaySession.create({
        controlPlaneUrl: process.env.POCKETSTATION_CONTROL_PLANE_URL
          ?? DEFAULT_CONTROL_PLANE_URL,
        relayUrl: process.env.POCKETSTATION_RELAY_URL ?? DEFAULT_RELAY_URL,
        requiredBuses: live.microphone === undefined
          ? ['application']
          : ['application', 'microphone'],
        signal: abort.signal,
      });
      const ownerFailure = () => abort.abort(remote.renewalFailureSignal.reason);
      remote.renewalFailureSignal.addEventListener('abort', ownerFailure, { once: true });
      removeOwnerFailure = () => remote.renewalFailureSignal.removeEventListener('abort', ownerFailure);
      if (remote.renewalFailureSignal.aborted) ownerFailure();
      const publisher = remote.publisher(live.session);
      live.application.publish(publisher, 'application');
      live.microphone?.publish(publisher, 'microphone');
    }

    await live.start();
    const transcriptResult = printTranscripts(
      live,
      transcriptSubscription,
      abort.signal,
    ).then(
      () => ({ operation: 'transcription', status: 'closed' }),
      (error) => ({ operation: 'transcription', status: 'failed', error }),
    );

    // Drain immediately while control-plane activation is pending. The frame
    // limit starts after a receiver joins, so setup cannot consume the demo.
    let receiverReady = remote === undefined;
    const frameResult = countFrames(
      live, arguments_.frames, abort.signal, () => receiverReady,
    ).then(
      (sourceFrames) => ({ operation: 'frames', status: 'complete', sourceFrames }),
      (error) => ({ operation: 'frames', status: 'failed', error }),
    );
    if (remote !== undefined) {
      const activation = (async () => {
        await remote.waitForPublisher({ timeoutMs: 30_000, signal: abort.signal });
        for (const busId of live.microphone === undefined
          ? ['application'] : ['application', 'microphone']) {
          const invitation = await remote.createReceiverInvitation({
            busId, signal: abort.signal,
          });
          console.log(arguments_.showLinks
            ? `Listen live (${busId}): ${invitation.exposeShareUrl()}`
            : `Receiver (${busId}): ${invitation.shareAlias} [link redacted; use --show-links]`);
        }
        await remote.waitForReceiver({ timeoutMs: 30_000, signal: abort.signal });
        receiverReady = true;
        return { operation: 'activation' };
      })();
      const setup = await Promise.race([activation, frameResult, transcriptResult]);
      if (setup.operation !== 'activation') {
        if (setup.status === 'failed') throw setup.error;
        throw new Error(`${setup.operation} ended before receiver activation`);
      }
    }
    const firstResult = await Promise.race([frameResult, transcriptResult]);
    if (firstResult.operation === 'transcription') {
      if (firstResult.status === 'failed') throw firstResult.error;
      throw new Error('transcription ended before the capture frame limit');
    }
    if (firstResult.status === 'failed') throw firstResult.error;
    const sourceFrames = firstResult.sourceFrames;
    const outcome = interrupted ? await live.cancel() : await live.stop();
    const transcriptOutcome = await transcriptResult;
    if (transcriptOutcome.status === 'failed' && !interrupted) {
      throw transcriptOutcome.error;
    }
    for (const operator of outcome.metrics?.operators ?? []) {
      const delivery = operator.inputDelivery;
      console.log(`Model input ${operator.operatorInstanceId}: `
        + `${delivery.framesDroppedTotal} dropped frames, `
        + `${delivery.discontinuitiesTotal} discontinuities`);
    }
    console.log({ application, sourceFrames: Object.fromEntries(sourceFrames), outcome });
    if (!outcome.success && !interrupted) {
      throw new Error('capture finalization failed; inspect the Session outcome');
    }
    if (interrupted) process.exitCode = 130;
  } catch (error) {
    if (live.isRunning) await live.cancel();
    if (interrupted) {
      process.exitCode = 130;
      return;
    }
    throw error;
  } finally {
    abort.abort();
    removeOwnerFailure();
    process.removeListener('SIGINT', interrupt);
    try {
      await live.close();
    } finally {
      await remote?.close();
    }
  }
}

async function printTranscripts(live, subscription, signal) {
  for await (const envelope of live.signals(subscription).iterSignals({ signal })) {
    if (envelope.payload.kind !== 'text') {
      throw new TypeError('transcription Operator emitted a non-text signal');
    }
    const transcript = Transcript.fromJson(envelope.payload.text);
    if (transcript.processingOutcome === 'skipped-short-window') {
      console.warn(`Model source ${transcript.sourceId}: ${transcript.durationMs} ms untranscribed (short discontinuous or final window)`);
    }
    console.log(`source ${transcript.sourceId}: ${transcript.text}`);
  }
}

async function countFrames(live, frameLimit, signal, receiverReady) {
  const sourceFrames = new Map();
  let frames = 0;
  for await (const frame of live.audioBatches({ signal })) {
    if (!receiverReady()) continue;
    const source = frame.sourceId.toString();
    sourceFrames.set(source, (sourceFrames.get(source) ?? 0) + 1);
    frames += 1;
    if (frames >= frameLimit) break;
  }
  if (frames < frameLimit) throw new Error('audio stream ended before the capture frame limit');
  return sourceFrames;
}

function parseArguments(values) {
  const result = {
    application: undefined,
    microphone: false,
    useGpu: false,
    recordTo: undefined,
    relay: false,
    showLinks: false,
    frames: DEFAULT_FRAME_LIMIT,
    model: undefined,
    whisperCli: undefined,
    cpuThreads: 4,
    inferenceConcurrency: 1,
    initialPrompt: undefined,
    audioContextSeconds: undefined,
  };
  let gpuPreference;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--gpu' || value === '--no-gpu') {
      const preference = value === '--gpu';
      if (gpuPreference !== undefined && gpuPreference !== preference) throw new RangeError('--gpu and --no-gpu conflict');
      gpuPreference = preference;
      result.useGpu = preference;
    } else if (value === '--microphone') {
      result.microphone = true;
    } else if (value === '--cpu-threads' || value === '--inference-concurrency') {
      const count = Number(requiredValue(values, ++index, value));
      const maximum = value === '--cpu-threads' ? 64 : 8;
      if (!Number.isInteger(count) || count < 1 || count > maximum) throw new RangeError(`${value} is outside its supported integer range`);
      result[value === '--cpu-threads' ? 'cpuThreads' : 'inferenceConcurrency'] = count;
    } else if (value === '--initial-prompt') {
      result.initialPrompt = requiredValue(values, ++index, value);
    } else if (value === '--audio-context-seconds') {
      const seconds = Number(requiredValue(values, ++index, value));
      if (!Number.isFinite(seconds) || seconds < 5 || seconds > 30) throw new RangeError('--audio-context-seconds must be between 5 and 30');
      result.audioContextSeconds = seconds;
    } else if (value === '--relay') {
      result.relay = true;
    } else if (value === '--show-links' || value === '--show-private-links') {
      result.showLinks = true;
    } else if (value === '--record-to') {
      result.recordTo = requiredValue(values, ++index, value);
    } else if (value === '--model') {
      result.model = requiredValue(values, ++index, value);
    } else if (value === '--whisper-cli') {
      result.whisperCli = requiredValue(values, ++index, value);
    } else if (value === '--frames') {
      const count = Number(requiredValue(values, ++index, value));
      if (!Number.isSafeInteger(count) || count <= 0) {
        throw new RangeError('--frames must be a positive safe integer');
      }
      result.frames = count;
    } else if (value.startsWith('-')) {
      throw new RangeError(`unknown option: ${value}`);
    } else if (result.application === undefined) {
      result.application = value;
    } else {
      throw new RangeError(`unexpected argument: ${value}`);
    }
  }
  if (result.inferenceConcurrency > result.cpuThreads) throw new RangeError('inferenceConcurrency exceeds cpuThreads budget');
  return result;
}

function requiredValue(values, index, option) {
  const value = values[index];
  if (value === undefined || value.startsWith('-')) {
    throw new RangeError(`${option} requires a value`);
  }
  return value;
}

async function requireReadableModel(model) {
  try {
    await access(model, fileConstants.R_OK);
  } catch (error) {
    throw new Error(`cannot read local Whisper model at ${model}`, { cause: error });
  }
}

async function requireExecutable(executable) {
  const candidates = executable.includes('/') || executable.includes('\\')
    ? [executable]
    : executableSearchPaths(executable);
  for (const candidate of candidates) {
    try {
      await access(candidate, fileConstants.X_OK);
      return candidate;
    } catch {
      // Search the remaining PATH entries before reporting one precise error.
    }
  }
  throw new Error(
    `cannot execute local whisper.cpp CLI ${JSON.stringify(executable)}; `
      + 'pass --whisper-cli <path> or set PKS_WHISPER_CLI',
  );
}

function executableSearchPaths(executable) {
  const directories = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32' && extname(executable).length === 0
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  return directories.flatMap((directory) =>
    extensions.map((extension) => join(directory, `${executable}${extension}`)),
  );
}

async function askForApplication() {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const application = (await prompt.question(
      'Desktop application name, process ID, or application ID: ',
    )).trim();
    if (application.length === 0) {
      throw new RangeError('application selection cannot be empty');
    }
    return application;
  } finally {
    prompt.close();
  }
}
