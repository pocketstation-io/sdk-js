#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const options = parseArguments(process.argv.slice(2));
const packageRoot = options.packageRoot;
const packageJsonPath = resolve(packageRoot, 'package.json');
const [{ Session }, thresholdsDocument] = await Promise.all([
  import(pathToFileURL(resolve(packageRoot, 'dist/node/index.js')).href),
  readFile(options.thresholds, 'utf8').then(JSON.parse),
]);
const limits = thresholdsDocument.concurrentSessions;
const configuredSessions = [];

for (let index = 0; index < limits.sessionCount; index += 1) {
  const session = new Session({ channels: 1, frameDurationMs: 10 });
  const input = session.audioInput(`concurrent-session-${index}`);
  input.output.send(session.audio());
  configuredSessions.push(session);
}

let runningSessions = [];
let start;
let read;
let cancel;
try {
  start = await observe(
    configuredSessions.map((session) => () => session.start()),
    packageJsonPath,
  );
  runningSessions = start.values;

  read = await observe(
    runningSessions.map(
      (running) => () => running.audio.read({ timeoutMs: limits.readTimeoutMs }),
    ),
    packageJsonPath,
  );
  if (read.values.some((value) => value !== undefined)) {
    throw new Error('idle Session returned an unexpected audio value');
  }

  cancel = await observe(
    runningSessions.map((running) => () => running.cancel()),
    packageJsonPath,
  );
  runningSessions = [];
} finally {
  await Promise.allSettled(runningSessions.map((running) => running.cancel()));
}

const checks = [
  check('start maximum', start.maximumMs, limits.maximumStartMs),
  check('start completion spread', start.spreadMs, limits.maximumCompletionSpreadMs),
  check('start unrelated file read', start.fileReadMs, limits.maximumUnrelatedFileReadMs),
  check('audio read maximum', read.maximumMs, limits.maximumReadMs),
  check('audio read completion spread', read.spreadMs, limits.maximumCompletionSpreadMs),
  check('audio read unrelated file read', read.fileReadMs, limits.maximumUnrelatedFileReadMs),
  check('cancel maximum', cancel.maximumMs, limits.maximumCancelMs),
  check('cancel completion spread', cancel.spreadMs, limits.maximumCompletionSpreadMs),
  check('cancel unrelated file read', cancel.fileReadMs, limits.maximumUnrelatedFileReadMs),
];
const result = {
  schemaVersion: 1,
  status: checks.every((entry) => entry.passed) ? 'passed' : 'failed',
  classification: 'COMPONENT-MEASUREMENT',
  libuvThreadPoolSize: Number.parseInt(process.env.UV_THREADPOOL_SIZE ?? '', 10) || null,
  limits,
  start: summary(start),
  read: summary(read),
  cancel: summary(cancel),
  checks,
};

const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (options.output !== undefined) await writeFile(options.output, serialized);
console.log(serialized.trimEnd());
if (result.status !== 'passed') process.exitCode = 1;

async function observe(operations, filePath) {
  const startedAtMs = performance.now();
  const pending = operations.map(async (operation) => {
    const value = await operation();
    return { value, elapsedMs: performance.now() - startedAtMs };
  });
  const fileStartedAtMs = performance.now();
  const fileRead = readFile(filePath).then(
    () => performance.now() - fileStartedAtMs,
  );
  const [observations, fileReadMs] = await Promise.all([
    Promise.all(pending),
    fileRead,
  ]);
  const elapsed = observations.map(({ elapsedMs }) => elapsedMs);
  return {
    values: observations.map(({ value }) => value),
    minimumMs: Math.min(...elapsed),
    maximumMs: Math.max(...elapsed),
    spreadMs: Math.max(...elapsed) - Math.min(...elapsed),
    fileReadMs,
  };
}

function summary(observation) {
  return {
    minimumMs: observation.minimumMs,
    maximumMs: observation.maximumMs,
    spreadMs: observation.spreadMs,
    unrelatedFileReadMs: observation.fileReadMs,
  };
}

function check(name, actualMs, maximumMs) {
  return {
    name,
    unit: 'milliseconds',
    actualMs,
    maximumMs,
    passed: actualMs <= maximumMs,
  };
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${name ?? '<end>'}`);
    }
    values.set(name, value);
  }
  return {
    packageRoot: resolve(values.get('--package-root') ?? resolve(toolDirectory, '../..')),
    thresholds: resolve(
      values.get('--thresholds') ?? resolve(toolDirectory, 'thresholds.json'),
    ),
    output:
      values.get('--output') === undefined
        ? undefined
        : resolve(values.get('--output')),
  };
}
