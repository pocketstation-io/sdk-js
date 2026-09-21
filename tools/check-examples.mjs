import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = readdirSync(join(root, 'examples'))
  .filter((name) => name.endsWith('.mjs'))
  .sort();

for (const example of examples) {
  const checked = spawnSync(process.execPath, ['--check', join(root, 'examples', example)], {
    encoding: 'utf8',
  });
  if (checked.status !== 0) {
    process.stderr.write(checked.stderr);
    process.exit(checked.status ?? 1);
  }
}

const coreExamples = [
  'advanced-connector.mjs',
  'advanced-endpoint.mjs',
  'advanced-operator.mjs',
  'feed-audio.mjs',
  'feed-events.mjs',
  'send-to-connector.mjs',
];

for (const example of coreExamples) {
  const executed = spawnSync(process.execPath, [join(root, 'examples', example)], {
    cwd: root,
    encoding: 'utf8',
  });
  if (executed.status !== 0) {
    process.stdout.write(executed.stdout);
    process.stderr.write(executed.stderr);
    process.exit(executed.status ?? 1);
  }
}

console.log(`examples: PASS (${examples.length} syntax, ${coreExamples.length} Core Sessions)`);
