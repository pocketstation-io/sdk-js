import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ExtensionAbiVersion,
  ExtensionDescriptor,
  ExtensionError,
  ExtensionPort,
  ExtensionPortDirection,
  ExtensionKind,
  Session,
} from '../node/index.js';

const SOURCE_ID = 'dev.pocketstation.source.javascript-fixture.v1';
const OPERATOR_ID = 'dev.pocketstation.javascript-fixture.operator.v1';
const ENDPOINT_ID = 'dev.pocketstation.javascript-fixture.endpoint.v1';
const SIGNAL_ID = 'dev.pocketstation.javascript-fixture.signal.v1';
const SCHEMA = 'urn:pocketstation:javascript-extension-fixture:v1';
const CONSUMER = fileURLToPath(new URL('../../tests/fixtures/native-extension-consumer.mjs', import.meta.url));
const ENTRY = new URL('../../dist/node/index.js', import.meta.url).href;
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
    expect(abi.abiMajor).toBe(1);
    expect(abi.abiMinor).toBeGreaterThanOrEqual(2);
    expect(abi.structSizeBytes).toBeGreaterThan(0);
    expect(() => abi.requireCompatible()).not.toThrow();
    expect(ExtensionKind).toEqual({
      SOURCE: 'source',
      OPERATOR: 'operator',
      ENDPOINT: 'endpoint',
    });
    expect(ExtensionPortDirection).toEqual({ INPUT: 'input', OUTPUT: 'output' });

    const descriptor = new ExtensionDescriptor({
      extensionId: SOURCE_ID,
      kind: ExtensionKind.SOURCE,
      ports: [
        new ExtensionPort({
          name: 'out',
          direction: ExtensionPortDirection.OUTPUT,
          signalId: SIGNAL_ID,
          semanticRole: 'fixture-output',
          schema: SCHEMA,
        }),
      ],
    });
    expect(descriptor.extensionId).toBe(SOURCE_ID);
    expect(descriptor.abiMajor).toBe(1);
    expect(descriptor.abiMinor).toBe(abi.abiMinor);
    expect(descriptor.abi.abiMajor).toBe(1);
    expect(descriptor.ports).toHaveLength(1);
    expect(descriptor.ports[0]?.semanticRole).toBe('fixture-output');
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.ports)).toBe(true);
  });

  it('keeps the previous descriptor spellings as checked compatibility aliases', () => {
    const descriptor = new ExtensionDescriptor({
      id: SOURCE_ID,
      kind: 'source',
      ports: [
        new ExtensionPort({
          name: 'out',
          direction: 'output',
          signalId: SIGNAL_ID,
          role: 'legacy-role',
        }),
      ],
    });

    expect(descriptor.id).toBe(descriptor.extensionId);
    expect(descriptor.abi.major).toBe(descriptor.abiMajor);
    expect(descriptor.abi.minor).toBe(descriptor.abiMinor);
    expect(descriptor.ports[0]?.role).toBe('legacy-role');
    expect(
      () =>
        new ExtensionDescriptor({
          extensionId: SOURCE_ID,
          id: 'dev.pocketstation.source.other.v1',
          kind: 'source',
          ports: [],
        }),
    ).toThrow(TypeError);
  });

  it('rejects a relative library path before loading native code', async () => {
    await expect(
      new Session().loadNativeExtensionLibrary('fixture-extension'),
    ).rejects.toBeInstanceOf(ExtensionError);
  });

  it('loads a real library and runs its Source, Operator, and Endpoint', async () => {
    const result = JSON.parse(execFileSync(process.execPath,
      [CONSUMER, ENTRY, LIBRARY, MARKER, 'capture'], { encoding: 'utf8', timeout: 5_000 }));
    const receipt = result.receipt;
    // Compare actual file identity, including Windows short-name/path aliases.
    const actual = statSync(receipt.canonicalPath, { bigint: true });
    const expected = statSync(LIBRARY, { bigint: true });
    expect([actual.dev, actual.ino]).toEqual([expected.dev, expected.ino]);
    expect(receipt.registrations).toEqual([
      { id: SOURCE_ID, kind: 'source', revision: 1, generation: 1 },
      { id: OPERATOR_ID, kind: 'operator', revision: 1, generation: 1 },
      { id: ENDPOINT_ID, kind: 'endpoint', revision: 1, generation: 1 },
    ]);

    expect(result.text).toBe(
      'hello from native extension',
    );
    expect(result.lineageSourceId).toBe(result.sourceId);
    expect(result.success).toBe(true);
    expect(existsSync(MARKER)).toBe(true);
    expect(readFileSync(MARKER, 'utf8')).toContain(
      'consume:hello from native extension',
    );
  });

  it('rejects duplicate registrations without partially changing the Session', async () => {
    const result = JSON.parse(execFileSync(process.execPath,
      [CONSUMER, ENTRY, LIBRARY, MARKER, 'duplicate'], { encoding: 'utf8', timeout: 5_000 }));
    expect(result.code).toBe('extension.duplicate_registration');
  });
});
