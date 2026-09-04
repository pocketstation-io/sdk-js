import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const work = mkdtempSync(join(tmpdir(), 'pocketstation-js-consumer-'));
const artifacts = join(work, 'artifacts');
const consumer = join(work, 'consumer');
mkdirSync(artifacts);
mkdirSync(consumer);

try {
  const pack = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--json', '--pack-destination', artifacts],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(pack.length, 1);
  const tarball = join(artifacts, pack[0].filename);

  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
    { cwd: consumer, stdio: 'inherit' },
  );

  const source = `
    import {
      CapturePermissionLifecycle,
      DeliveryPolicy,
      MediaCaps,
      Operator,
      RouteSettings,
      Session,
      SessionStartError,
      SignalSpec,
      Source,
      discoverSources,
      microphonePermissionObservation,
    } from 'pocketstation/node';
    const sources = await discoverSources();
    if (sources.length === 0) throw new Error('native discovery returned no sources');
    const permission = await microphonePermissionObservation();
    if (typeof permission !== 'string') throw new Error('permission observation is not typed');
    const lifecycle = new CapturePermissionLifecycle(permission);
    if (lifecycle.permissionEpoch !== 1n) throw new Error('invalid permission epoch');
    Source.applicationName('PocketStation missing application');
    Source.applicationId('io.pocketstation.missing');
    Source.applicationProcessId(42);
    Source.applicationStableId({ platform: 'macos', kind: 'application', stableKey: 'missing' });
    Source.application({
      processId: 42,
      stableId: { platform: 'macos', kind: 'application', stableKey: 'missing' },
    });
    Source.systemAudio();
    Source.defaultMicrophone();
    Source.microphone('missing-device');
    const inputSession = new Session({ frameDurationMs: 10 });
    const input = inputSession.audioInput('packed PCM');
    input.output.send(inputSession.audio());
    const inputSamples = new Float32Array(480).fill(0.25);
    input.tryWrite(inputSamples, { discontinuity: true });
    inputSamples.fill(0.75);
    input.close();
    const runningInput = await inputSession.start();
    const inputFrame = await runningInput.audio.read({ timeoutMs: 1000 });
    if (inputFrame?.samples[0] !== 0.25) throw new Error('packed PCM was not copied by Core');
    if (inputFrame.sourceId !== input.sourceId) throw new Error('packed PCM lost Source identity');
    if (inputFrame.streamId !== input.streamId) throw new Error('packed PCM lost stream identity');
    if (inputFrame.discontinuityEpoch !== 1n) throw new Error('packed PCM lost discontinuity');
    await runningInput.stop();
    const session = new Session({ frameDurationMs: 10 });
    const application = session.capture(Source.application('__pks_missing_application__'));
    const delivery = DeliveryPolicy.realtimeAudio().withQueuePressure('drop-newest');
    const route = RouteSettings.create(MediaCaps.audio({ frameSamples: 480 }), delivery);
    application.send(session.audio(route));
    if (SignalSpec.audio().wireId !== 'pks.signal.pcm-audio.v1') {
      throw new Error('native SignalSpec did not resolve through Core');
    }
    try {
      await session.start();
      throw new Error('missing application unexpectedly started');
    } catch (error) {
      if (error?.code !== 'capture.backend_failed') throw error;
    }
    const invalid = new Session();
    const desktop = invalid.capture(Source.systemAudio());
    desktop.through(new Operator('org.example.missing.v1')).send(invalid.audio());
    try {
      await invalid.start();
      throw new Error('unknown Operator unexpectedly compiled');
    } catch (error) {
      if (!(error instanceof SessionStartError)) throw error;
      if (error.code !== 'session.compile_failed') throw error;
      if (error.diagnostic?.code !== 'compile.unknown_async_operator') throw error;
    }
    const browser = await import('pocketstation/browser');
    if (typeof browser.RelaySession !== 'function') {
      throw new Error('browser export did not resolve');
    }
    console.log('packed consumer: PASS');
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: consumer,
    stdio: 'inherit',
  });

  const installedManifest = JSON.parse(
    readFileSync(join(consumer, 'node_modules/pocketstation/package.json'), 'utf8'),
  );
  assert.equal(installedManifest.version, '0.1.0');
} finally {
  rmSync(work, { recursive: true, force: true });
}
