import {
  OperatorEmission,
  OperatorManifest,
  OperatorProvider,
  PortSpec,
  Session,
  SignalSpec,
  defineSource,
} from 'pocketstation/node';

const request = SignalSpec.text('utf8', { role: 'request' });
const result = SignalSpec.text('utf8', { role: 'result.final' });
const source = defineSource({
  id: 'dev.pocketstation.source.operator-input.v1',
  outputs: [PortSpec.output('request', request)],
  create: () => {
    let sent = false;
    return {
      next: () => {
        if (sent) return undefined;
        sent = true;
        return { output: 'request', data: 'hello' };
      },
    };
  },
});

let preparation;
const uppercase = OperatorProvider.withNode(
  new OperatorManifest({
    operatorId: 'dev.pocketstation.example.uppercase.v1',
    inputs: [PortSpec.input('request', request)],
    outputs: [PortSpec.output('result', result)],
    terminalRoles: ['result.final'],
  }),
  async () => ({
    prepare: (context) => { preparation = context; },
    process: async (inputPort, envelope) => {
      if (inputPort !== 'request' || envelope.payload.kind !== 'text') return [];
      return [OperatorEmission.text(envelope.payload.text.toUpperCase(), {
        signal: result,
      })];
    },
  }),
);

const session = new Session();
const registered = session.registerOperator(uppercase);
const instance = registered.declare();
session.source(source).output('request').connect(instance.input('request'));
const subscription = session.subscribe(instance.output('result'), { signal: result });

const running = await session.start();
const value = await running.signals(subscription).read({ timeoutMs: 1_000 });
const stopped = await running.stop();

if (
  !stopped.success
  || value?.payload.kind !== 'text'
  || value.payload.text !== 'HELLO'
  || preparation?.executionPartition !== 'async-worker'
) {
  throw new Error('advanced Operator example failed');
}

console.log(value.payload.text);
