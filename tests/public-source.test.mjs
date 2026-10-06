import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
