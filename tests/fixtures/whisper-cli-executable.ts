/** MOCKED model protocol in a real owned executable on every test platform. */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function createWhisperCliExecutable(directory: string, statePath = ''): Promise<string> {
  const executable = join(directory, process.platform === 'win32' ? 'mock-whisper.exe' : 'mock-whisper');
  await execute('rustc', [fileURLToPath(new URL('./whisper-cli-fixture.rs', import.meta.url)),
    '--edition=2021', '-C', 'opt-level=1', '-o', executable], {
    env: { ...process.env, PKS_MOCK_WHISPER_STATE_PATH: statePath }, timeout: 30_000,
  });
  return executable;
}
