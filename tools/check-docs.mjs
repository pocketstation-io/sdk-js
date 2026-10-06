import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forbiddenPublicDirectories = ['docs/architecture', 'docs/adr', 'docs/standards'];
const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter(Boolean);

for (const directory of forbiddenPublicDirectories) {
  if (tracked.some((path) => path.startsWith(`${directory}/`))) {
    throw new Error(`${directory} contains maintainer material in the public documentation set`);
  }
}

// Local ignored engineering records are not the public documentation set.
const files = tracked.filter((path) => path === 'README.md'
  || (path.startsWith('docs/') && path.endsWith('.md'))).map((path) => join(root, path));
const failures = [];

for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const path = target.split('#', 1)[0];
    if (path.length === 0) continue;
    const resolved = resolve(dirname(file), path);
    const relative = resolved.slice(root.length + 1);
    const published = tracked.includes(relative)
      || tracked.some((entry) => entry.startsWith(`${relative}/`));
    if (!existsSync(resolved) || !published) {
      failures.push(`${file.slice(root.length + 1)} -> ${target}`);
    }
  }
}

if (failures.length !== 0) {
  throw new Error(`Broken documentation links:\n${failures.join('\n')}`);
}

console.log(`documentation: PASS (${files.length} Markdown files)`);
