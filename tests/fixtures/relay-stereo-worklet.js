class RelayStereoWindow extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.windowSamples = options.processorOptions.windowSamples;
    this.states = new Float64Array(8);
    this.squares = new Float64Array(2);
    this.coefficients = new Float64Array([
      2 * Math.cos(2 * Math.PI * 440 / sampleRate),
      2 * Math.cos(2 * Math.PI * 880 / sampleRate),
    ]);
    this.active = false;
    this.reset();
    this.port.onmessage = ({ data }) => {
      if (data === 'measure') { this.reset(); this.active = true; }
      if (data === 'cancel') this.active = false;
    };
    if (options.processorOptions.offline === true) this.active = true;
  }

  reset() {
    this.states.fill(0);
    this.squares.fill(0);
    this.samples = 0;
    this.minimumChannels = Infinity;
    this.maximumChannels = 0;
    this.firstFrame = null;
  }

  process(inputs, outputs) {
    if (!this.active) return true;
    const input = inputs[0];
    const channels = input?.length ?? 0;
    const availableSamples = input?.[0]?.length ?? outputs[0]?.[0]?.length ?? 128;
    const takeSamples = Math.min(availableSamples, this.windowSamples - this.samples);
    if (this.firstFrame === null) this.firstFrame = currentFrame;
    this.minimumChannels = Math.min(this.minimumChannels, channels);
    this.maximumChannels = Math.max(this.maximumChannels, channels);
    for (let frame = 0; frame < takeSamples; frame += 1) {
      for (let channel = 0; channel < Math.min(channels, 2); channel += 1) {
        const value = input[channel][frame];
        this.squares[channel] += value * value;
        for (let tone = 0; tone < 2; tone += 1) {
          const index = channel * 4 + tone * 2;
          const next = value + this.coefficients[tone] * this.states[index] - this.states[index + 1];
          this.states[index + 1] = this.states[index];
          this.states[index] = next;
        }
      }
    }
    this.samples += takeSamples;
    if (this.samples !== this.windowSamples) return true;
    this.active = false;
    const amplitudes = [[], []];
    for (let channel = 0; channel < 2; channel += 1) {
      for (let tone = 0; tone < 2; tone += 1) {
        const index = channel * 4 + tone * 2;
        const first = this.states[index];
        const second = this.states[index + 1];
        amplitudes[channel][tone] = 2 * Math.sqrt(Math.max(0,
          first * first + second * second - this.coefficients[tone] * first * second,
        )) / this.samples;
      }
    }
    this.port.postMessage({
      windowSamples: this.samples,
      sampleRateHz: sampleRate,
      firstContextFrame: this.firstFrame,
      endContextFrame: currentFrame + takeSamples,
      minimumChannelCount: this.minimumChannels,
      maximumChannelCount: this.maximumChannels,
      rms: [Math.sqrt(this.squares[0] / this.samples), Math.sqrt(this.squares[1] / this.samples)],
      toneAmplitudes: amplitudes,
    });
    return true;
  }
}

registerProcessor('relay-stereo-window', RelayStereoWindow);
