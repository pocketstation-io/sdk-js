import { readFileSync } from 'node:fs';

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, new URL('../../', import.meta.url)), 'utf8');
}

describe('package structure', () => {
  it('given dual module exports when resolved then browser and Node stay separate', () => {
    const manifest = JSON.parse(read('package.json')) as {
      exports: Record<string, {
        node: { import: string; require: string; types: string };
        default: { types: string; default: string };
      }>;
    };
    expect(Object.keys(manifest.exports)).toEqual([
      '.', './node', './browser', './control', './demo', './voice',
    ]);
    for (const [name, entry] of Object.entries(manifest.exports)) {
      const subpath = name === '.' ? 'index' : `${name.slice(2)}/index`;
      expect(entry.node.require).toBe(`./dist/cjs/${subpath}.js`);
      expect(entry.node.types).toBe(`./dist/cjs/${subpath}.d.ts`);
      expect(entry.default.default).toBe(`./dist/${subpath}.js`);
      expect(read(entry.node.import)).toContain("import api from '../cjs/");
    }
  });

  it('Given the browser build When inspected Then it never imports Node or the native addon', () => {
    const browser = read('dist/browser/index.js');

    expect(browser).not.toContain('node:');
    expect(browser).not.toContain('native-dist');
    expect(browser).not.toContain('../node');
  });

  it('Given the voice build When inspected Then it remains environment-neutral', () => {
    const voice = read('dist/voice/index.js');

    expect(voice).not.toContain('node:');
    expect(voice).not.toContain('native-dist');
    expect(voice).not.toContain('../node');
    expect(voice).not.toContain('../browser');
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
      'mod aec;',
      'mod application_audio;',
      'mod errors;',
      'mod extensions;',
      'mod graph;',
      'mod observations;',
      'mod provider;',
      'mod recording;',
      'mod session;',
      'mod sidecar;',
      'mod signals;',
      'mod sources;',
      'mod streams;',
    ]);
  });
});
