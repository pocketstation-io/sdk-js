import {
  PortSpec,
  Session,
  SignalSpec,
  defineSource,
} from '../../dist/node/index.js';

const feed = defineSource({
  id: 'io.pocketstation.source.process-exit.v1',
  outputs: [PortSpec.output('events', SignalSpec.text())],
  create: () => ({ next: () => undefined }),
});

const session = new Session();
session.source(feed);

process.stdout.write('registered\n');
