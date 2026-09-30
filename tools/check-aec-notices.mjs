import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const filename = 'THIRD_PARTY_NOTICES.md';
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const notice = readFileSync(filename, 'utf8');
assert.ok(root.files.includes(filename), 'Root package must distribute the AEC notices');
for (const component of ['WebRTC', 'Abseil C++ 20240722.0', 'PFFFT', 'Ooura', 'RNNoise']) {
  assert.ok(notice.includes(component), `Missing AEC notice: ${component}`);
}
for (const target of readdirSync('npm')) {
  const directory = `npm/${target}`;
  const manifest = JSON.parse(readFileSync(`${directory}/package.json`, 'utf8'));
  assert.ok(manifest.files.includes(filename), `${target} must distribute the AEC notices`);
  assert.equal(readFileSync(`${directory}/${filename}`, 'utf8'), notice,
    `${target} notices differ from the reviewed source`);
}
console.log('AEC source and native package notices: PASS');
