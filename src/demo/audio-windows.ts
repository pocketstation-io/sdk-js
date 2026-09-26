import type { SignalEnvelope } from '../node/signals.js';

const MINIMUM_WINDOW_SECONDS = 0.1;
const MAXIMUM_WINDOW_SECONDS = 30;
const MAXIMUM_SOURCES = 64;
const MINIMUM_SAMPLE_RATE_HZ = 8_000;
const MAXIMUM_SAMPLE_RATE_HZ = 384_000;
const MAXIMUM_CHANNEL_COUNT = 64;
const MAXIMUM_FRAME_SAMPLES = 262_144;
const MAXIMUM_WINDOW_SAMPLES = 16_777_216;
const MAXIMUM_BUFFERED_SAMPLES = MAXIMUM_WINDOW_SAMPLES + MAXIMUM_FRAME_SAMPLES;

/** One finite source-aware PCM window passed to a transcription model. */
export interface AudioWindow {
  readonly sampleRateHz: number;
  readonly channelCount: number;
  readonly sessionId: bigint;
  readonly sourceId: bigint;
  readonly streamId: bigint;
  readonly clockId: number;
  readonly sourceGeneration: number;
  readonly policyEpoch: bigint;
  readonly sequenceStart: bigint;
  readonly sequenceEnd: bigint;
  readonly discontinuityEpoch: bigint;
  readonly timestampStartNs: bigint;
  readonly timestampEndNs: bigint;
  readonly sourceTimestampStartNs: bigint | undefined;
  readonly sourceTimestampEndNs: bigint | undefined;
  readonly sessionTimestampStartNs: bigint | undefined;
  readonly sessionTimestampEndNs: bigint | undefined;
  readonly discontinuityReasons: readonly string[];
  readonly samples: Float32Array;
}

type MutableAudioWindow = {
  -readonly [Field in keyof AudioWindow]: AudioWindow[Field];
};

/** Accumulate complete input frames independently for every source stream. */
export class AudioWindowBuffer {
  readonly #windowSeconds: number;
  readonly #maximumSources: number;
  readonly #windows = new Map<string, MutableAudioWindow>();

  public constructor(options: {
    readonly windowSeconds: number;
    readonly maximumSources: number;
  }) {
    this.#windowSeconds = finiteNumber(
      options.windowSeconds,
      'windowSeconds',
      MINIMUM_WINDOW_SECONDS,
      MAXIMUM_WINDOW_SECONDS,
    );
    this.#maximumSources = boundedInteger(
      options.maximumSources,
      'maximumSources',
      1,
      MAXIMUM_SOURCES,
    );
  }

  public push(envelope: SignalEnvelope): readonly AudioWindow[] {
    if (envelope.payload.kind !== 'audio') {
      throw new TypeError('transcription accepts only PCM audio signals');
    }
    const lineage = envelope.lineage;
    if (lineage === undefined) {
      throw new TypeError('transcription requires source-aware audio lineage');
    }
    const payload = envelope.payload;
    validateAudioPayload(payload);
    const targetSamples = targetSampleCount(
      payload.sampleRateHz,
      payload.channelCount,
      this.#windowSeconds,
    );
    const durationNs = frameDurationNs(envelope, payload.sampleCount);
    const key = `${payload.sourceId}:${payload.streamId}`;
    let window = this.#windows.get(key);
    const reasons: string[] = [];
    if (window !== undefined) {
      if (window.sampleRateHz !== payload.sampleRateHz) reasons.push('sample-rate-change');
      if (window.channelCount !== payload.channelCount) reasons.push('channel-count-change');
      if (window.clockId !== lineage.clockId) reasons.push('clock-change');
      if (window.sourceGeneration !== lineage.sourceGeneration) reasons.push('source-generation-change');
      if (window.policyEpoch !== lineage.policyEpoch) reasons.push('policy-epoch-change');
      if (window.discontinuityEpoch !== lineage.discontinuityEpoch) reasons.push('discontinuity-epoch-change');
      if (payload.sequenceNumber !== window.sequenceEnd + 1n) reasons.push('sequence-gap');
    }

    const completed: AudioWindow[] = [];
    if (reasons.length > 0 && window !== undefined) {
      if (window.samples.length > 0) completed.push(snapshot(window));
      this.#windows.delete(key);
      window = undefined;
    }
    if (window === undefined) {
      if (this.#windows.size >= this.#maximumSources) {
        throw new RangeError('maximum concurrent transcription sources exceeded');
      }
      window = {
        sampleRateHz: payload.sampleRateHz,
        channelCount: payload.channelCount,
        sessionId: lineage.sessionId,
        sourceId: payload.sourceId,
        streamId: payload.streamId,
        clockId: lineage.clockId,
        sourceGeneration: lineage.sourceGeneration,
        policyEpoch: lineage.policyEpoch,
        sequenceStart: payload.sequenceNumber,
        sequenceEnd: payload.sequenceNumber,
        discontinuityEpoch: lineage.discontinuityEpoch,
        timestampStartNs: payload.timestampNs,
        timestampEndNs: payload.timestampNs,
        sourceTimestampStartNs: envelope.timing.sourceTimestampNs,
        sourceTimestampEndNs: envelope.timing.sourceTimestampNs,
        sessionTimestampStartNs: envelope.timing.sessionTimestampNs,
        sessionTimestampEndNs: envelope.timing.sessionTimestampNs,
        discontinuityReasons: Object.freeze(reasons),
        samples: new Float32Array(),
      };
      this.#windows.set(key, window);
    }

    const activeWindow = window;
    if (activeWindow === undefined) {
      throw new Error('transcription window was not initialized');
    }
    activeWindow.samples = concatenate(activeWindow.samples, payload.samples);
    activeWindow.sequenceEnd = payload.sequenceNumber;
    activeWindow.timestampEndNs = payload.timestampNs + durationNs;
    if (envelope.timing.sourceTimestampNs !== undefined) {
      activeWindow.sourceTimestampEndNs = envelope.timing.sourceTimestampNs + durationNs;
    }
    if (envelope.timing.sessionTimestampNs !== undefined) {
      activeWindow.sessionTimestampEndNs = envelope.timing.sessionTimestampNs + durationNs;
    }

    if (activeWindow.samples.length >= targetSamples) {
      completed.push(snapshot(activeWindow));
      this.#windows.delete(key);
    }
    return Object.freeze(completed);
  }

  public flush(): readonly AudioWindow[] {
    const completed = [...this.#windows.values()]
      .filter((window) => window.samples.length > 0)
      .map(snapshot);
    this.#windows.clear();
    return Object.freeze(completed);
  }

  public clear(): void {
    this.#windows.clear();
  }
}

/** Downmix and linearly resample one window to mono 16 kHz float32 PCM. */
export function mono16Khz(window: AudioWindow): Float32Array {
  return resample(downmix(window.samples, window.channelCount), window.sampleRateHz);
}

export function downmix(samples: Float32Array, channelCount: number): Float32Array {
  validateSamples(samples, MAXIMUM_BUFFERED_SAMPLES);
  const resolvedChannelCount = boundedInteger(
    channelCount,
    'channelCount',
    1,
    MAXIMUM_CHANNEL_COUNT,
  );
  if (samples.length % resolvedChannelCount !== 0) {
    throw new RangeError('samples length must contain complete interleaved channel frames');
  }
  if (resolvedChannelCount === 1) return new Float32Array(samples);
  const output = new Float32Array(samples.length / resolvedChannelCount);
  for (let outputIndex = 0, inputIndex = 0; inputIndex < samples.length; outputIndex += 1) {
    let total = 0;
    for (
      let channel = 0;
      channel < resolvedChannelCount;
      channel += 1, inputIndex += 1
    ) {
      total += samples[inputIndex] ?? 0;
    }
    output[outputIndex] = total / resolvedChannelCount;
  }
  return output;
}

export function resample(
  samples: Float32Array,
  sourceRateHz: number,
  targetRateHz = 16_000,
): Float32Array {
  validateSamples(samples, MAXIMUM_BUFFERED_SAMPLES);
  const sourceRate = boundedInteger(
    sourceRateHz,
    'sourceRateHz',
    MINIMUM_SAMPLE_RATE_HZ,
    MAXIMUM_SAMPLE_RATE_HZ,
  );
  const targetRate = boundedInteger(
    targetRateHz,
    'targetRateHz',
    MINIMUM_SAMPLE_RATE_HZ,
    MAXIMUM_SAMPLE_RATE_HZ,
  );
  if (sourceRate === targetRate) return new Float32Array(samples);
  const outputCount = Math.round(samples.length * targetRate / sourceRate);
  if (!Number.isSafeInteger(outputCount) || outputCount > MAXIMUM_BUFFERED_SAMPLES) {
    throw new RangeError(`resampled output exceeds ${MAXIMUM_BUFFERED_SAMPLES} samples`);
  }
  if (samples.length === 0 || outputCount === 0) return new Float32Array();
  if (samples.length === 1) return new Float32Array(outputCount).fill(samples[0] ?? 0);
  const scale = sourceRate / targetRate;
  const output = new Float32Array(outputCount);
  for (let index = 0; index < outputCount; index += 1) {
    const position = Math.min(index * scale, samples.length - 1);
    const lower = Math.trunc(position);
    const upper = Math.min(lower + 1, samples.length - 1);
    const fraction = position - lower;
    const lowerValue = samples[lower] ?? 0;
    output[index] = lowerValue + ((samples[upper] ?? lowerValue) - lowerValue) * fraction;
  }
  return output;
}

function concatenate(left: Float32Array, right: Float32Array): Float32Array {
  const sampleCount = left.length + right.length;
  if (!Number.isSafeInteger(sampleCount) || sampleCount > MAXIMUM_BUFFERED_SAMPLES) {
    throw new RangeError(`transcription window exceeds ${MAXIMUM_BUFFERED_SAMPLES} samples`);
  }
  const result = new Float32Array(sampleCount);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function validateAudioPayload(payload: Extract<SignalEnvelope['payload'], { kind: 'audio' }>): void {
  boundedInteger(
    payload.sampleRateHz,
    'sampleRateHz',
    MINIMUM_SAMPLE_RATE_HZ,
    MAXIMUM_SAMPLE_RATE_HZ,
  );
  const channelCount = boundedInteger(
    payload.channelCount,
    'channelCount',
    1,
    MAXIMUM_CHANNEL_COUNT,
  );
  const sampleCount = boundedInteger(
    payload.sampleCount,
    'sampleCount',
    1,
    MAXIMUM_FRAME_SAMPLES,
  );
  validateSamples(payload.samples, MAXIMUM_FRAME_SAMPLES);
  if (payload.samples.length !== sampleCount) {
    throw new RangeError('audio payload size does not match sampleCount');
  }
  if (sampleCount % channelCount !== 0) {
    throw new RangeError('sampleCount must contain complete interleaved channel frames');
  }
}

function targetSampleCount(
  sampleRateHz: number,
  channelCount: number,
  windowSeconds: number,
): number {
  const sampleCount = Math.trunc(sampleRateHz * channelCount * windowSeconds);
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError('window sample count must be a positive safe integer');
  }
  if (sampleCount > MAXIMUM_WINDOW_SAMPLES) {
    throw new RangeError(`window sample count exceeds ${MAXIMUM_WINDOW_SAMPLES}`);
  }
  return sampleCount;
}

function frameDurationNs(
  envelope: SignalEnvelope,
  sampleCount: number,
): bigint {
  const explicitDurationNs = envelope.timing.durationNs;
  if (explicitDurationNs !== undefined) {
    if (explicitDurationNs <= 0n) {
      throw new RangeError('durationNs must be greater than zero');
    }
    return explicitDurationNs;
  }
  const payload = envelope.payload;
  if (payload.kind !== 'audio') {
    throw new TypeError('transcription accepts only PCM audio signals');
  }
  return BigInt(Math.round(
    sampleCount / (payload.sampleRateHz * payload.channelCount) * 1_000_000_000,
  ));
}

function snapshot(window: MutableAudioWindow): AudioWindow {
  return Object.freeze({
    ...window,
    discontinuityReasons: Object.freeze([...window.discontinuityReasons]),
    samples: new Float32Array(window.samples),
  });
}

function validateSamples(samples: Float32Array, maximumSamples: number): void {
  if (!(samples instanceof Float32Array)) {
    throw new TypeError('samples must be a Float32Array');
  }
  if (samples.length > maximumSamples) {
    throw new RangeError(`samples exceed ${maximumSamples} values`);
  }
}

function finiteNumber(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be from ${minimum} through ${maximum}`);
  }
  return value;
}

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}
