import {
  PortSpec,
  Session,
  SignalSpec,
  SourceEmission,
  SourceManifest,
  source,
} from 'pocketstation/node';

const transcript = SignalSpec.text('utf8', { role: 'transcript.final' });
const feed = source(new SourceManifest({
  sourceTypeId: 'dev.pocketstation.source.advanced-example.v1',
  outputs: [PortSpec.output('transcript', transcript)],
}))(async function* (configuration) {
  await Promise.resolve();
  yield SourceEmission.text('transcript', configuration.text ?? '', {
    signal: transcript,
    terminal: true,
  });
});

const session = new Session();
const instance = session.registerSource(feed).declare({ text: 'hello' });
const subscription = session.subscribe(instance.output('transcript'), {
  signal: transcript,
});

const running = await session.start();
const value = await running.signals(subscription).read({ timeoutMs: 1_000 });
const stopped = await running.stop();

if (
  !stopped.success
  || value === undefined
  || 'kind' in value
  || value.payload.kind !== 'text'
  || value.payload.text !== 'hello'
) {
  throw new Error('advanced Source example failed');
}

console.log(value.payload.text);
