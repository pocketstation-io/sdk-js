import { readFileSync } from 'node:fs';
import {
  RuntimeCompatibility,
  runtimeCompatibility,
} from '../compatibility.js';

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, new URL('../../', import.meta.url)), 'utf8');
}

describe('runtime compatibility', () => {
  it('matches the package and native dependency versions', () => {
    const manifest = JSON.parse(read('package.json')) as {
      version: string;
      engines: { node: string };
    };
    const cargoManifest = read('native/Cargo.toml');

    expect(runtimeCompatibility.sdkVersion).toBe(manifest.version);
    expect(runtimeCompatibility.nodeRequires).toBe(manifest.engines.node);
    const coreVersion = cargoManifest.match(
      /^pocketstation\s*=\s*\{[^\n}]*\bversion\s*=\s*"([^"]+)"/m,
    )?.[1];
    expect(coreVersion).toBe(`=${runtimeCompatibility.coreVersion}`);
    expect(cargoManifest).toContain(
      `pocketstation-relay = "=${runtimeCompatibility.relayConnectorVersion}"`,
    );
    expect(cargoManifest).toContain(
      `features = ["${runtimeCompatibility.nativeAbi}", "tokio_rt"]`,
    );
    expect(runtimeCompatibility.nodeApiVersion).toBe(8);
    expect(Object.isFrozen(runtimeCompatibility)).toBe(true);
  });

  it('rejects invalid compatibility declarations', () => {
    expect(() => new RuntimeCompatibility({
      sdkVersion: '',
      coreVersion: '1.1.10',
      relayConnectorVersion: '0.1.5',
      nodeRequires: '>=20.17',
      nodeApiVersion: 8,
      nativeAbi: 'napi8',
    })).toThrow('sdkVersion must be a non-empty string');
    expect(() => new RuntimeCompatibility({
      sdkVersion: '0.1.0',
      coreVersion: '1.1.10',
      relayConnectorVersion: '0.1.5',
      nodeRequires: '>=20.17',
      nodeApiVersion: 0,
      nativeAbi: 'napi8',
    })).toThrow('nodeApiVersion must be a positive safe integer');
  });
});
