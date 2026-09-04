import assert from 'node:assert/strict';

const node = await import('pocketstation/node');
assert.equal(typeof node.Session, 'function');
assert.equal(typeof node.Source, 'function');
assert.equal(typeof node.RunningSession, 'function');

const browser = await import('pocketstation/browser');
assert.equal(typeof browser.RelaySession, 'function');
assert.equal(typeof browser.SignalingTransport, 'function');

const root = await import('pocketstation');
assert.deepEqual(Object.keys(root), ['PocketStationError', 'version']);
assert.equal(root.version, '0.1.0');

console.log('package exports: PASS');
