import assert from 'node:assert/strict';

const node = await import('pocketstation/node');
assert.equal(typeof node.Session, 'function');
assert.equal(typeof node.Source, 'function');
assert.equal(typeof node.RunningSession, 'function');
assert.equal(typeof node.discoverSources, 'function');
assert.equal(typeof node.microphonePermissionObservation, 'function');
assert.equal(typeof node.CapturePermissionLifecycle, 'function');
assert.equal(typeof node.EventStream, 'function');
assert.equal(typeof node.SignalSpec, 'function');
assert.equal(typeof node.MediaCaps, 'function');
assert.equal(typeof node.DeliveryPolicy, 'function');
assert.equal(typeof node.RouteSettings, 'function');
assert.equal(typeof node.Operator, 'function');
assert.equal(typeof node.EndpointDefinition, 'function');
assert.equal(typeof node.SessionStartError, 'function');
assert.equal(typeof node.AudioInput, 'function');
assert.equal(typeof node.AudioInputFullError, 'function');
assert.equal(typeof node.AudioInputTimeoutError, 'function');
assert.equal(typeof node.SourceOutput, 'function');
assert.equal(typeof node.BusSubscription, 'function');
assert.equal(typeof node.SignalStream, 'function');
assert.equal(typeof node.EndOfStream, 'function');
assert.equal(node.END_OF_STREAM.kind, 'end-of-stream');
assert.equal(typeof node.StreamAbortError, 'function');

const browser = await import('pocketstation/browser');
assert.equal(typeof browser.RelaySession, 'function');
assert.equal(typeof browser.SignalingTransport, 'function');

const root = await import('pocketstation');
assert.deepEqual(Object.keys(root), ['PocketStationError', 'version']);
assert.equal(root.version, '0.1.0');

console.log('package exports: PASS');
