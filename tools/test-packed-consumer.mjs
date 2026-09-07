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

  const sidecarChild = join(consumer, 'pkss-child.mjs');
  writeFileSync(
    sidecarChild,
    readFileSync(join(process.cwd(), 'tests/fixtures/pkss-child.mjs')),
  );

  const source = `
    import {
      CapturePermissionLifecycle,
      EndpointFactory,
      DeliveryPolicy,
      END_OF_STREAM,
      ExtensionAbiVersion,
      ExtensionDescriptor,
      ExtensionPort,
      MediaCaps,
      Operator,
      PortSpec,
      RouteSettings,
      Session,
      SessionStartError,
      SidecarMessage,
      SidecarProcess,
      SignalSpec,
      Source,
      connector,
      defineOperator,
      defineSource,
      discoverSources,
      microphonePermissionObservation,
    } from 'pocketstation/node';
    const abi = ExtensionAbiVersion.current();
    abi.requireCompatible();
    new ExtensionDescriptor({
      id: 'dev.pocketstation.source.packed-consumer.v1',
      kind: 'source',
      ports: [new ExtensionPort({
        name: 'out',
        direction: 'output',
        signalId: 'dev.pocketstation.packed-consumer.signal.v1',
      })],
    });
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
    if (await runningInput.audio.read({ timeoutMs: 0 }) !== END_OF_STREAM) {
      throw new Error('packed audio stream did not report end-of-stream');
    }
    const providerSession = new Session({ frameDurationMs: 10 });
    const text = SignalSpec.text();
    const feed = defineSource({
      id: 'dev.pocketstation.source.packed-provider.v1',
      outputs: [PortSpec.output('text', text)],
      create: () => {
        let sent = false;
        return {
          next: () => {
            if (sent) return undefined;
            sent = true;
            return { output: 'text', data: 'packed', terminal: true };
          },
        };
      },
    });
    const transform = defineOperator({
      id: 'dev.pocketstation.operator.packed-provider.v1',
      inputs: [PortSpec.input('text', text)],
      outputs: [
        PortSpec.output('text', text),
        PortSpec.output('audio', SignalSpec.audio(), {
          media: MediaCaps.audio({
            sampleRateHz: 48000,
            frameSamples: 480,
            channelLayout: 'mono',
          }),
        }),
      ],
      create: () => ({
        process: () => [
          { output: 'text', data: 'PACKED' },
          { output: 'audio', data: new Float32Array(480).fill(0.5) },
        ],
      }),
    });
    const endpointValues = [];
    const endpoint = new EndpointFactory({
      id: 'dev.pocketstation.endpoint.packed-provider.v1',
      inputs: [PortSpec.input('text', text)],
      create: () => ({
        receive: (item) => endpointValues.push(item),
      }),
    });
    const connectorFrames = [];
    const sourceOutput = providerSession.source(feed).output('text');
    const operator = providerSession.operator(transform);
    sourceOutput.connect(operator.input('text'));
    operator.output('text').send(providerSession.endpoint(endpoint), { input: 'text' });
    operator.output('audio').reenterAudio().sendTo(
      connector((frame) => connectorFrames.push(frame)),
    );
    const runningProvider = await providerSession.start();
    const providerDeadline = Date.now() + 1000;
    while (endpointValues.length !== 1 || connectorFrames.length !== 1) {
      if (Date.now() >= providerDeadline) {
        throw new Error('packed provider authoring did not deliver every output');
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const providerStop = await runningProvider.stop();
    if (!providerStop.success) throw new Error('packed provider Session did not stop cleanly');
    if (endpointValues[0].signal.payload.text !== 'PACKED') {
      throw new Error('packed Endpoint did not receive Operator text');
    }
    if (connectorFrames[0].samples[0] !== 0.5) {
      throw new Error('packed Connector did not receive generated audio');
    }
    const sidecarSession = new Session({ frameDurationMs: 10 });
    const sidecarInput = sidecarSession.audioInput('sidecar proof');
    sidecarInput.output.send(sidecarSession.audio());
    sidecarInput.tryWrite(new Float32Array(480));
    sidecarInput.close();
    const sidecarHandle = sidecarSession.registerSidecar(new SidecarProcess({
      id: 7n,
      program: process.execPath,
      arguments: [${JSON.stringify(sidecarChild)}, 'healthy'],
      deadlines: { readyMs: 1000, processingMs: 1000, shutdownMs: 200 },
    }));
    const runningSidecar = await sidecarSession.start();
    const sidecar = runningSidecar.sidecar(sidecarHandle);
    await sidecar.send(SidecarMessage.signal(Buffer.from('packed'), {
      signalId: 'dev.pocketstation.packed-consumer.signal.v1',
      streamId: 9n,
      sequenceNumber: 1n,
      timestampNs: 1000n,
    }));
    const sidecarReply = await sidecar.messages.read({ timeoutMs: 1000 });
    if (sidecarReply?.payload?.toString() !== 'packed') {
      throw new Error('packed sidecar did not return copied bytes');
    }
    const sidecarStop = await runningSidecar.stop();
    if (sidecarStop.sidecarOutcomes[0]?.reapsTotal !== 1n) {
      throw new Error('packed sidecar was not reaped');
    }
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
