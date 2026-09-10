import { Buffer } from 'node:buffer';

import {
  AudioInputAbortError,
  AudioInputBufferError,
  AudioInputCancelledError,
  AudioInputClosedError,
  AudioInputConfigurationError,
  AudioInputFullError,
  AudioInputTimeoutError,
  OutputCancelledError,
  OutputOwnershipError,
  Session,
} from '../node/index.js';

describe('application-owned PCM', () => {
  it('uses the Session frame duration for the default input frame size', () => {
    const tenMillisecondInput = new Session({ frameDurationMs: 10 }).audioInput(
      'ten millisecond audio',
    );
    const twentyMillisecondInput = new Session({ frameDurationMs: 20 }).audioInput(
      'twenty millisecond audio',
    );

    expect(tenMillisecondInput.config.frameSamplesPerChannel).toBe(480);
    expect(twentyMillisecondInput.config.frameSamplesPerChannel).toBe(960);
    expect(() => twentyMillisecondInput.tryWrite(new Float32Array(960))).not.toThrow();
  });

  it('copies Float32Array samples into Core and preserves source identity and timing', async () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('agent audio');
    input.output.send(session.audio());
    const samples = new Float32Array(480).fill(0.25);

    input.tryWrite(samples, { discontinuity: true });
    samples.fill(0.75);
    input.close();

    const running = await session.start();
    const received = await running.audio.read({ timeoutMs: 1_000 });
    const result = await running.stop();

    expect(received).toBeDefined();
    expect(received?.samples[0]).toBeCloseTo(0.25);
    expect(received?.sourceId).toBe(input.sourceId);
    expect(received?.streamId).toBe(input.streamId);
    expect(received?.sequenceNumber).toBe(0n);
    expect(received?.durationNs).toBe(10_000_000n);
    expect(received?.discontinuityEpoch).toBe(1n);
    expect(result.success).toBe(true);
  });

  it('accepts an explicitly encoded little-endian float32 Buffer', async () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('network audio');
    input.output.send(session.audio());
    const samples = Buffer.alloc(480 * Float32Array.BYTES_PER_ELEMENT);
    for (let offset = 0; offset < samples.length; offset += 4) {
      samples.writeFloatLE(-0.5, offset);
    }

    input.tryWrite(samples);
    samples.fill(0);
    input.close();

    const running = await session.start();
    const received = await running.audio.read({ timeoutMs: 1_000 });
    await running.stop();

    expect(received?.samples[0]).toBeCloseTo(-0.5);
  });

  it('reports immediate capacity without advancing accepted work', () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('capacity test', { capacityFrames: 1 });
    const samples = new Float32Array(480);

    input.tryWrite(samples);
    expect(() => input.tryWrite(samples)).toThrow(AudioInputFullError);

    expect(input.observations()).toMatchObject({
      capacityFrames: 1n,
      acceptedTotal: 1n,
      fullTotal: 1n,
      invalidTotal: 0n,
      cancelled: false,
      closed: false,
    });
  });

  it('cancels one output without stopping its AudioInput or Session', async () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('assistant audio', { capacityFrames: 4 });
    input.output.send(session.audio());
    const first = input.beginOutput();
    const firstSamples = new Float32Array(480).fill(0.25);
    const secondSamples = new Float32Array(480).fill(0.75);

    input.tryWrite(firstSamples, { output: first });
    const second = input.beginOutput();

    expect(first.active).toBe(false);
    expect(second.active).toBe(true);
    expect(() => input.tryWrite(firstSamples, { output: first })).toThrow(
      OutputCancelledError,
    );

    input.tryWrite(secondSamples, { output: second });
    input.close();

    const running = await session.start();
    const received = await running.audio.read({ timeoutMs: 1_000 });
    const metrics = await running.metrics();
    await running.stop();

    expect(received?.outputGenerationId).toBe(second.id);
    expect(received?.samples[0]).toBeCloseTo(0.75);
    expect(input.observations()).toMatchObject({
      cancelledOutputWritesTotal: 1n,
    });
    expect(metrics.routes[0]?.delivery.discardedOutputFramesTotal).toBe(1n);
  });

  it('rejects output created by another AudioInput', () => {
    const session = new Session({ frameDurationMs: 10 });
    const first = session.audioInput('first output');
    const second = session.audioInput('second output');
    const output = first.beginOutput();

    expect(() =>
      second.tryWrite(new Float32Array(480), { output }),
    ).toThrow(OutputOwnershipError);
  });

  it('does not advance sequence, time, or discontinuity after a full write', async () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('continuity test', { capacityFrames: 1 });
    input.output.send(session.audio());
    const samples = new Float32Array(480);
    input.tryWrite(samples);

    expect(() =>
      input.tryWrite(samples, { discontinuity: true }),
    ).toThrow(AudioInputFullError);

    const running = await session.start();
    const first = await running.audio.read({ timeoutMs: 1_000 });
    await input.write(samples);
    input.close();
    const second = await running.audio.read({ timeoutMs: 1_000 });
    await running.stop();

    expect(first).toBeDefined();
    expect(second?.sequenceNumber).toBe(1n);
    expect(second?.timestampStartNs).toBe(
      (first?.timestampStartNs ?? 0n) + (first?.durationNs ?? 0n),
    );
    expect(second?.discontinuityEpoch).toBe(0n);
  });

  it('times out without adding a JavaScript media queue', async () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('timeout test', { capacityFrames: 1 });
    const samples = new Float32Array(480);
    input.tryWrite(samples);

    await expect(input.write(samples, { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'audio_input.timeout',
      timeoutMs: 5,
    });
    expect(input.observations().acceptedTotal).toBe(1n);
  });

  it('uses AbortSignal to stop a pending write without closing the input', async () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('abort test', { capacityFrames: 1 });
    const samples = new Float32Array(480);
    input.tryWrite(samples);
    const controller = new AbortController();
    const write = input.write(samples, {
      timeoutMs: 1_000,
      signal: controller.signal,
    });

    controller.abort('test complete');

    await expect(write).rejects.toBeInstanceOf(AudioInputAbortError);
    expect(input.observations().closed).toBe(false);
  });

  it('rejects invalid samples and writes after close with typed errors', () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('validation test');

    expect(() => input.tryWrite(new Float32Array(479))).toThrow(
      AudioInputBufferError,
    );
    expect(() => input.tryWrite(Buffer.alloc(3))).toThrow(AudioInputBufferError);
    input.close();
    input.close();
    expect(() => input.tryWrite(new Float32Array(480))).toThrow(
      AudioInputClosedError,
    );
    expect(input.observations().closed).toBe(true);
  });

  it('rejects an already-aborted wait before writing', async () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('pre-aborted test');
    const controller = new AbortController();
    controller.abort('do not write');

    await expect(
      input.write(new Float32Array(480), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AudioInputAbortError);
    expect(input.observations().acceptedTotal).toBe(0n);
  });

  it('reports Session cancellation separately from close', async () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('cancel test');
    input.output.send(session.audio());
    const running = await session.start();

    await running.cancel();

    expect(() => input.tryWrite(new Float32Array(480))).toThrow(
      AudioInputCancelledError,
    );
    expect(input.observations()).toMatchObject({
      cancelled: true,
      closed: true,
    });
  });

  it('supports explicit disposal without changing Session ownership', () => {
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('disposal test');

    input[Symbol.dispose]();

    expect(input.observations().closed).toBe(true);
  });

  it('validates configuration before adding a Source', () => {
    const session = new Session({ frameDurationMs: 10 });

    expect(() => session.audioInput('')).toThrow(AudioInputConfigurationError);
    expect(() =>
      session.audioInput('invalid', { capacityFrames: 0 }),
    ).toThrow('capacity must be between 1 and 63 frames');
    expect(() =>
      session.audioInput('invalid', { frameSamplesPerChannel: 0 }),
    ).toThrow('frame sample count must be non-zero');
    expect(() =>
      session.audioInput('invalid', { sampleRateHz: 44_100 }),
    ).toThrow('all audio inputs in one Session must use the same sample format');
  });

  it('rejects a destination owned by another Session', () => {
    const first = new Session({ frameDurationMs: 10 });
    const second = new Session({ frameDurationMs: 10 });
    const input = first.audioInput('first Session');

    expect(() => input.output.send(second.audio())).toThrow(
      'SourceOutput and Endpoint belong to different Sessions',
    );
  });
});
