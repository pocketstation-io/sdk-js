import {
  Connector,
  ConnectorConfigurationField,
  ConnectorConfigurationSchema,
  ConnectorDriver,
  ConnectorManifest,
  ConnectorConfigurationValue,
  ConnectorDeliveryOutcome,
  Session,
  type ConnectorContext,
  type ConnectorItem,
} from 'pocketstation/node';

const configuration = new ConnectorConfigurationSchema([
  new ConnectorConfigurationField({
    name: 'token',
    kind: 'secret',
    documentation: 'Credential owned by the example provider.',
  }),
]);

const manifest = ConnectorManifest.audio(
  'dev.pocketstation.example.archive.v1',
  { packageVersion: '1.0.0', configuration },
);

const received: bigint[] = [];
const archive = Connector.withDriver(manifest, async (inputs) => {
  const token = inputs[0]?.configuration.token?.exposeSecret();
  if (token !== 'local-example') throw new Error('credential rejected');
  return new (class extends ConnectorDriver {
    start(context: ConnectorContext) {
      context.setReady();
    }

    deliver(item: ConnectorItem) {
      if (item.kind === 'audio') received.push(item.audio.sequenceNumber);
      return ConnectorDeliveryOutcome.Delivered;
    }
  })();
});

const session = new Session({ frameDurationMs: 10 });
const input = session.audioInput('advanced-connector-example');
const registered = session.registerConnector(archive);
const endpoint = registered.declare({
  token: ConnectorConfigurationValue.secret('local-example'),
});
input.output.send(endpoint);
input.tryWrite(new Float32Array(480));
input.close();

const running = await session.start();
for (let attempt = 0; received.length === 0 && attempt < 100; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const stopped = await running.stop();
if (!stopped.success || received.length !== 1) {
  throw new Error('advanced Connector example did not deliver its frame');
}

console.log(registered.observations());
