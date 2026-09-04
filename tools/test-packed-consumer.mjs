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
      Session,
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
    const session = new Session({ frameDurationMs: 10 });
    const application = session.capture(Source.application('__pks_missing_application__'));
    application.send(session.audio());
    try {
      await session.start();
      throw new Error('missing application unexpectedly started');
    } catch (error) {
      if (error?.code !== 'session.start_failed') throw error;
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
