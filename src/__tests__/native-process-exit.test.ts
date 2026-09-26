import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(
  new URL('../../tests/fixtures/provider-process-exit.mjs', import.meta.url),
);

describe('native JavaScript provider lifetime', () => {
  it('does not keep Node alive after a provider is registered', () => {
    const output = execFileSync(process.execPath, [fixture], {
      encoding: 'utf8',
      timeout: 5_000,
    });

    expect(output).toBe('registered\n');
  });
});
