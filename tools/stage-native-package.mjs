import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const addons = readdirSync('native-dist').filter((name) => name.endsWith('.node'));
if (addons.length !== 1) throw new Error('Expected exactly one freshly built native addon');
const binary = addons[0];
const target = binary.slice('pocketstation-js.'.length, -'.node'.length);
const directory = join('npm', target);
const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
if (manifest.main !== binary || root.optionalDependencies[manifest.name] !== manifest.version) {
  throw new Error('Native package identity does not match root optional dependency');
}
cpSync(join('native-dist', binary), join(directory, binary));
cpSync('LICENSE', join(directory, 'LICENSE'));
cpSync('THIRD_PARTY_NOTICES.md', join(directory, 'THIRD_PARTY_NOTICES.md'));
writeFileSync(join(directory, 'README.md'),
  `# ${manifest.name}\n\nNative addon for pocketstation ${manifest.version} on ${target}.\n`
  + 'Install the pocketstation package to use the public API.\n');
if (process.argv.includes('--install')) {
  const installed = join('node_modules', manifest.name);
  mkdirSync(installed, { recursive: true });
  for (const file of ['package.json', binary, 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md']) {
    cpSync(join(directory, file), join(installed, file));
  }
}
console.log(`Staged ${manifest.name}@${manifest.version}`);
