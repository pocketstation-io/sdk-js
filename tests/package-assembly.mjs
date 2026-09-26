import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runNpm } from '../tools/run-npm.mjs';

const root = process.cwd();
const work = mkdtempSync(join(tmpdir(), 'pks-package-assembly-'));
const consumer = join(work, 'consumer');
const artifacts = join(work, 'artifacts');
mkdirSync(consumer); mkdirSync(artifacts);
const npm = (args, cwd = root) => runNpm(args,
  { cwd, encoding: 'utf8', timeout: 60_000 });
const run = (source, mode = 'module') => execFileSync(process.execPath,
  [`--input-type=${mode}`, '--eval', source],
  { cwd: consumer, encoding: 'utf8', timeout: 30_000 });
try {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const nativeManifests = readdirSync('npm').map((target) => ({ target,
    manifest: JSON.parse(readFileSync(`npm/${target}/package.json`, 'utf8')) }));
  assert.equal(nativeManifests.length, 6);
  for (const { manifest: native } of nativeManifests) {
    assert.equal(manifest.optionalDependencies[native.name], manifest.version);
    assert.equal(native.version, manifest.version);
    assert.equal(native.os.length, 1); assert.equal(native.cpu.length, 1);
    if (native.os[0] === 'linux') assert.deepEqual(native.libc, ['glibc']);
  }
  const pack = JSON.parse(npm(['pack', '--json', '--pack-destination', artifacts]))[0];
  assert.ok(pack.files.every(({ path }) => !/\.node$|^native\/|^node_modules\//.test(path)));
  const local = nativeManifests.find(({ manifest: m }) => m.os[0] === process.platform && m.cpu[0] === process.arch);
  const nativePack = JSON.parse(npm(['pack', `./npm/${local.target}`, '--json', '--pack-destination', artifacts]))[0];
  assert.equal(nativePack.files.filter(({ path }) => path.endsWith('.node')).length, 1);
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
  npm(['install', '--offline', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund',
    join(artifacts, pack.filename)], consumer);
  // No optional binary: neutral imports work; native use gives an actionable typed error.
  run(`import assert from 'node:assert/strict';
    import { PocketStationError } from 'pocketstation';
    await import('pocketstation/browser');
    await assert.rejects(async () => { const { Session } = await import('pocketstation/node'); new Session(); }, e => e instanceof PocketStationError
      && e.code === 'package.native_missing' && e.message.includes('--include=optional'));`);
  // Negative target probes run in separate processes and cannot affect the real consumer.
  for (const setup of [
    `Object.defineProperty(process, 'platform', {value:'freebsd'});`,
    `Object.defineProperty(process, 'platform', {value:'linux'});
     process.report.getReport = () => ({header:{}});`,
  ]) run(`${setup}
    const assert = (await import('node:assert/strict')).default;
    await assert.rejects(async () => { const { Session } = await import('pocketstation/node'); new Session(); }, e => e.code === 'package.unsupported_target');`);
  npm(['install', '--offline', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund',
    join(artifacts, nativePack.filename)], consumer);
  const nativePath = join(consumer, 'node_modules', local.manifest.name);
  const nativeManifestPath = join(nativePath, 'package.json');
  const originalManifest = readFileSync(nativeManifestPath);
  writeFileSync(nativeManifestPath, JSON.stringify({ ...local.manifest, version: '0.0.0' }));
  run(`import assert from 'node:assert/strict';
await assert.rejects(async () => { const { Session } = await import('pocketstation/node'); new Session(); }, e => e.code === 'package.version_mismatch');`);
  writeFileSync(nativeManifestPath, originalManifest);
  run(`import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const { pathToFileURL } = await import('node:url');
    const prefix = new URL('./node_modules/pocketstation/', import.meta.url).href;
    for (const name of ${JSON.stringify(Object.keys(manifest.exports).map((key) => key === '.' ? 'pocketstation' : 'pocketstation'+key.slice(1)))}) {
      const esm = await import(name); const cjs = require(name);
      assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
      for (const key of Object.keys(esm)) assert.equal(esm[key], cjs[key], name+'.'+key);
      assert.ok(pathToFileURL(require.resolve(name)).href.startsWith(prefix));
    }
    const { Session } = require('pocketstation/node');
    const session = new Session({frameDurationMs:10});
    const input = session.audioInput('package proof', {sampleRateHz:48000,channels:1});
    input.output.send(session.audio());
    const running = await session.start();
    try {
      await input.write(new Float32Array(480).fill(0.25));
      const frame = await running.audio.read({timeoutMs:1000});
      assert.equal(frame.samples.length, 480);
      assert.equal(frame.samples[0], 0.25);
      assert.equal(frame.sourceId, input.sourceId);
      assert.equal(frame.streamId, input.streamId);
    } finally { await running.stop(); }
    console.log('mixed module identity and installed native Session: PASS');`);
  // Compile both module modes together: private class identity must remain assignable.
  cpSync(join(root, 'node_modules/@types/node'), join(consumer, 'node_modules/@types/node'), { recursive: true });
  cpSync(join(root, 'node_modules/undici-types'), join(consumer, 'node_modules/undici-types'), { recursive: true });
  writeFileSync(join(consumer, 'common.cts'), `import { Session } from 'pocketstation/node'; export const session = new Session({frameDurationMs:10});\n`);
  writeFileSync(join(consumer, 'module.mts'), `import { Session } from 'pocketstation/node'; import { session } from './common.cjs'; const value: Session = session; void value;\n`);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    module:'NodeNext', moduleResolution:'NodeNext', target:'ES2022', strict:true,
    noEmit:true, skipLibCheck:false, lib:['ES2022','DOM','ESNext.Disposable'],
  }, files:['common.cts','module.mts'] }));
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', consumer], {stdio:'inherit'});
  // Traverse the actual browser ESM graph; no Node builtin, CommonJS or native edge is allowed.
  const seen = new Set();
  function browserGraph(file) {
    if (seen.has(file)) return; seen.add(file);
    const text = readFileSync(file, 'utf8');
    assert.ok(!/\brequire\(|\bprocess\.|native-dist|node:/.test(text), file);
    for (const match of text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('.'), `nonrelative browser dependency ${match[1]}`);
      browserGraph(resolve(file, '..', match[1]));
    }
  }
  browserGraph(join(consumer,'node_modules/pocketstation/dist/browser/index.js'));
  const report = {result:'PASS',root:pack.filename,native:nativePack.filename,
    rootIntegrity:pack.integrity,nativeIntegrity:nativePack.integrity,browserModules:seen.size};
  const outputIndex = process.argv.indexOf('--artifacts-dir');
  if (outputIndex !== -1) {
    const output = resolve(process.argv[outputIndex + 1]);
    mkdirSync(output, {recursive:true});
    for (const file of [pack.filename, nativePack.filename]) cpSync(join(artifacts,file),join(output,file));
    writeFileSync(join(output,'report.json'), JSON.stringify(report,null,2)+'\n');
  }
  console.log(JSON.stringify(report));
} finally {
  rmSync(work, {recursive:true,force:true});
}
