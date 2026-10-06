import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

// Jest's locked YAML parser is already installed with the development tools.
const { load } = createRequire(import.meta.url)('js-yaml');
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const workflow = (name) => load(readFileSync(
  new URL(`.github/workflows/${name}.yml`, root), 'utf8',
));

function expandScripts(command, stack = []) {
  return command.replace(/npm run ([\w:-]+)/g, (_match, name) => {
    assert.ok(!stack.includes(name), `recursive npm script: ${name}`);
    assert.equal(typeof manifest.scripts[name], 'string', `missing script: ${name}`);
    return expandScripts(manifest.scripts[name], [...stack, name]);
  });
}

test('source CI compiles each addon variant once and keeps every package gate', () => {
  const ci = workflow('ci');
  const job = ci.jobs.package;
  assert.deepEqual(job.strategy.matrix.os, [
    'ubuntu-latest', 'macos-latest', 'windows-latest',
  ]);
  assert.deepEqual(job.strategy.matrix.node, [20, 22]);
  const commands = job.steps.map((step) => expandScripts(step.run ?? '')).join('\n');
  const addonBuilds = commands.match(/\bnapi build[^\n&]+/g) ?? [];
  assert.equal(addonBuilds.length, 2);
  assert.equal(addonBuilds.filter((command) => command.includes('--features conformance-fixtures')).length, 1);
  assert.match(commands, /jest\/bin\/jest\.js/);
  assert.match(commands, /tests\/demo-cli\.mjs/);
  assert.match(commands, /tests\/performance-statistics\.mjs/);
  assert.match(commands, /tests\/package-resolution\.mjs/);
  assert.match(commands, /tools\/test-packed-consumer\.mjs/);
  assert.match(commands, /tests\/package-assembly\.mjs/);
  assert.ok(commands.indexOf('jest/bin/jest.js') < commands.indexOf('tests/package-resolution.mjs'));
  assert.ok(job.steps.some((step) => step.run === 'npm run build:native'));
  assert.ok(job.steps.some((step) => step.run === 'npm run test:packed:built'),
    'Windows package consumers need npm_execpath from an npm script');
  assert.ok(job.steps.some((step) => step.run === 'npm run native:check'));
  assert.ok(job.steps.some((step) => step.run === 'npm run api:check'));
  assert.ok(job.steps.some((step) => step.run === 'npm audit --omit=dev'));
  for (const name of ['build:native', 'build:test-native', 'build:native:aec', 'build:test-native:aec']) {
    assert.match(manifest.scripts[name], /-- --locked &&/);
  }
});

test('source CI bounds obsolete and failed runs without skipping required jobs', () => {
  const ci = workflow('ci');
  assert.equal(ci.concurrency['cancel-in-progress'], true);
  assert.ok(ci.concurrency.group.includes('github.ref'));
  assert.equal(ci.jobs.package.strategy['fail-fast'], true);
  for (const job of Object.values(ci.jobs)) {
    assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 25);
    assert.ok(!job['continue-on-error']);
    assert.ok(!job.if, 'source checks cannot become optional to appear green');
  }
});

test('archive qualification is deliberate and publication still verifies frozen bytes', () => {
  const qualification = workflow('qualify-distribution');
  assert.deepEqual(Object.keys(qualification.on), ['workflow_dispatch']);
  assert.equal(qualification.jobs.native.strategy['fail-fast'], true);
  assert.equal(qualification.jobs.consumers.strategy['fail-fast'], true);
  assert.deepEqual(qualification.jobs.verify.needs, ['root', 'native', 'consumers']);
  const publish = workflow('publish');
  const commands = publish.jobs.publish.steps.map((step) => step.run ?? '').join('\n');
  assert.match(commands, /prepare-npm-release\.py/);
  assert.match(commands, /--manifest-sha256/);
  assert.match(commands, /publish-qualified\.mjs/);
});

test('source and archive builds reject private files before installs and pin only the build CLI', () => {
  for (const job of Object.values(workflow('ci').jobs)) {
    const check = job.steps.findIndex((step) => step.run === 'node tools/check-public-source.mjs');
    const install = job.steps.findIndex((step) => /npm ci/.test(step.run ?? ''));
    assert.ok(check >= 0 && check < install);
  }
  const qualification = workflow('qualify-distribution');
  for (const name of ['root', 'native']) {
    const steps = qualification.jobs[name].steps;
    const check = steps.findIndex((step) => step.run === 'node tools/check-public-source.mjs');
    const pin = steps.findIndex((step) => step.run === 'npm install --global npm@10.8.2 --ignore-scripts');
    const install = steps.findIndex((step) => step.run === 'npm ci --ignore-scripts');
    assert.ok(check >= 0 && check < pin && pin < install);
  }
  const publishing = workflow('publish').jobs.publish.steps;
  assert.ok(publishing.some((step) => step.run === 'npm install --global npm@11.9.0 --ignore-scripts'),
    'publishing keeps its OIDC-capable CLI');
});
