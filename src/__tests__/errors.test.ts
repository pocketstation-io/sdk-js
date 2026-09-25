import {
  AudioInputBufferError,
  AudioInputCancelledError,
  AudioInputClosedError,
  AudioInputConfigurationError,
  AudioInputError,
  AudioInputFullError,
  CaptureError,
  ConnectorRuntimeError,
  EventInputClosedError,
  EventInputError,
  EventInputFullError,
  ExtensionError,
  GraphError,
  OperatorError,
  OperatorInstanceId,
  PocketStationError,
  SessionCompileDiagnostic,
  SessionDeclarationError,
  SessionError,
  SessionRuntimeError,
  SessionStartError,
  SidecarBackpressureError,
  SidecarError,
  SidecarProtocolError,
  SidecarTimeoutError,
  SourceError,
  StreamError,
  StreamInUseError,
  StreamModeError,
} from '../node/index.js';
import { fromNativeError, nativeCall, nativeCallSync } from '../node/errors.js';

describe('Python-equivalent Node error hierarchy', () => {
  it('exports the complete public hierarchy with native JavaScript inheritance', () => {
    expect(new SessionDeclarationError('session.no_sources', 'missing')).toBeInstanceOf(
      SessionError,
    );
    expect(new SessionStartError('session.compile_failed', 'invalid')).toBeInstanceOf(
      SessionError,
    );
    expect(new SessionRuntimeError('session.failed', 'failed')).toBeInstanceOf(
      SessionError,
    );
    expect(new CaptureError('capture.denied', 'denied')).toBeInstanceOf(
      SessionStartError,
    );
    expect(new GraphError('graph.invalid', 'invalid')).toBeInstanceOf(
      PocketStationError,
    );
    expect(new SourceError('source.failed', 'failed')).toBeInstanceOf(
      PocketStationError,
    );
    expect(new OperatorError('operator.failed', 'failed')).toBeInstanceOf(
      PocketStationError,
    );
    expect(new ConnectorRuntimeError('connector.failed', 'failed')).toBeInstanceOf(
      PocketStationError,
    );
    expect(new StreamError('stream.failed', 'failed')).toBeInstanceOf(
      PocketStationError,
    );
    expect(new SidecarError('sidecar.failed', 'failed')).toBeInstanceOf(
      PocketStationError,
    );
    expect(new ExtensionError('extension.failed', 'failed')).toBeInstanceOf(
      PocketStationError,
    );
    expect(new AudioInputError('audio_input.failed', 'failed')).toBeInstanceOf(
      PocketStationError,
    );
    expect(new EventInputError('event_input.failed', 'failed')).toBeInstanceOf(
      PocketStationError,
    );
  });

  it('preserves immutable structured compile diagnostics', () => {
    const diagnostic = new SessionCompileDiagnostic({
      code: 'graph.port_mismatch',
      nodeIndex: 3,
      edgeIndex: 5,
      operatorId: 'io.pocketstation.operator.test.v1',
      operatorInstanceId: OperatorInstanceId(8n),
      nodeTypeId: 'operator',
      sourceTypeId: 'io.pocketstation.source.test.v1',
      portName: 'audio',
      direction: 'input',
      expected: '48-khz-mono',
      actual: '44.1-khz-stereo',
    });
    const failure = new SessionStartError(
      'session.compile_failed',
      'compile failed',
      diagnostic,
    );

    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(failure.diagnostic).toBe(diagnostic);
    expect(diagnostic.operatorInstanceId).toBe(8n);
    expect(diagnostic.edgeIndex).toBe(5);
    expect(Reflect.set(diagnostic, 'code', 'changed')).toBe(false);
    expect(() => new SessionCompileDiagnostic({ code: '' })).toThrow(TypeError);
    expect(
      () => new SessionCompileDiagnostic({ code: 'bad', nodeIndex: -1 }),
    ).toThrow(RangeError);
  });

  it.each([
    ['sidecar.queue_full', SidecarBackpressureError],
    ['sidecar.unexpected_eof', SidecarProtocolError],
    ['sidecar.processing_timeout', SidecarTimeoutError],
    ['sidecar.spawn_failed', SidecarError],
    ['extension.abi_mismatch', ExtensionError],
    ['audio_input.full', AudioInputFullError],
    ['audio_input.closed', AudioInputClosedError],
    ['audio_input.cancelled', AudioInputCancelledError],
    ['audio_input.invalid_buffer', AudioInputBufferError],
    ['audio_input.invalid_configuration', AudioInputConfigurationError],
    ['audio_input.declaration_failed', AudioInputConfigurationError],
    ['audio_input.unknown', AudioInputError],
    ['capture.permission_denied', CaptureError],
    ['graph.invalid_route', GraphError],
    ['source.failed', SourceError],
    ['operator.failed', OperatorError],
    ['connector.failed', ConnectorRuntimeError],
    ['session.compile_failed', SessionStartError],
    ['session.no_sources', SessionDeclarationError],
    ['session.failed', SessionRuntimeError],
  ] as const)('maps native %s without losing its code', (code, expectedClass) => {
    const nativeFailure = new Error(`${code}|native detail`);
    const failure = fromNativeError(nativeFailure);

    expect(failure).toBeInstanceOf(expectedClass);
    expect(failure.code).toBe(code);
    expect(failure.message).toBe('native detail');
    expect(failure.cause).toBe(nativeFailure);
  });

  it('keeps unknown and uncoded native failures inspectable', () => {
    const coded = fromNativeError(new Error('future.failure|future detail'));
    expect(coded).toBeInstanceOf(PocketStationError);
    expect(coded.code).toBe('future.failure');
    expect(coded.message).toBe('future detail');

    const uncoded = new Error('plain native failure');
    const normalized = fromNativeError(uncoded);
    expect(normalized.code).toBe('session.internal');
    expect(normalized.message).toBe('plain native failure');
    expect(normalized.cause).toBe(uncoded);
  });

  it('preserves specialized fields and finite ingress failures', () => {
    const mode = new StreamModeError('iterator', 'read');
    expect(mode.activeMode).toBe('iterator');
    expect(mode.requestedMode).toBe('read');

    const inUse = new StreamInUseError('iterator');
    expect(inUse.mode).toBe('iterator');
    expect(new EventInputFullError()).toBeInstanceOf(EventInputError);
    expect(new EventInputClosedError()).toBeInstanceOf(EventInputError);
  });

  it('normalizes synchronous and asynchronous native calls through one policy', async () => {
    expect(() =>
      nativeCallSync(() => {
        throw new Error('graph.invalid_route|bad route');
      }),
    ).toThrow(GraphError);

    await expect(
      nativeCall(async () => {
        throw new Error('capture.permission_denied|denied');
      }),
    ).rejects.toBeInstanceOf(CaptureError);
  });
});
