import {
  Source,
  SourceQuery,
  discoverSources,
  type DiscoveredSource,
} from '../node/sources.js';
import {
  PocketStationError,
  SessionDeclarationError,
  SourceError,
  fromNativeError,
  nativeCallSync,
} from '../node/errors.js';
import { nativeAddon } from '../node/native.js';

describe('Source error-code compatibility', () => {
  it('keeps the established code for a discovery-only output device', () => {
    const output = {
      stableId: {
        platform: 'macos',
        kind: 'output-device',
        stableKey: 'output:fixture',
      },
    } as DiscoveredSource;

    let captured: unknown;
    try {
      Source.fromDiscovered(output);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(PocketStationError);
    expect(captured).toMatchObject({ code: 'source.unsupported_session_kind' });
  });

  it.each([
    'source.session_not_running',
    'source.unknown_stem',
    'source.not_microphone',
    'source.replacement_prepare_failed',
    'source.replacement_open_failed',
    'source.reopen_failed',
    'source.replacement_queue_full',
    'source.runtime_stopped',
    'source.replacement_response_timed_out',
  ])('normalizes native %s failures as SourceError', (code) => {
    const failure = fromNativeError(new Error(`${code}|fixture`));
    expect(failure).toBeInstanceOf(SourceError);
    expect(failure).toMatchObject({ code, message: 'fixture' });
  });

  it.each([
    ['session-not-running', 'source.session_not_running'],
    ['unknown-stem', 'source.unknown_stem'],
    ['not-microphone', 'source.not_microphone'],
    ['prepare', 'source.replacement_prepare_failed'],
    ['open', 'source.replacement_open_failed'],
    ['reopen', 'source.reopen_failed'],
    ['control-queue-full', 'source.replacement_queue_full'],
    ['runtime-stopped', 'source.runtime_stopped'],
    ['response-timed-out', 'source.replacement_response_timed_out'],
  ])('projects native replacement case %s as %s', (caseName, code) => {
    const project = nativeAddon().conformanceSourceReplacementError;
    expect(project).toBeDefined();
    let captured: unknown;
    try {
      nativeCallSync(() => project?.(caseName));
    } catch (failure) {
      captured = failure;
    }
    expect(captured).toBeInstanceOf(SourceError);
    expect(captured).toMatchObject({ code });
  });

  it.each([
    ['application name', () => Source.application(' ')],
    ['application identifier', () => Source.applicationId(' ')],
    ['application process ID', () => Source.applicationProcessId(0)],
    [
      'application stable ID',
      () => Source.applicationStableId({
        platform: 'macos', kind: 'application', stableKey: ' ',
      }),
    ],
    [
      'process instance ID',
      () => Source.application({
        processId: 0,
        stableId: { platform: 'macos', kind: 'application', stableKey: 'app' },
      }),
    ],
    [
      'process instance stable ID',
      () => Source.application({
        processId: 1,
        stableId: { platform: 'macos', kind: 'application', stableKey: ' ' },
      }),
    ],
    ['microphone ID', () => Source.microphone(' ')],
  ])('preserves the native selector failure for %s', (_label, declareSource) => {
    let captured: unknown;
    try {
      declareSource();
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(SessionDeclarationError);
    expect(captured).toMatchObject({ code: 'session.invalid_selector' });
  });

  it.each([0, -1, 0x1_0000_0000, 1.5, Number.NaN, Number.POSITIVE_INFINITY, true])(
    'rejects invalid process identifier %p with the shared selector code',
    (processId) => {
      const declareSource = () =>
        Source.applicationProcessId(processId as unknown as number);
      expect(declareSource).toThrow(SessionDeclarationError);
      expectCapturedCode(declareSource, 'session.invalid_selector');
      expectCapturedCode(
        () => Source.application(processId as unknown as number),
        'session.invalid_selector',
      );
      expectCapturedCode(
        () =>
          Source.applicationProcessInstance(
            processId as unknown as number,
            'macos',
            'fixture:application',
          ),
        'session.invalid_selector',
      );
    },
  );

  it('accepts both valid process identifier boundaries', () => {
    expect(Source.applicationProcessId(1).selectorValue).toBe(1);
    expect(Source.applicationProcessId(0xffff_ffff).selectorValue).toBe(0xffff_ffff);
  });

  it.each([1n, (1n << 64n) - 1n])(
    'accepts positive unsigned 64-bit discovered source identity boundary %p',
    (sourceId) => {
      expect(Source.applicationStableId({
        platform: 'macos',
        kind: 'application',
        stableKey: 'fixture',
        sourceId: sourceId as never,
      }).selectorValue).toMatchObject({ sourceId });
    },
  );

  it.each([
    ['blank application factory', () => SourceQuery.application(' ')],
    ['blank stable-key factory', () => SourceQuery.stableKey(' ')],
    [
      'unknown source kind factory',
      () => SourceQuery.kind('camera' as never),
    ],
  ])('rejects %s with the shared selector code', (_label, query) => {
    expectCapturedCode(query, 'session.invalid_selector');
  });

  it.each([
    ['application name type', () => Source.applicationName(true as never)],
    ['application identifier type', () => Source.applicationId(true as never)],
    ['microphone identifier type', () => Source.microphoneId(true as never)],
    ['stable identity object', () => Source.applicationStableId(null as never)],
    [
      'stable identity platform type',
      () => Source.applicationStableId({
        platform: true,
        kind: 'application',
        stableKey: 'fixture',
      } as never),
    ],
    ...[-1n, 0n, 1n << 64n, true].map((sourceId) => [
      `stable identity source ID ${String(sourceId)}`,
      () => Source.applicationStableId({
        platform: 'macos',
        kind: 'application',
        stableKey: 'fixture',
        sourceId,
      } as never),
    ] as const),
    [
      'process instance stable identity',
      () => Source.application({ processId: 1 } as never),
    ],
    [
      'process instance platform type',
      () => Source.applicationProcessInstance(1, true as never, 'fixture'),
    ],
    [
      'process instance stable key type',
      () => Source.applicationProcessInstance(1, 'macos', true as never),
    ],
    ['discovered source object', () => Source.fromDiscovered(null as never)],
    [
      'discovered stable identity',
      () => Source.fromDiscovered({ stableId: null } as never),
    ],
  ])('rejects malformed %s without leaking a JavaScript runtime error', (_label, operation) => {
    expectCapturedCode(operation, 'session.invalid_selector');
  });

  it.each([
    ['blank application query', { type: 'application', name: ' ' }],
    ['blank stable-key query', { type: 'stable-key', stableKey: ' ' }],
    ['unknown source kind query', { type: 'kind', kind: 'camera' }],
    ['unknown query type', { type: 'camera' }],
    ['null query', null],
  ])('rejects %s before native discovery', async (_label, query) => {
    await expect(discoverSources(query as never)).rejects.toMatchObject({
      name: 'SessionDeclarationError',
      code: 'session.invalid_selector',
    });
  });
});

function expectCapturedCode(operation: () => unknown, code: string): void {
  let captured: unknown;
  try {
    operation();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(SessionDeclarationError);
  expect(captured).toMatchObject({ code });
}
