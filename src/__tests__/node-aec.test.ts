import {
  aecAvailable,
  EchoCancelledAudio,
  END_OF_STREAM,
  NativePlaybackReference,
  PlaybackReference,
  Session,
  SessionDeclarationError,
  Source,
} from '../node/index.js';

describe('explicit native microphone AEC selection', () => {
  it('records one exact output-device request without enabling the optional engine', () => {
    const session = new Session();
    const microphone = session.capture(Source.defaultMicrophone());
    const application = session.capture(Source.application('not-opened-by-declaration'));
    const reference = NativePlaybackReference.output('output-exact');
    expect(reference.playbackDeviceId).toBe('output-exact');
    expect(Object.isFrozen(reference)).toBe(true);
    expect(() => session.nativeAec(microphone, reference)).not.toThrow();
    expect(() => session.nativeAec(microphone, reference)).toThrow(SessionDeclarationError);
    expect(() => session.nativeAec(application, reference)).toThrow(SessionDeclarationError);
    expect(() => new Session().nativeAec(microphone, reference)).toThrow(SessionDeclarationError);
    expect(() => NativePlaybackReference.output(' ')).toThrow(TypeError);
  });

  it('requires an explicit native reference, leaving the draft usable after rejection', () => {
    const session = new Session();
    const microphone = session.capture(Source.defaultMicrophone());
    expect(() => session.nativeAec(microphone, undefined as unknown as NativePlaybackReference))
      .toThrow(TypeError);
    expect(() => session.nativeAec(microphone, NativePlaybackReference.output('output-exact')))
      .not.toThrow();
  });
});

(aecAvailable() ? describe : describe.skip)('built-in Session echo cancellation', () => {
  it('given explicit reference scopes when declaring then preserves inputs and retained observations', () => {
    for (const [declare, coverage] of [
      [PlaybackReference.selectedApplication, 'selected-application'],
      [PlaybackReference.outputMix, 'authorized-output-mix'],
      [PlaybackReference.renderedAudio, 'caller-rendered-audio'],
    ] as const) {
      const session = new Session();
      const microphone = session.capture(Source.defaultMicrophone());
      const application = session.capture(Source.application('not-opened-by-declaration'));
      const reference = declare(application);
      const processed = session.echoCancel(microphone, reference);
      expect(processed).toBeInstanceOf(EchoCancelledAudio);
      expect(processed.microphone).toBe(microphone);
      expect(processed.reference).toBe(reference);
      expect(processed.referenceCoverage).toBe(coverage);
      expect(processed.audio.sessionId).toBe(session.id);
      expect(processed.audio.id).not.toBe(microphone.id);
      expect(processed.observations()).toMatchObject({
        state: 'waiting-for-reference',
        processedMicrophoneFramesTotal: 0n,
        discardedOutputFramesTotal: 0n,
        tailFramesTotal: 0n,
        nominalDelaySamples: 432,
        drainDurationMs: 40,
        qualifiedAlgorithmicDelaySamples: undefined,
      });
      expect(Object.isFrozen(processed.observations())).toBe(true);
    }
  });

  it('given foreign or identical streams when declaring then Core rejects without poisoning the draft', () => {
    const session = new Session();
    const microphone = session.audioInput('microphone').output;
    const reference = session.audioInput('reference').output;
    const foreign = new Session().audioInput('foreign').output;
    for (const invalid of [foreign, microphone]) {
      expect(() => session.echoCancel(microphone, PlaybackReference.renderedAudio(invalid)))
        .toThrow(SessionDeclarationError);
    }
    expect(() => session.echoCancel(microphone, PlaybackReference.renderedAudio(reference)))
      .not.toThrow();
    const unsupported = new Session({ sampleRateHz: 44_100 });
    expect(() => unsupported.echoCancel(
      unsupported.audioInput('microphone').output,
      PlaybackReference.renderedAudio(unsupported.audioInput('reference').output),
    )).toThrow(SessionDeclarationError);
  });

  it.each([[10, 1], [20, 1], [10, 2]] as const)(
    'given %i ms and %i channel PCM when Core processes then echo reduces, voice survives and raw reference stays intact',
    async (frameDurationMs, channels) => {
      const session = new Session({ frameDurationMs, channels });
      const reference = session.audioInput('explicit playback');
      const microphone = session.audioInput('microphone');
      const processed = session.echoCancel(
        microphone.output, PlaybackReference.renderedAudio(reference.output),
      );
      const output = session.audio();
      reference.output.send(output);
      processed.audio.send(output);
      const running = await session.start();
      let previous = new Float32Array(frameDurationMs * 48 * channels);
      let random = 0x917ba33;
      let inputPower = 0;
      let outputPower = 0;
      let voiceInputPower = 0;
      let voiceOutputPower = 0;
      try {
        for (let frameIndex = 0; frameIndex < 400; frameIndex += 1) {
          const samples = new Float32Array(previous.length);
          const echo = new Float32Array(previous.length);
          for (let index = 0; index < samples.length; index += channels) {
            random ^= random << 13;
            random ^= random >>> 17;
            random ^= random << 5;
            const voice = ((random >>> 0) / 0xffffffff * 2 - 1) * 0.1;
            samples[index] = frameIndex < 300 ? voice : 0;
            if (channels === 2) samples[index + 1] = -samples[index];
            const amplitude = frameIndex >= 300 ? voice : previous[index] * 0.6
              + (channels === 2 ? previous[index + 1] * 0.1 : 0);
            echo.fill(amplitude, index, index + channels);
          }
          if (frameIndex % 2 === 0) {
            reference.tryWrite(samples);
            microphone.tryWrite(echo);
          } else {
            microphone.tryWrite(echo);
            reference.tryWrite(samples);
          }
          let rawSeen = false;
          let processedSeen = false;
          for (let count = 0; count < 2; count += 1) {
            const frame = await running.audio.read({ timeoutMs: 1_000 });
            expect(frame).toBeDefined();
            if (frame!.sourceId === reference.sourceId) {
              expect(rawSeen).toBe(false);
              expect(Array.from(frame!.samples)).toEqual(Array.from(samples));
              expect(frame!.processing).toBeUndefined();
              rawSeen = true;
            } else {
              expect(processedSeen).toBe(false);
              expect(frame!.samples).toHaveLength(echo.length);
              expect(frame!.samples.every(Number.isFinite)).toBe(true);
              expect(frame!.processing).toMatchObject({
                inputSourceId: microphone.sourceId,
                inputStreamId: microphone.streamId,
                inputDurationNs: BigInt(frameDurationMs * 1_000_000),
                nominalDelaySamples: 432,
                paddingSamples: 0,
                tailOffsetSamples: 0,
                isTail: false,
              });
              expect(Object.isFrozen(frame!.processing)).toBe(true);
              expect(typeof frame!.processing!.inputSequenceNumber).toBe('bigint');
              expect(typeof frame!.processing!.inputTimestampNs).toBe('bigint');
              if (frameIndex >= 300) {
                for (const value of frame!.samples) voiceOutputPower += value * value;
              } else if (frameIndex >= 200) {
                for (const value of frame!.samples) outputPower += value * value;
              }
              processedSeen = true;
            }
          }
          expect(rawSeen && processedSeen).toBe(true);
          if (frameIndex >= 300) {
            for (const value of echo) voiceInputPower += value * value;
          } else if (frameIndex >= 200) {
            for (const value of echo) inputPower += value * value;
          }
          previous = samples;
        }
      } finally {
        reference.close();
        microphone.close();
        expect((await running.stop()).success).toBe(true);
      }
      for (let tail = 0; tail < 40 / frameDurationMs; tail += 1) {
        const frame = await running.audio.read({ timeoutMs: 0 });
        expect(frame).toMatchObject({
          processing: {
            inputSourceId: microphone.sourceId,
            inputSequenceNumber: 399n,
            paddingSamples: frameDurationMs * 48,
            tailOffsetSamples: tail * frameDurationMs * 48,
            isTail: true,
          },
        });
      }
      await expect(running.audio.read({ timeoutMs: 0 })).resolves.toBe(END_OF_STREAM);
      expect(inputPower).toBeGreaterThan(1);
      expect(outputPower).toBeLessThan(inputPower * 0.5);
      expect(voiceInputPower).toBeGreaterThan(1);
      expect(voiceOutputPower).toBeGreaterThan(voiceInputPower * 0.5);
      expect(processed.observations()).toMatchObject({
        state: 'stopped',
        processedMicrophoneFramesTotal: 400n,
        discardedOutputFramesTotal: 0n,
        outputFramesTotal: 400n + BigInt(40 / frameDurationMs),
        tailFramesTotal: BigInt(40 / frameDurationMs),
        tailPaddingSamplesTotal: 1_920n,
        discardedTailGenerationsTotal: 0n,
        analyzedReferenceFramesTotal: 400n,
        interruptedRequestsTotal: 0n,
        microphoneSourceId: microphone.sourceId,
        referenceSourceId: reference.sourceId,
      });
    },
    30_000,
  );
});

if (!aecAvailable()) {
  test('lean native build rejects AEC explicitly', () => {
    const session = new Session();
    const microphone = session.audioInput('microphone');
    const reference = session.audioInput('reference');
    expect(() => session.echoCancel(microphone.output, PlaybackReference.renderedAudio(reference.output)))
      .toThrow('AEC is unavailable');
  });
}
