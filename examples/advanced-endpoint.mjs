import {
  EndpointDriverObservations,
  EndpointManifest,
  EndpointProvider,
  PreparedEndpointDriver,
  RunningEndpointDriver,
  Session,
} from 'pocketstation/node';

const received = [];
let startGate;

class Collector extends RunningEndpointDriver {
  receive(delivery) {
    if (!startGate?.isOpen) throw new Error('Core start gate is still closed');
    if (delivery.item.kind === 'audio') received.push(delivery.item.frame.sequenceNumber);
  }

  joinAndFinalize() {
    return new EndpointDriverObservations({
      framesReceivedTotal: received.length,
      framesDeliveredTotal: received.length,
    });
  }
}

class PreparedCollector extends PreparedEndpointDriver {
  start(gate) {
    if (gate.isOpen) throw new Error('Core opened the start gate before startup completed');
    startGate = gate;
    return new Collector();
  }
}

const collector = new EndpointProvider({
  manifest: EndpointManifest.audio('dev.pocketstation.example.collector.v1'),
  factory: () => new PreparedCollector(),
});

const session = new Session({ frameDurationMs: 10 });
const input = session.audioInput('advanced-endpoint-example');
const registered = session.registerEndpoint(collector);
input.output.send(registered.declare({ destination: 'memory' }));
input.tryWrite(new Float32Array(480).fill(0.25));
input.close();

const running = await session.start();
for (let attempt = 0; received.length === 0 && attempt < 100; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const stopped = await running.stop();
if (!stopped.success || received.length !== 1) {
  throw new Error('advanced Endpoint example did not deliver its frame');
}

console.log(registered.observations());
