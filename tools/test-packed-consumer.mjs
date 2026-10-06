import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { runNpm } from './run-npm.mjs';

const work = mkdtempSync(join(tmpdir(), 'pocketstation-js-consumer-'));
const artifacts = join(work, 'artifacts');
const consumer = join(work, 'consumer');
mkdirSync(artifacts);
mkdirSync(consumer);
writeFileSync(join(consumer, 'aec-consumer.mjs'), readFileSync('tools/aec-consumer.mjs'));

try {
  const pack = JSON.parse(
    runNpm(
      ['pack', '--json', '--pack-destination', artifacts],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(pack.length, 1);
  const tarball = join(artifacts, pack[0].filename);
  assert.ok(pack[0].files.every((file) => !file.path.endsWith('.node')));
  const binary = readdirSync('native-dist').find((name) => name.endsWith('.node'));
  assert.ok(binary, 'build must produce the local native package');
  const target = binary.slice('pocketstation-js.'.length, -'.node'.length);
  const nativePack = JSON.parse(runNpm(
    ['pack', `./npm/${target}`, '--json', '--pack-destination', artifacts],
    { encoding: 'utf8' }));
  const nativeTarball = join(artifacts, nativePack[0].filename);

  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  runNpm(
    ['install', '--offline', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', tarball, nativeTarball],
    { cwd: consumer, stdio: 'inherit' },
  );
  assert.equal(
    existsSync(join(consumer, 'node_modules/ws')),
    false,
    'optional Realtime transport must not be installed with the base package',
  );

  writeFileSync(
    join(consumer, 'sidecar-consumer.ts'),
    `import { SidecarMessage, SidecarProcess } from 'pocketstation/node';

new SidecarProcess({ id: 1n, program: 'node' });
SidecarMessage.signal(new Uint8Array(), {
  streamId: 1n,
  sequenceNumber: 0n,
  timestampNs: 0n,
  signalId: 'dev.pocketstation.packed.signal.v1',
});
`,
  );
  writeFileSync(
    join(consumer, 'demo-consumer.ts'),
    `import {
  OpenAIRealtime,
  RealtimeVoiceConfig,
  WhisperTranscriber,
  WhisperTranscriberConfiguration,
  type AudioConverter,
  type RealtimeInput,
  type RealtimeSocketFactory,
  type WhisperModelFactory,
} from 'pocketstation/demo';
import type {
  AudioFrame,
  AudioInput,
  BusSubscription,
  Capture,
  DerivedStream,
  Endpoint,
  OperatorManifest,
  OperatorProvider,
  RunningSession,
  EchoCancelledAudio,
  PlaybackReference,
  Session,
  SignalEnvelope,
  SignalSpec,
  SourceOutput,
  Stem,
} from 'pocketstation/node';
import type {
  DuplexVoiceCapabilities,
  DuplexVoiceConnection,
  DuplexVoiceContext,
  DuplexVoiceModel,
} from 'pocketstation/voice';

new WhisperTranscriber(new WhisperTranscriberConfiguration());
new RealtimeVoiceConfig();

type DemoBoundary = {
  echo: EchoCancelledAudio;
  playbackReference: PlaybackReference;
  audioConverter: AudioConverter;
  input: RealtimeInput;
  socketFactory: RealtimeSocketFactory;
  modelFactory: WhisperModelFactory;
  frame: AudioFrame;
  audioInput: AudioInput;
  subscription: BusSubscription;
  capture: Capture;
  stream: DerivedStream | SourceOutput | Stem;
  endpoint: Endpoint;
  manifest: OperatorManifest;
  provider: OperatorProvider;
  running: RunningSession;
  session: Session;
  envelope: SignalEnvelope;
  signal: SignalSpec;
  capabilities: DuplexVoiceCapabilities;
  connection: DuplexVoiceConnection;
  context: DuplexVoiceContext;
  model: DuplexVoiceModel;
  realtime: OpenAIRealtime;
};

export type { DemoBoundary };
`,
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      files: ['sidecar-consumer.ts', 'demo-consumer.ts'],
    }),
  );
  execFileSync(
    process.execPath,
    [join(process.cwd(), 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
    { cwd: consumer, stdio: 'inherit' },
  );

  const sidecarChild = join(consumer, 'pkss-child.mjs');
  writeFileSync(
    sidecarChild,
    readFileSync(join(process.cwd(), 'tests/fixtures/pkss-child.mjs')),
  );

  const source = `
    const installedPrefix = new URL('./node_modules/pocketstation/', import.meta.url).href;
    const requireInstalledEntry = (entry) => {
      if (!entry.startsWith(installedPrefix)) {
        throw new Error('packed consumer resolved the checkout instead of installed package');
      }
    };
    let rejectedCheckout = false;
    try {
      requireInstalledEntry(new URL('../sdk-js/dist/node/index.js', import.meta.url).href);
    } catch (failure) {
      rejectedCheckout = failure.message.includes('resolved the checkout');
    }
    if (!rejectedCheckout) throw new Error('packed resolution guard did not reject checkout path');
    requireInstalledEntry(import.meta.resolve('pocketstation/node'));
    import {
      CapturePermissionLifecycle,
      Capture,
      ClockDomainId,
      ConnectorId,
      EndpointDriverObservations,
      EndpointFactory,
      EndpointManifest,
      EndpointProvider,
      DeliveryPolicy,
      END_OF_STREAM,
      EndpointId,
      EventInput,
      EventInputClosedError,
      EventInputFullError,
      ExtensionAbiVersion,
      ExtensionDescriptor,
      ExtensionPort,
      MediaCaps,
      Operator,
      OperatorInstanceId,
      OperatorEmission,
      OperatorManifest,
      OperatorProvider,
      OutputCancelledError,
      OutputGeneration,
      PortSpec,
      PreparedEndpointDriver,
      PublisherActivation,
      ReceiverActivation,
      ReceiverInvitation,
      RelayError,
      RelayRoute,
      RelaySession,
      RelayTimeoutError,
      RouteId,
      RouteSettings,
      RunningSession,
      RunningEndpointDriver,
      SampleRepresentation,
      Session,
      aecAvailable,
      PlaybackReference,
      SessionStartError,
      SidecarId,
      SidecarMessage,
      SidecarProcess,
      SignalSpec,
      Source,
      SourceError,
      SourceId,
      SourceInstanceId,
      SourceEmission,
      SourceManifest,
      SourceProvider,
      StemId,
      StreamId,
      RuntimeSessionId,
      connector,
      defineOperator,
      defineSource,
      discoverSources,
      evaluateSourceActivity,
      evaluateSourceSignal,
      microphonePermissionObservation,
      runtimeCompatibility,
    } from 'pocketstation/node';
    if (runtimeCompatibility.sdkVersion !== '0.1.5') {
      throw new Error('packed compatibility report has the wrong SDK version');
    }
    if (runtimeCompatibility.coreVersion !== '1.1.13') {
      throw new Error('packed compatibility report has the wrong Core version');
    }
    if (SampleRepresentation.SIGNED_INTEGER_16 !== 'signed-integer-16') {
      throw new Error('packed SampleRepresentation is unavailable');
    }
    if (typeof SourceError !== 'function') {
      throw new Error('packed SourceError is unavailable');
    }
    for (const identity of [
      ClockDomainId,
      ConnectorId,
      EndpointId,
      OperatorInstanceId,
      RouteId,
      RuntimeSessionId,
      SidecarId,
      SourceId,
      SourceInstanceId,
      StemId,
      StreamId,
    ]) {
      if (typeof identity !== 'function') {
        throw new Error('packed runtime identity export is unavailable');
      }
    }
    if (SourceId(42n) !== 42n) {
      throw new Error('packed runtime identity changed its numeric value');
    }
    if (typeof RunningSession.prototype.replaceMicrophoneSource !== 'function' ||
        typeof RunningSession.prototype.reopenMicrophoneSource !== 'function') {
      throw new Error('packed microphone replacement API is unavailable');
    }
    const activity = evaluateSourceActivity({
      sessionStartedAtNs: 0n,
      observedAtNs: 1n,
      framesReceivedTotal: 0n,
    }, {
      firstFrameTimeoutNs: 1n,
      stallTimeoutNs: 1n,
    });
    if (activity.state !== 'first-frame-timed-out') {
      throw new Error('packed source activity evaluation changed');
    }
    const signal = evaluateSourceSignal({
      observedAtNs: 1n,
      samplesObservedTotal: 1n,
      exactZeroSamplesObservedTotal: 1n,
      nonzeroSamplesObservedTotal: 0n,
      nonfiniteSamplesObservedTotal: 0n,
      windowDurationNs: 1n,
      windowSourceGeneration: 0,
      windowDiscontinuityEpoch: 0n,
      windowSamplesTotal: 1n,
      windowExactZeroSamplesTotal: 1n,
      windowNonzeroSamplesTotal: 0n,
      windowNonfiniteSamplesTotal: 0n,
      consecutiveExactZeroDurationNs: 1n,
    }, {
      minimumPeakDbfs: -40,
      minimumRmsDbfs: -50,
      exactZeroTimeoutNs: 1n,
    });
    if (signal.state !== 'sustained-exact-digital-zero') {
      throw new Error('packed source signal evaluation changed');
    }
    for (const relayExport of [
      PublisherActivation,
      ReceiverActivation,
      ReceiverInvitation,
      RelayError,
      RelayRoute,
      RelaySession,
      RelayTimeoutError,
    ]) {
      if (typeof relayExport !== 'function') {
        throw new Error('packed Node Relay composition export is unavailable');
      }
    }
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
    const concise = new Capture({
      application: 'PocketStation missing application',
      streamAudio: false,
    });
    if (!(concise.session instanceof Session)) {
      throw new Error('concise capture did not compose the public Session');
    }
    if (concise.microphone !== undefined || concise.stems.length !== 1) {
      throw new Error('concise capture opened an implicit microphone');
    }
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
    const oldOutput = input.beginOutput();
    if (!(oldOutput instanceof OutputGeneration)) {
      throw new Error('packed output did not use the public output type');
    }
    input.tryWrite(inputSamples, { discontinuity: true, output: oldOutput });
    const currentOutput = input.beginOutput();
    if (oldOutput.active || !currentOutput.active) {
      throw new Error('starting new output did not deactivate the previous output');
    }
    try {
      input.tryWrite(inputSamples, { output: oldOutput });
      throw new Error('inactive output unexpectedly accepted PCM');
    } catch (error) {
      if (!(error instanceof OutputCancelledError)) throw error;
    }
    inputSamples.fill(0.75);
    input.tryWrite(inputSamples, { output: currentOutput });
    input.close();
    let inputAudio;
    const inputStop = await inputSession.run(async (running) => {
      inputAudio = running.audio;
      const inputFrame = await running.audio.read({ timeoutMs: 1000 });
      if (inputFrame?.samples[0] !== 0.75) throw new Error('packed PCM was not copied by Core');
      if (inputFrame.sourceId !== input.sourceId) throw new Error('packed PCM lost Source identity');
      if (inputFrame.streamId !== input.streamId) throw new Error('packed PCM lost stream identity');
      if (inputFrame.outputGenerationId !== currentOutput.id) {
        throw new Error('packed PCM lost output identity');
      }
      const inputMetrics = await running.metrics();
      if (inputMetrics.routes[0]?.delivery.discardedOutputFramesTotal !== 1n) {
        throw new Error('packed Session did not report discarded obsolete output');
      }
    });
    if (!inputStop.success) throw new Error('scoped packed Session did not stop cleanly');
    if (await inputAudio.read({ timeoutMs: 0 }) !== END_OF_STREAM) {
      throw new Error('packed audio stream did not report end-of-stream');
    }
    const { exerciseAecBuild } = await import('./aec-consumer.mjs');
    const aec = await exerciseAecBuild(Session, PlaybackReference, aecAvailable);
    console.log(JSON.stringify({ aec }));
    const eventSession = new Session();
    const eventInput = eventSession.eventInput('packed-events', {
      capacityEvents: 1,
    });
    if (!(eventInput instanceof EventInput)) {
      throw new Error('packed event input did not use the public type');
    }
    const eventSubscription = eventSession.subscribe(eventInput.output, {
      signal: eventInput.signal,
      route: RouteSettings.buffered(),
    });
    eventInput.tryWrite({ type: 'packed.ready' }, { timestampNs: 42n });
    try {
      eventInput.tryWrite({ type: 'packed.full' });
      throw new Error('packed event input exceeded its finite capacity');
    } catch (error) {
      if (!(error instanceof EventInputFullError)) throw error;
    }
    await eventInput.close();
    try {
      eventInput.tryWrite({ type: 'packed.closed' });
      throw new Error('closed packed event input accepted an event');
    } catch (error) {
      if (!(error instanceof EventInputClosedError)) throw error;
    }
    const runningEvents = await eventSession.start();
    const packedEvent = await runningEvents
      .signals(eventSubscription)
      .read({ timeoutMs: 1000 });
    const eventStop = await runningEvents.stop();
    if (packedEvent?.payload?.kind !== 'bytes') {
      throw new Error('packed event input did not deliver JSON bytes');
    }
    if (JSON.parse(Buffer.from(packedEvent.payload.data)).type !== 'packed.ready') {
      throw new Error('packed event input changed its JSON payload');
    }
    if (packedEvent.timing.sourceTimestampNs !== 42n) {
      throw new Error('packed event input changed its source timestamp');
    }
    if (!eventStop.success) throw new Error('packed event Session did not stop cleanly');
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
    if (!providerStop.success) {
      throw new Error(
        'packed provider Session did not stop cleanly: ' +
        JSON.stringify(providerStop, (_key, value) => typeof value === 'bigint' ? String(value) : value),
      );
    }
    if (endpointValues[0].signal.payload.text !== 'PACKED') {
      throw new Error('packed Endpoint did not receive Operator text');
    }
    if (connectorFrames[0].samples[0] !== 0.5) {
      throw new Error('packed Connector did not receive generated audio');
    }
    const advancedSourceSignal = SignalSpec.text('utf8', { role: 'packed.source' });
    const advancedSourceManifest = new SourceManifest({
      sourceTypeId: 'dev.pocketstation.source.packed-advanced.v1',
      outputs: [PortSpec.output('events', advancedSourceSignal)],
      revision: 2,
      implementationGeneration: 3,
    });
    let advancedSourcePrepared;
    let advancedSourceClosed = 0;
    let advancedSourceSent = false;
    const advancedSourceProvider = SourceProvider.withDriver(
      advancedSourceManifest,
      async () => ({
        prepare: async (context) => { advancedSourcePrepared = context; },
        next: async (cancellation) => {
          if (cancellation.cancelled || advancedSourceSent) return undefined;
          advancedSourceSent = true;
          return SourceEmission.text('events', 'source-ready', {
            signal: advancedSourceSignal,
            sourceTimestampNs: 100n,
            observedTimestampNs: 125n,
            durationNs: 25n,
            terminal: true,
          });
        },
        close: async () => { advancedSourceClosed += 1; },
      }),
    );
    const advancedSourceSession = new Session();
    const advancedRegisteredSource = advancedSourceSession.registerSource(advancedSourceProvider);
    const advancedSourceInstance = advancedRegisteredSource.declare();
    const advancedSourceOutput = advancedSourceInstance.output('events');
    const advancedSourceSubscription = advancedSourceSession.subscribe(
      advancedSourceOutput,
      { signal: advancedSourceSignal },
    );
    const advancedSourceRunning = await advancedSourceSession.start();
    const advancedSourceValue = await advancedSourceRunning
      .signals(advancedSourceSubscription)
      .read({ timeoutMs: 1000 });
    const advancedSourceStop = await advancedSourceRunning.stop();
    if (
      !advancedSourceStop.success ||
      advancedSourceValue?.payload?.text !== 'source-ready' ||
      advancedSourceValue?.timing?.sourceTimestampNs !== 100n ||
      advancedSourceValue?.lineage?.sourceId !== advancedSourceInstance.sourceId ||
      advancedSourcePrepared?.sessionId !== advancedSourceSession.id ||
      advancedSourcePrepared?.outputs?.[0]?.streamId !== advancedSourceOutput.streamId ||
      advancedSourceClosed !== 1
    ) {
      throw new Error('packed advanced Source lost lifecycle, identity, timing, or output');
    }
    const advancedOperatorSession = new Session();
    const requestSignal = SignalSpec.text('utf8', { role: 'packed.request' });
    const resultSignal = SignalSpec.text('utf8', { role: 'packed.result' });
    const advancedOperatorFeed = defineSource({
      id: 'dev.pocketstation.source.packed-advanced-operator.v1',
      outputs: [PortSpec.output('request', requestSignal)],
      create: () => {
        let sent = false;
        return { next: () => {
          if (sent) return undefined;
          sent = true;
          return { output: 'request', data: 'advanced' };
        } };
      },
    });
    let advancedOperatorPrepared;
    const advancedOperatorProvider = OperatorProvider.withNode(
      new OperatorManifest({
        operatorId: 'dev.pocketstation.operator.packed-advanced.v1',
        inputs: [PortSpec.input('request', requestSignal)],
        outputs: [PortSpec.output('result', resultSignal)],
        terminalRoles: ['packed.result'],
      }),
      async () => ({
        prepare: (context) => { advancedOperatorPrepared = context; },
        process: async (inputPort, envelope) => {
          if (inputPort !== 'request') throw new Error('packed advanced Operator lost its input port');
          return [OperatorEmission.text(envelope.payload.text.toUpperCase(), {
            signal: resultSignal,
          })];
        },
      }),
    );
    const advancedOperatorRegistered = advancedOperatorSession.registerOperator(
      advancedOperatorProvider,
    );
    const advancedOperatorInstance = advancedOperatorRegistered.declare();
    advancedOperatorSession.source(advancedOperatorFeed).output('request')
      .connect(advancedOperatorInstance.input('request'));
    const advancedOperatorSubscription = advancedOperatorSession.subscribe(
      advancedOperatorInstance.output('result'),
      { signal: resultSignal },
    );
    const advancedOperatorRunning = await advancedOperatorSession.start();
    const advancedOperatorResult = await advancedOperatorRunning
      .signals(advancedOperatorSubscription)
      .read({ timeoutMs: 1000 });
    const advancedOperatorStop = await advancedOperatorRunning.stop();
    if (
      !advancedOperatorStop.success ||
      advancedOperatorResult?.payload?.text !== 'ADVANCED' ||
      advancedOperatorPrepared?.executionPartition !== 'async-worker'
    ) {
      throw new Error('packed advanced Operator lost lifecycle, context, or output');
    }
    let advancedEndpointGate;
    let advancedEndpointFrames = 0;
    class PackedRunningEndpoint extends RunningEndpointDriver {
      receive(delivery) {
        if (!advancedEndpointGate?.isOpen) {
          throw new Error('packed advanced Endpoint received before the Core gate opened');
        }
        if (delivery.item.kind === 'audio') advancedEndpointFrames += 1;
      }
      joinAndFinalize() {
        return new EndpointDriverObservations({
          framesReceivedTotal: advancedEndpointFrames,
          framesDeliveredTotal: advancedEndpointFrames,
        });
      }
    }
    class PackedPreparedEndpoint extends PreparedEndpointDriver {
      start(gate) {
        if (gate.isOpen) throw new Error('packed Core gate opened before Endpoint startup');
        advancedEndpointGate = gate;
        return new PackedRunningEndpoint();
      }
    }
    const advancedEndpointSession = new Session({ frameDurationMs: 10 });
    const advancedEndpointInput = advancedEndpointSession.audioInput('packed advanced Endpoint');
    const advancedEndpointProvider = new EndpointProvider({
      manifest: EndpointManifest.audio('dev.pocketstation.endpoint.packed-advanced.v1'),
      factory: () => new PackedPreparedEndpoint(),
    });
    const advancedRegistered = advancedEndpointSession.registerEndpoint(advancedEndpointProvider);
    advancedEndpointInput.output.send(advancedRegistered.declare({ destination: 'packed' }));
    advancedEndpointInput.tryWrite(new Float32Array(480).fill(0.125));
    advancedEndpointInput.close();
    const advancedRunning = await advancedEndpointSession.start();
    const advancedDeadline = Date.now() + 1000;
    while (advancedEndpointFrames !== 1) {
      if (Date.now() >= advancedDeadline) {
        throw new Error('packed advanced Endpoint did not receive its Core frame');
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const advancedStop = await advancedRunning.stop();
    const advancedObservations = advancedRegistered.observations();
    if (
      !advancedStop.success ||
      advancedObservations.length !== 1 ||
      advancedObservations[0].framesDeliveredTotal !== 1n ||
      !advancedObservations[0].finalized
    ) {
      throw new Error('packed advanced Endpoint did not finalize with retained observations');
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
      // Headless Linux can reject application capture before resolving its name.
      const allowedCodes = process.platform === 'linux'
        ? ['capture.backend_failed', 'capture.unsupported']
        : ['capture.backend_failed'];
      if (!allowedCodes.includes(error?.code)) throw error;
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
    if (
      typeof browser.RelayReceiver !== 'function' ||
      typeof browser.resolveRelayInvitation !== 'function' ||
      typeof browser.PocketStationError !== 'function'
    ) {
      throw new Error('browser export did not resolve');
    }
    const control = await import('pocketstation/control');
    if (
      typeof control.ControlClient !== 'function' ||
      typeof control.ControlPlaneError !== 'function' ||
      typeof control.SecretToken !== 'function' ||
      typeof control.SessionId !== 'function'
    ) {
      throw new Error('control export did not resolve');
    }
    const controlRequests = [];
    const controlClient = new control.ControlClient('https://control.example/base', {
      fetch: async (input, init) => {
        controlRequests.push({ input: String(input), init });
        return new Response(JSON.stringify({
          session_id: 'packed_session',
          required_buses: ['application', 'microphone'],
          source_token: 'packed-source-secret',
          ice_servers: [],
        }), { status: 201 });
      },
    });
    const controlCredentials = await controlClient.createSession();
    if (controlCredentials.sessionId.toString() !== 'packed_session') {
      throw new Error('packed control client lost Session identity');
    }
    if (controlCredentials.sourceToken.exposeSecret() !== 'packed-source-secret') {
      throw new Error('packed control client lost the explicit secret boundary');
    }
    if (JSON.stringify(controlCredentials).includes('packed-source-secret')) {
      throw new Error('packed control client serialized a bearer secret');
    }
    if (controlRequests.length !== 1) {
      throw new Error('packed control client did not execute exactly one request');
    }
    controlClient.close();
    const voice = await import('pocketstation/voice');
    const voiceConfig = new voice.ConversationConfig();
    if (
      voiceConfig.historyCapacity !== 32 ||
      voiceConfig.maximumOutputFramesPerTurn !== 3000
    ) {
      throw new Error('packed voice configuration lost finite defaults');
    }
    const transcript = new voice.TranscriptUpdate({
      utteranceId: 'packed-speech',
      revision: 1,
      text: 'packed voice',
      stablePrefix: 'packed voice',
      final: true,
      sourceId: 1n,
      streamId: 2n,
    });
    if (!transcript.final || transcript.sourceId !== 1n) {
      throw new Error('packed voice transcript lost final state or Source identity');
    }
    let generationActive = true;
    const generated = [];
    const conversation = new voice.Conversation({
      transcripts: { sessionId: 9n },
      respond: async () => 'packed answer',
      synthesize: async function* () { yield 0.25; },
      output: {
        config: { sampleRateHz: 48000, channels: 1 },
        output: { sessionId: 9n },
        beginOutput: () => ({
          id: 1n,
          get active() { return generationActive; },
          cancel: () => {
            const changed = generationActive;
            generationActive = false;
            return changed;
          },
        }),
        write: async (samples) => { generated.push(samples); },
        observations: () => ({ bufferSlots: 1n, availableBuffers: 1n }),
      },
    });
    let signalRead = false;
    const voiceOutcome = await conversation.run({
      sessionId: 9n,
      signals: () => ({
        read: async () => {
          if (signalRead) return { kind: 'end-of-stream' };
          signalRead = true;
          return {
            payload: { kind: 'text', text: 'packed question' },
            timing: { observedTimestampNs: 1n },
            lineage: { sourceId: 2n, streamId: 3n, sequenceNumber: 0n },
          };
        },
      }),
      metrics: async () => ({ routes: [] }),
    });
    if (!voiceOutcome.success || generated.length !== 1) {
      throw new Error('packed voice conversation did not complete bounded work');
    }
    const demo = await import('pocketstation/demo');
    for (const demoExport of [
      demo.AudioWindowBuffer,
      demo.WhisperTranscriber,
      demo.WhisperTranscriberConfiguration,
      demo.WhisperCliModel,
      demo.OpenAIRealtime,
      demo.RealtimeVoiceConfig,
      demo.Transcript,
      demo.encodeRealtimeMicrophoneFrame,
    ]) {
      if (typeof demoExport !== 'function') {
        throw new Error('packed demo provider export is unavailable');
      }
    }
    const realtime = new demo.OpenAIRealtime({
      apiKey: 'packed-missing-ws',
      config: new demo.RealtimeVoiceConfig({ connectTimeoutS: 0.1 }),
    });
    const realtimeConnection = realtime.connect(new voice.DuplexVoiceContext(
      { polledAudio: () => ({}) },
      { send: () => 1n },
      {
        config: { sampleRateHz: 48_000, channels: 1, frameSamplesPerChannel: 480 },
        beginOutput: () => ({ active: true, cancel: () => true }),
        write: async () => undefined,
      },
      new voice.ConversationConfig(),
    ));
    let missingWsWasClear = false;
    try {
      await realtimeConnection.start({});
    } catch (failure) {
      missingWsWasClear = failure instanceof Error
        && failure.message.includes('npm install ws');
    } finally {
      await realtimeConnection.close();
    }
    if (!missingWsWasClear) {
      throw new Error('packed optional Realtime transport did not report how to install ws');
    }
    const root = await import('pocketstation');
    if (
      typeof root.RuntimeCompatibility !== 'function' ||
      root.runtimeCompatibility.sdkVersion !== '0.1.5' ||
      root.runtimeCompatibility.coreVersion !== '1.1.13' ||
      root.runtimeCompatibility.relayConnectorVersion !== '0.1.5' ||
      root.runtimeCompatibility.nativeAbi !== 'napi8'
    ) {
      throw new Error('packed runtime compatibility facts are unavailable');
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
  assert.equal(installedManifest.version, '0.1.5');
  assert.equal(installedManifest.peerDependencies.ws, '8.18.3');
  assert.equal(installedManifest.peerDependenciesMeta.ws.optional, true);
  assert.equal(
    installedManifest.bin['pocketstation-demo'],
    './bin/pocketstation-demo.mjs',
  );
  const demoHelp = execFileSync(
    process.execPath,
    [join(consumer, 'node_modules/pocketstation/bin/pocketstation-demo.mjs'), '--help'],
    { cwd: consumer, encoding: 'utf8' },
  );
  assert.match(demoHelp, /Usage: pocketstation-demo/);
} finally {
  rmSync(work, { recursive: true, force: true });
}
