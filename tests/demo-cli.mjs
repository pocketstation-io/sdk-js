import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);

const help = run('--help');
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /Usage: pocketstation-demo/);
assert.match(help.stdout, /--microphone/);
assert.match(help.stdout, /--no-gpu/);
assert.match(help.stdout, /--gpu/);
const conflictingBackend = run('--gpu', '--no-gpu');
assert.equal(conflictingBackend.status, 1);
assert.match(conflictingBackend.stderr, /--gpu and --no-gpu conflict/);
assert.match(help.stdout, /--relay/);
assert.match(help.stdout, /--show-links\s+print credential-bearing/);
assert.match(help.stdout, /--show-private-links\s+deprecated alias/);
assert.match(help.stdout, /--model <path>/);
assert.match(help.stdout, /--whisper-cli <path>/);
assert.match(help.stdout, /PKS_WHISPER_MODEL/);
assert.match(help.stdout, /POCKETSTATION_CONTROL_PLANE_URL/);
assert.doesNotMatch(help.stdout, /POCKETSTATION_CONTROL_URL/);

const missingModel = run('Example Application');
assert.equal(missingModel.status, 1);
assert.equal(missingModel.stdout, '');
assert.match(missingModel.stderr, /^pocketstation-demo: a local Whisper model is required;/);
assert.doesNotMatch(missingModel.stderr, /\n\s+at /);

const missingModelValue = run('Example Application', '--model');
assert.equal(missingModelValue.status, 1);
assert.match(missingModelValue.stderr, /^pocketstation-demo: --model requires a value/);

const invalidFrameLimit = run(
  'Example Application',
  '--model',
  '/not-opened-because-frames-fail-first',
  '--frames',
  '0',
);
assert.equal(invalidFrameLimit.status, 1);
assert.match(invalidFrameLimit.stderr, /^pocketstation-demo: --frames must be a positive safe integer/);

const unknownOption = run('Example Application', '--not-an-option');
assert.equal(unknownOption.status, 1);
assert.match(unknownOption.stderr, /^pocketstation-demo: unknown option: --not-an-option/);

const unreadableModel = run('Example Application', '--model', '/does/not/exist/ggml.bin');
assert.equal(unreadableModel.status, 1);
assert.match(
  unreadableModel.stderr,
  /^pocketstation-demo: cannot read local Whisper model at \/does\/not\/exist\/ggml\.bin/,
);

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'pks-demo-cli-'));
try {
  const model = join(temporaryDirectory, 'model.bin');
  writeFileSync(model, 'local model fixture');
  const missingExecutable = run(
    'Example Application',
    '--model', model,
    '--whisper-cli', join(temporaryDirectory, 'missing-whisper-cli'),
  );
  assert.equal(missingExecutable.status, 1);
  assert.match(
    missingExecutable.stderr,
    /^pocketstation-demo: cannot execute local whisper\.cpp CLI/,
  );
  assert.doesNotMatch(missingExecutable.stderr, /\n\s+at /);

  // Deterministic lifecycle regression, explicitly mocked: real media is a Lab gate.
  for (const mode of ['redacted', 'exposed', 'legacy-exposed', 'early-stream', 'failed-outcome',
    'close-failure', 'receiver-failure']) {
    const trace = join(temporaryDirectory, `${mode}.txt`);
    writeFileSync(trace, '');
    const result = spawnSync(process.execPath, [
      '--experimental-loader', './tests/fixtures/demo-cli/loader.mjs',
      'bin/pocketstation-demo.mjs', 'Test App', '--model', model,
      '--whisper-cli', process.execPath, '--no-gpu', '--microphone', '--relay', '--frames', '4',
      ...(mode === 'exposed' ? ['--show-links'] : []),
      ...(mode === 'legacy-exposed' ? ['--show-private-links'] : []),
    ], {
      cwd: root, encoding: 'utf8', timeout: 5_000,
      env: { ...process.env, PKS_DEMO_TEST_MODE: mode, PKS_DEMO_TEST_TRACE: trace },
    });
    assert.equal(result.error, undefined, `${mode}: ${result.error}`);
    assert.equal(result.status, ['redacted', 'exposed', 'legacy-exposed'].includes(mode) ? 0 : 1,
      `${mode}: ${result.stderr}`);
    const events = readFileSync(trace, 'utf8');
    if (['redacted', 'exposed', 'legacy-exposed', 'failed-outcome'].includes(mode)) {
      assert.match(result.stdout, /Model input 1: 2 dropped frames, 1 discontinuities/);
    }
    assert.match(events, /capture-close\nremote-close/);
    if (mode !== 'early-stream') {
      assert.match(events, /invite:application\ninvite:microphone/);
    }
    if (['exposed', 'legacy-exposed'].includes(mode)) {
      assert.match(result.stdout, /Listen live \(application\): https:.*application-words#private-secret/);
      assert.match(result.stdout, /Listen live \(microphone\): https:.*microphone-words#private-secret/);
    } else {
      assert.doesNotMatch(result.stdout + result.stderr, /#private-secret/);
    }
    if (mode === 'early-stream') assert.match(result.stderr, /audio stream ended/);
    if (mode === 'failed-outcome') assert.match(result.stderr, /capture finalization failed/);
    if (mode === 'receiver-failure') assert.match(events, /cancel/);
  }

} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function run(...arguments_) {
  return spawnSync(
    process.execPath,
    ['bin/pocketstation-demo.mjs', ...arguments_],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PKS_WHISPER_MODEL: '',
        PKS_WHISPER_CLI: '',
      },
    },
  );
}
