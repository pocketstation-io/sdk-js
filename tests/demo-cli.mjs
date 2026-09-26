import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);

const help = run('--help');
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /Usage: pocketstation-demo/);
assert.match(help.stdout, /--microphone/);
assert.match(help.stdout, /--relay/);
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
