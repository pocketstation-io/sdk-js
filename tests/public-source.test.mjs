import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { privateDevelopmentPaths } from '../tools/check-public-source.mjs';

test('ignored but committed engineering files are rejected and local copies survive removal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pks-public-source-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
  try {
    git('init', '-q');
    git('config', 'user.name', 'Source Test');
    git('config', 'user.email', 'source@pocketstation.invalid');
    writeFileSync(join(directory, '.gitignore'), '/PHASE5_PROGRESS.md\n/AGENTS.md\n');
    writeFileSync(join(directory, 'README.md'), 'Public developer guide\n');
    writeFileSync(join(directory, 'AGENTS.md'), 'Private fixture\n');
    writeFileSync(join(directory, 'PHASE5_PROGRESS.md'), 'Private fixture\n');
    git('add', '.gitignore', 'README.md');
    git('add', '-f', 'AGENTS.md', 'PHASE5_PROGRESS.md');
    git('commit', '-qm', 'reproduce tracked ignored records');
    assert.deepEqual(privateDevelopmentPaths(directory), ['AGENTS.md', 'PHASE5_PROGRESS.md']);
    git('rm', '--cached', 'AGENTS.md', 'PHASE5_PROGRESS.md');
    git('commit', '-qm', 'keep private records local');
    assert.deepEqual(privateDevelopmentPaths(directory), []);
    assert.ok(existsSync(join(directory, 'AGENTS.md')));
    assert.ok(existsSync(join(directory, 'PHASE5_PROGRESS.md')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('trusting a container checkout restores Git access without bypassing private-file rejection', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'pks-source-ownership-')));
  const environment = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(directory, 'isolated-global.config'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (...args) => execFileSync('git', args, {
    cwd: directory, env: environment, stdio: 'pipe',
  });
  const guard = () => spawnSync(process.execPath, [
    fileURLToPath(new URL('../tools/check-public-source.mjs', import.meta.url)),
  ], { cwd: directory, env: environment, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.name', 'Ownership Test');
    git('config', 'user.email', 'source@pocketstation.invalid');
    writeFileSync(join(directory, '.gitignore'), '/AGENTS.md\n/isolated-global.config\n');
    writeFileSync(join(directory, 'README.md'), 'Public developer guide\n');
    git('add', '.gitignore', 'README.md');
    git('commit', '-qm', 'public fixture');

    environment.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1';
    const untrusted = guard();
    assert.equal(untrusted.status, 1);
    assert.match(untrusted.stderr, /dubious ownership/);

    git('config', '--global', '--add', 'safe.directory', directory);
    const trusted = guard();
    assert.equal(trusted.status, 0, trusted.stderr);
    assert.match(trusted.stdout, /public source: PASS/);

    writeFileSync(join(directory, 'AGENTS.md'), 'Private fixture\n');
    git('add', '-f', 'AGENTS.md');
    git('commit', '-qm', 'force-track a private fixture');
    const leaked = guard();
    assert.equal(leaked.status, 1);
    assert.match(leaked.stderr, /Public source contains private development records: AGENTS.md/);
    assert.equal(git('config', '--global', '--get-all', 'safe.directory').toString().trim(), directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
