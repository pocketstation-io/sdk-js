import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validatePlan, requireExactRegistryArtifact } from '../tools/publish-qualified.mjs';

const names = ['darwin-arm64', 'darwin-x64', 'win32-arm64-msvc', 'win32-x64-msvc',
  'linux-arm64-gnu', 'linux-x64-gnu'].map((id) => `@pocketstation/native-${id}`).concat('pocketstation');

test('publication rejects reordered, replaced or incomplete qualified archives', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pks-publish-test-'));
  try {
    const data = Buffer.from('Synthetic verifier input, never a publishable npm archive.');
    const packages = names.map((name, index) => {
      const archive = `${index}.tgz`;
      writeFileSync(join(directory, archive), data);
      return { name, version: '0.1.5', archive, sha256: createHash('sha256').update(data).digest('hex') };
    });
    const plan = { schema: 1, sourceCommit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64),
      version: '0.1.5', packages };
    assert.doesNotThrow(() => validatePlan(plan, directory));
    for (const mutate of [
      (p) => p.packages.reverse(),
      (p) => p.packages.pop(),
      (p) => { p.packages[0].sha256 = 'c'.repeat(64); },
      (p) => { p.packages[0].version = '0.1.3'; },
      (p) => { p.packages[0].archive = '../outside.tgz'; },
      (p) => { p.sourceCommit = 'unknown'; },
      (p) => { p.manifestSha256 = 'unknown'; },
    ]) {
      const altered = structuredClone(plan);
      mutate(altered);
      assert.throws(() => validatePlan(altered, directory));
    }
    writeFileSync(join(directory, '0.tgz'), 'replaced');
    assert.throws(() => validatePlan(plan, directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('retry accepts only the identical already published version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pks-registry-test-'));
  try {
    const archive = join(directory, 'fixture.tgz');
    const data = Buffer.from('Synthetic registry integrity fixture.');
    writeFileSync(archive, data);
    const integrity = `sha512-${createHash('sha512').update(data).digest('base64')}`;
    assert.doesNotThrow(() => requireExactRegistryArtifact({ dist: { integrity } }, archive));
    assert.throws(() => requireExactRegistryArtifact({ dist: { integrity: 'different' } }, archive));
    assert.throws(() => requireExactRegistryArtifact({}, archive));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
