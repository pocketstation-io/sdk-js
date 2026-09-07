import { readFileSync } from 'node:fs';

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, new URL('../../', import.meta.url)), 'utf8');
}

describe('package structure', () => {
  it('Given the package manifest When inspected Then browser and Node exports stay separate', () => {
    const manifest = JSON.parse(read('package.json')) as {
      exports: Record<string, { import: string; types: string }>;
    };

    expect(Object.keys(manifest.exports)).toEqual(['.', './node', './browser']);
    expect(manifest.exports['./node']).toEqual({
      types: './dist/node/index.d.ts',
      import: './dist/node/index.js',
    });
    expect(manifest.exports['./browser']).toEqual({
      types: './dist/browser/index.d.ts',
      import: './dist/browser/index.js',
    });
  });

  it('Given the browser build When inspected Then it never imports Node or the native addon', () => {
    const browser = read('dist/browser/index.js');

    expect(browser).not.toContain('node:');
    expect(browser).not.toContain('native-dist');
    expect(browser).not.toContain('../node');
  });

  it('Given public Node declarations When inspected Then native handles are not exposed', () => {
    const declarations = read('dist/node/session.d.ts');

    expect(declarations).not.toContain('NativeSessionHandle');
    expect(declarations).not.toContain('NativeStemHandle');
    expect(declarations).not.toContain('NativeEndpointHandle');
    expect(declarations).toContain('private constructor');
  });

  it('Given the native entry module When inspected Then it only registers owning modules', () => {
    const nativeEntry = read('native/src/lib.rs')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nativeEntry).toEqual([
      'mod application_audio;',
      'mod errors;',
      'mod extensions;',
      'mod graph;',
      'mod provider;',
      'mod session;',
      'mod sidecar;',
      'mod signals;',
      'mod sources;',
      'mod streams;',
    ]);
  });
});
