import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = readdirSync(join(root, 'examples'))
  .filter((name) => name.endsWith('.ts'))
  .sort();
const smoke = readdirSync(join(root, 'tests', 'fixtures', 'sdk-example-smoke'))
  .filter((name) => name.endsWith('.ts'))
  .sort();

for (const example of examples) {
  const compiled = join(root, '.examples-dist', example.replace(/\.ts$/, '.js'));
  const checked = spawnSync(process.execPath, ['--check', compiled], {
    encoding: 'utf8',
  });
  if (checked.status !== 0) {
    process.stderr.write(checked.stderr);
    process.exit(checked.status ?? 1);
  }
}

for (const fixture of smoke) {
  const compiled = join(root, '.smoke-dist', fixture.replace(/\.ts$/, '.js'));
  const executed = spawnSync(process.execPath, [compiled], {
    cwd: root,
    encoding: 'utf8',
  });
  if (executed.status !== 0) {
    process.stdout.write(executed.stdout);
    process.stderr.write(executed.stderr);
    process.exit(executed.status ?? 1);
  }
}

console.log(`examples: PASS (${examples.length} public examples compiled, ${smoke.length} internal Core fixtures executed; live examples require real devices and services)`);
