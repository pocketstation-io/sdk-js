import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  EndOfStream,
  EndpointDefinition,
  ExtensionAbiVersion,
  ExtensionDescriptor,
  ExtensionError,
  ExtensionPort,
  Operator,
  Session,
  SignalSpec,
} from '../node/index.js';

const SOURCE_ID = 'dev.pocketstation.source.javascript-fixture.v1';
const OPERATOR_ID = 'dev.pocketstation.javascript-fixture.operator.v1';
const ENDPOINT_ID = 'dev.pocketstation.javascript-fixture.endpoint.v1';
const SIGNAL_ID = 'dev.pocketstation.javascript-fixture.signal.v1';
const SCHEMA = 'urn:pocketstation:javascript-extension-fixture:v1';
const FIXTURE = fileURLToPath(
  new URL('../../tests/fixtures/native-extension-plugin.rs', import.meta.url),
);
const DIRECTORY = mkdtempSync(join(tmpdir(), 'pocketstation-js-extension-'));
const MARKER = join(DIRECTORY, 'lifecycle.log');
const LIBRARY = join(
  DIRECTORY,
  process.platform === 'win32'
    ? 'pocketstation_fixture.dll'
    : process.platform === 'darwin'
      ? 'libpocketstation_fixture.dylib'
      : 'libpocketstation_fixture.so',
);

beforeAll(() => {
  execFileSync(
    'rustc',
    [FIXTURE, '--edition=2021', '--crate-type=cdylib', '-O', '-o', LIBRARY],
    {
      env: { ...process.env, PKS_FIXTURE_MARKER: MARKER },
    },
  );
});

afterAll(() => {
  rmSync(DIRECTORY, { recursive: true, force: true });
});

describe('native extensions', () => {
  it('reports and validates the linked Extension ABI', () => {
    const abi = ExtensionAbiVersion.current();
    expect(abi.major).toBe(1);
    expect(abi.minor).toBeGreaterThanOrEqual(2);
    expect(abi.structSizeBytes).toBeGreaterThan(0);
    expect(() => abi.requireCompatible()).not.toThrow();

    const descriptor = new ExtensionDescriptor({
      id: SOURCE_ID,
      kind: 'source',
      ports: [
        new ExtensionPort({
          name: 'out',
          direction: 'output',
          signalId: SIGNAL_ID,
          schema: SCHEMA,
        }),
      ],
    });
    expect(descriptor.abi.major).toBe(1);
    expect(descriptor.ports).toHaveLength(1);
  });

  it('rejects a relative library path before loading native code', async () => {
    await expect(
      new Session().loadNativeExtensionLibrary('fixture-extension'),
    ).rejects.toBeInstanceOf(ExtensionError);
  });

  it('loads a real library and runs its Source, Operator, and Endpoint', async () => {
    const session = new Session();
    const receipt = await session.loadNativeExtensionLibrary(LIBRARY);
    expect(receipt.canonicalPath).toBe(realpathSync(LIBRARY));
    expect(receipt.registrations).toEqual([
      { id: SOURCE_ID, kind: 'source', revision: 1, generation: 1 },
      { id: OPERATOR_ID, kind: 'operator', revision: 1, generation: 1 },
      { id: ENDPOINT_ID, kind: 'endpoint', revision: 1, generation: 1 },
    ]);

    const source = session.source(SOURCE_ID);
    const operator = session.operator(new Operator(OPERATOR_ID));
    source.output('out').connect(operator.input('in'));
    const output = operator.output('out');
    const endpoint = session.endpoint(
      new EndpointDefinition(ENDPOINT_ID, ENDPOINT_ID),
    );
    output.send(endpoint, { input: 'in' });
    const subscription = session.subscribe(output, {
      signal: SignalSpec.custom(SIGNAL_ID, { schema: SCHEMA }),
    });
    const running = await session.start();
    const received = await running
      .signals(subscription)
      .read({ timeoutMs: 1_000 });
    if (received == null || received instanceof EndOfStream) {
      throw new Error('native extension did not emit its signal');
    }
    expect(received.payload.kind).toBe('bytes');
    if (received.payload.kind !== 'bytes') throw new Error('expected bytes');
    expect(Buffer.from(received.payload.data).toString()).toBe(
      'hello from native extension',
    );
    expect(received.lineage?.sourceId).toBe(source.sourceId);
    await waitFor(() => existsSync(MARKER));
    expect((await running.stop()).success).toBe(true);
    expect(existsSync(MARKER)).toBe(true);
    expect(readFileSync(MARKER, 'utf8')).toContain(
      'consume:hello from native extension',
    );
  });

  it('rejects duplicate registrations without partially changing the Session', async () => {
    const session = new Session();
    await session.loadNativeExtensionLibrary(LIBRARY);
    await expect(
      session.loadNativeExtensionLibrary(LIBRARY),
    ).rejects.toMatchObject({
      code: 'extension.duplicate_registration',
    });
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const timeoutAt = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= timeoutAt) {
      throw new Error('native extension Endpoint did not receive its signal');
    }
    await wait(5);
  }
}
