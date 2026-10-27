import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

const snippetSpecifications = [
  { startsWith: 'import { capture }' },
  {
    startsWith: 'for await (const frame of audio)',
    context: `
import type { Capture } from 'pocketstation/node';
declare const audio: Capture;
`,
  },
  {
    startsWith: 'const audio = await capture',
    context: `
import { capture } from 'pocketstation/node';
`,
  },
  { startsWith: 'import { Session, Source }' },
  { startsWith: 'import { ControlClient }' },
  { startsWith: 'import {\n  ConversationConfig' },
  {
    startsWith: 'const conversation = session.conversation',
    context: `
import type {
  AudioInput,
  AudioInputSamples,
  BusSubscription,
  Session,
} from 'pocketstation/node';
import type { ResponseHandler, SynthesisHandler } from 'pocketstation/voice';
declare const session: Session;
declare const transcripts: BusSubscription;
declare const assistantAudio: AudioInput;
declare const answer: ResponseHandler;
declare const speech: SynthesisHandler<AudioInputSamples>;
`,
  },
  {
    startsWith: 'const session = new Session({ recordingRoot:',
    context: `
import { Session, Source } from 'pocketstation/node';
`,
  },
  { startsWith: 'import { RelaySession, Session, Source }' },
  {
    startsWith: 'import { RelayPublisher }',
    context: `
import type { IceServer, SecretToken } from 'pocketstation/browser';
declare const signalUrl: string;
declare const sessionId: string;
declare const publisherToken: SecretToken;
declare const iceServers: readonly IceServer[];
`,
  },
  { startsWith: 'import { Capture, connector }' },
  { startsWith: 'import {\n  PortSpec' },
  {
    startsWith: 'import { Session }',
    includes: 'session.audioInput("agent audio")',
    context: `
declare const samples: Float32Array;
`,
  },
  {
    startsWith: 'const session = new Session();',
    includes: 'loadNativeExtensionLibrary',
    context: `
import { Session } from 'pocketstation/node';
`,
  },
  { startsWith: 'import { Source, discoverSources }' },
  { startsWith: 'import { microphonePermissionObservation }' },
  {
    startsWith: 'for await (const event of running.events)',
    context: `
import type { RunningSession } from 'pocketstation/node';
declare const running: RunningSession;
`,
  },
  {
    startsWith: 'const metrics = await running.metrics()',
    context: `
import type { RunningSession } from 'pocketstation/node';
declare const running: RunningSession;
`,
  },
  {
    startsWith: 'const outcome = await running.stop()',
    context: `
import type { RunningSession } from 'pocketstation/node';
declare const running: RunningSession;
`,
  },
  { startsWith: 'import { Session, SessionTrace }' },
  {
    startsWith: 'for await (const frame of running.audio.frames',
    context: `
import type { AudioFrame, RunningSession } from 'pocketstation/node';
declare const running: RunningSession;
declare const signal: AbortSignal;
declare const consume: (frame: AudioFrame) => void;
`,
  },
  {
    startsWith: 'import { END_OF_STREAM }',
    context: `
import type { RunningSession } from 'pocketstation/node';
declare const running: RunningSession;
`,
  },
  {
    startsWith: 'import { RelayReceiver }',
    context: `
declare const joinCode: string;
declare const controlUrl: string;
declare const audio: HTMLAudioElement;
`,
  },
];

const snippets = [...readme.matchAll(/```(?:ts|typescript)\r?\n([\s\S]*?)```/g)].map(
  (match) => ({
    code: match[1],
    line: readme.slice(0, match.index).split(/\r?\n/).length + 1,
  }),
);

if (snippets.length !== snippetSpecifications.length) {
  throw new Error(
    `README TypeScript snippet count changed: expected ${snippetSpecifications.length}, found ${snippets.length}`,
  );
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'pocketstation-readme-'));

try {
  const files = [];
  for (const [index, snippet] of snippets.entries()) {
    const specification = snippetSpecifications[index];
    const code = snippet.code.trim();
    if (!code.startsWith(specification.startsWith)) {
      throw new Error(
        `README TypeScript snippet ${index + 1} at line ${snippet.line} no longer starts with ${JSON.stringify(specification.startsWith)}`,
      );
    }
    if (specification.includes !== undefined && !code.includes(specification.includes)) {
      throw new Error(
        `README TypeScript snippet ${index + 1} at line ${snippet.line} no longer contains ${JSON.stringify(specification.includes)}`,
      );
    }

    const filename = `snippet-${String(index + 1).padStart(2, '0')}-line-${snippet.line}.ts`;
    writeFileSync(
      join(temporaryDirectory, filename),
      `${specification.context ?? ''}\n${snippet.code}`,
    );
    files.push(filename);
  }

  const relativeRoot = root.replaceAll('\\', '/');
  writeFileSync(
    join(temporaryDirectory, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022', 'DOM', 'ESNext.Disposable'],
        strict: true,
        noEmit: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        skipLibCheck: true,
        types: ['node'],
        typeRoots: [join(root, 'node_modules', '@types')],
        baseUrl: relativeRoot,
        paths: {
          pocketstation: ['src/index.ts'],
          'pocketstation/node': ['src/node/index.ts'],
          'pocketstation/browser': ['src/browser/index.ts'],
          'pocketstation/control': ['src/control/index.ts'],
          'pocketstation/voice': ['src/voice/index.ts'],
        },
      },
      files,
    }, null, 2)}\n`,
  );

  execFileSync(
    process.execPath,
    [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(temporaryDirectory, 'tsconfig.json')],
    { cwd: root, stdio: 'inherit' },
  );
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}

console.log(`README snippets: PASS (${snippets.length} TypeScript blocks)`);
