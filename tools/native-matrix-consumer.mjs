import assert from 'node:assert/strict';
import { exerciseAecBuild } from './aec-consumer.mjs';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

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
const { Session, PlaybackReference, aecAvailable, runtimeCompatibility, OutputCancelledError } = require('pocketstation/node');
assert.equal(runtimeCompatibility.sdkVersion, expectedVersion);
assert.equal(runtimeCompatibility.coreVersion, expectedCore);
assert.equal(runtimeCompatibility.nativeAbi, 'napi8');
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
console.log(JSON.stringify({
  passed: true, target, platform: process.platform, arch: process.arch,
  node: process.versions.node, napi: process.versions.napi,
  glibc: header.glibcVersionRuntime ?? null,
  nativeSha256, sdkVersion: expectedVersion, coreVersion: expectedCore,
  exports: names, samples: frame.samples.length, frames: 1,
  sourceIdentity: true, outputCancellation: true, stopSuccess: true,
  aec,
}));
