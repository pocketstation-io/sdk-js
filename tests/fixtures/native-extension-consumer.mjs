/** Load actual native extension code in an owned process; exit releases its DLL. */
import { existsSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

const [entry, library, marker, mode] = process.argv.slice(2);
const { EndOfStream, EndpointDefinition, Operator, Session, SignalSpec } = await import(entry);
const sourceId = 'dev.pocketstation.source.javascript-fixture.v1';
const operatorId = 'dev.pocketstation.javascript-fixture.operator.v1';
const endpointId = 'dev.pocketstation.javascript-fixture.endpoint.v1';
const signalId = 'dev.pocketstation.javascript-fixture.signal.v1';
const session = new Session();
const receipt = await session.loadNativeExtensionLibrary(library);
let result;
if (mode === 'duplicate') {
  let code;
  try { await session.loadNativeExtensionLibrary(library); }
  catch (error) { code = error.code; }
  result = { receipt, code };
} else if (mode === 'capture') {
  const source = session.source(sourceId);
  const operator = session.operator(new Operator(operatorId));
  source.output('out').connect(operator.input('in'));
  const output = operator.output('out');
  output.send(session.endpoint(new EndpointDefinition(endpointId, endpointId)), { input: 'in' });
  const subscription = session.subscribe(output, { signal: SignalSpec.custom(signalId,
    { schema: 'urn:pocketstation:javascript-extension-fixture:v1' }) });
  const running = await session.start();
  try {
    const received = await running.signals(subscription).read({ timeoutMs: 1_000 });
    if (received == null || received instanceof EndOfStream || received.payload.kind !== 'bytes') {
      throw new Error('native extension did not emit its bytes signal');
    }
    const deadlineMs = performance.now() + 1_000;
    while (!existsSync(marker)) {
      if (performance.now() >= deadlineMs) throw new Error('native extension Endpoint did not receive its signal');
      await wait(5);
    }
    result = { receipt, text: Buffer.from(received.payload.data).toString(),
      sourceId: String(source.sourceId), lineageSourceId: String(received.lineage?.sourceId),
      success: (await running.stop()).success };
  } finally { await running.cancel(); }
} else { throw new Error('unknown extension fixture mode'); }
process.stdout.write(JSON.stringify(result));
