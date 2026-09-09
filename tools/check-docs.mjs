import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forbiddenPublicDirectories = ['docs/architecture', 'docs/adr', 'docs/standards'];

for (const directory of forbiddenPublicDirectories) {
  const path = join(root, directory);
  if (existsSync(path) && readdirSync(path).length !== 0) {
    throw new Error(`${directory} contains maintainer material in the public documentation set`);
  }
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

const files = [join(root, 'README.md'), ...markdownFiles(join(root, 'docs'))];
const failures = [];

for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const path = target.split('#', 1)[0];
    if (path.length === 0) continue;
    if (!existsSync(resolve(dirname(file), path))) {
      failures.push(`${file.slice(root.length + 1)} -> ${target}`);
    }
  }
}

if (failures.length !== 0) {
  throw new Error(`Broken documentation links:\n${failures.join('\n')}`);
}

console.log(`documentation: PASS (${files.length} Markdown files)`);
