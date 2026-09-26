import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const report = readFileSync(
  new URL('../api-reports/pocketstation-demo.api.md', import.meta.url),
  'utf8',
);

const expectedBorrowedSymbols = [
  'AudioFrame',
  'AudioInput',
  'BusSubscription',
  'Capture',
  'DerivedStream',
  'DuplexVoiceCapabilities',
  'DuplexVoiceConnection',
  'DuplexVoiceContext',
  'DuplexVoiceModel',
  'Endpoint',
  'OperatorManifest',
  'OperatorProvider',
  'RunningSession',
  'Session',
  'SignalEnvelope',
  'SignalSpec',
  'SourceOutput',
  'Stem',
];

const observedBorrowedSymbols = [
  ...report.matchAll(/ae-forgotten-export\) The symbol "([^"]+)"/g),
]
  .map((match) => match[1])
  .sort();

assert.deepEqual(
  observedBorrowedSymbols,
  expectedBorrowedSymbols,
  'the demo API borrowed a different cross-entrypoint symbol; update its owning entrypoint or review the explicit allowlist',
);

console.log('demo API cross-entrypoint boundary: PASS');
