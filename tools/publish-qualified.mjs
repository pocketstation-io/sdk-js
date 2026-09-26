// Publish only an independently verified, explicit archive plan. Never build here.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

export function validatePlan(plan, base) {
  assert.equal(plan.schema, 1);
  assert.match(plan.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(plan.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.packages.length, 7);
  const targets = JSON.parse(readFileSync(new URL('./native-matrix.json', import.meta.url))).targets;
  const names = targets.map((row) => `@pocketstation/native-${row.id}`).concat('pocketstation');
  for (const [index, pkg] of plan.packages.entries()) {
    assert.equal(pkg.name, names[index], 'Native archives must precede root publication');
    assert.equal(pkg.version, plan.version);
    assert.match(pkg.sha256, /^[a-f0-9]{64}$/);
    const archive = resolve(base, pkg.archive);
    assert.ok(archive.startsWith(resolve(base) + sep));
    assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), pkg.sha256);
  }
}

function registryVersion(name, version) {
  const result = spawnSync('npm', ['view', `${name}@${version}`, '--json', '--registry=https://registry.npmjs.org'],
    { encoding: 'utf8', timeout: 60000 });
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout);
  let failure;
  try { failure = JSON.parse(result.stdout); } catch { /* npm also writes diagnostics on stderr. */ }
  if (failure?.error?.code === 'E404') return null;
  throw new Error(`Registry lookup failed for ${name}@${version}: ${result.stderr}`);
}

export function requireExactRegistryArtifact(metadata, archive) {
  const expected = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
  assert.equal(metadata.dist?.integrity, expected, 'An existing public version has different bytes');
}

async function main() {
  const [planPath, receiptPath, action] = process.argv.slice(2);
  assert.ok(['--verify-only', '--publish'].includes(action));
  const plan = JSON.parse(readFileSync(planPath));
  const base = dirname(resolve(planPath));
  validatePlan(plan, base);
  const receipt = { schema: 1, sourceCommit: plan.sourceCommit, manifestSha256: plan.manifestSha256,
    action, complete: false, packages: [] };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  if (action === '--publish') {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Publication is restricted to CI');
    assert.equal(process.env.GITHUB_REF, `refs/tags/v${plan.version}`, 'Publish the qualified release tag only');
    assert.equal(process.env.GITHUB_SHA, plan.sourceCommit);
  }
  for (const pkg of plan.packages) {
    const archive = resolve(base, pkg.archive);
    if (action === '--verify-only') {
      execFileSync('npm', ['publish', archive, '--dry-run', '--ignore-scripts', '--access=public',
        '--registry=https://registry.npmjs.org'], { stdio: 'inherit', timeout: 60000 });
      receipt.packages.push({ name: pkg.name, version: pkg.version, sha256: pkg.sha256, status: 'dry-run' });
    } else {
      let metadata = registryVersion(pkg.name, pkg.version);
      const existed = metadata !== null;
      if (!metadata) {
        execFileSync('npm', ['publish', archive, '--ignore-scripts', '--access=public',
          '--registry=https://registry.npmjs.org'], { stdio: 'inherit', timeout: 120000 });
        // Allow bounded registry propagation; every successful upload must resolve to identical bytes.
        for (let attempt = 0; attempt < 6; attempt += 1) {
          metadata = registryVersion(pkg.name, pkg.version);
          if (metadata) break;
          await new Promise((done) => setTimeout(done, 5000));
        }
        assert.ok(metadata, `Published version did not become visible: ${pkg.name}`);
      }
      requireExactRegistryArtifact(metadata, archive);
      receipt.packages.push({ name: pkg.name, version: pkg.version, sha256: pkg.sha256,
        integrity: metadata.dist.integrity, status: existed ? 'existing-identical' : 'published' });
    }
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
  receipt.complete = true;
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
