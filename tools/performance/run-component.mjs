#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(toolDirectory, '../..');
const artifactRoot = await mkdtemp(join(tmpdir(), 'pocketstation-js-performance-'));

try {
  for (const frameDurationMs of [10, 20]) {
    const output = join(artifactRoot, `component-${frameDurationMs}ms.json`);
    await run([
      '--expose-gc',
      join(toolDirectory, 'measure.mjs'),
      '--scenario', 'component',
      '--frame-duration-ms', String(frameDurationMs),
      '--warmup-ms', '500',
      '--measurement-ms', '3000',
      '--package-root', packageRoot,
      '--output', output,
    ]);
    const result = JSON.parse(await readFile(output, 'utf8'));
    if (result.status !== 'passed') {
      throw new Error(`${frameDurationMs} ms component measurement failed`);
    }
    console.log(
      `${frameDurationMs} ms: ${result.scenarioResult.framesPerSecondPerSource.toFixed(2)} frames/s, ` +
      `route-to-Node p95 ${result.scenarioResult.routeToNodeMs.p95Ms.toFixed(3)} ms`,
    );
  }
} finally {
  await rm(artifactRoot, { recursive: true, force: true });
}

function run(arguments_) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, arguments_, { stdio: 'inherit' });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(`performance worker exited with ${code ?? signal ?? 'unknown status'}`),
      );
    });
  });
}
