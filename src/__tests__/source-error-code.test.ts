import { Source, type DiscoveredSource } from '../node/sources.js';
import {
  PocketStationError,
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
});
