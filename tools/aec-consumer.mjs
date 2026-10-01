import assert from 'node:assert/strict';

// Constructors come from the isolated installed package, never from the checkout.
export async function exerciseEchoCancellation(Session, PlaybackReference) {
  const session = new Session({ frameDurationMs: 10 });
  const reference = session.audioInput('installed playback reference');
  const microphone = session.audioInput('installed microphone');
  const processed = session.echoCancel(
    microphone.output, PlaybackReference.renderedAudio(reference.output),
  );
  const output = session.audio();
  reference.output.send(output);
  processed.audio.send(output);
  const running = await session.start();
  let previous = new Float32Array(480);
  let random = 0x917ba33;
  let echoInputPower = 0;
  let echoOutputPower = 0;
  let voiceInputPower = 0;
  let voiceOutputPower = 0;
  try {
    for (let index = 0; index < 400; index += 1) {
      const playback = new Float32Array(480);
      const mic = new Float32Array(480);
      for (let sample = 0; sample < 480; sample += 1) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        if (index < 300) {
          playback[sample] = ((random >>> 0) / 0xffffffff * 2 - 1) * 0.1;
          mic[sample] = previous[sample] * 0.6;
        } else {
          mic[sample] = 0.2 * Math.sin(2 * Math.PI * 300 * (index * 480 + sample) / 48000);
        }
      }
      reference.tryWrite(playback);
      microphone.tryWrite(mic);
      const delivered = new Set();
      for (let count = 0; count < 2; count += 1) {
        const frame = await running.audio.read({ timeoutMs: 1000 });
        assert.ok(frame, 'installed AEC must deliver both stems');
        if (frame.sourceId === reference.sourceId) {
          assert.ok(!delivered.has('raw'), 'duplicate raw frame');
          assert.deepEqual(frame.samples, playback, 'AEC altered the raw reference');
          assert.equal(frame.processing, undefined);
          delivered.add('raw');
        } else {
          assert.ok(!delivered.has('processed'), 'duplicate processed frame');
          assert.equal(frame.stemId, processed.audio.id);
          assert.equal(frame.samples.length, 480);
          assert.ok(frame.samples.every(Number.isFinite));
          assert.equal(frame.processing?.inputSourceId, microphone.sourceId);
          assert.equal(frame.processing?.inputStreamId, microphone.streamId);
          assert.equal(frame.processing?.paddingSamples, 0);
          assert.equal(frame.processing?.isTail, false);
          delivered.add('processed');
          for (const value of frame.samples) {
            if (index >= 200 && index < 300) echoOutputPower += value * value;
            if (index >= 350) voiceOutputPower += value * value;
          }
        }
      }
      assert.equal(delivered.size, 2);
      for (const value of mic) {
        if (index >= 200 && index < 300) echoInputPower += value * value;
        if (index >= 350) voiceInputPower += value * value;
      }
      previous = playback;
    }
  } finally {
    reference.close();
    microphone.close();
    assert.equal((await running.stop()).success, true);
  }
  let tailFrames = 0;
  for (let index = 0; index < 4; index += 1) {
    const frame = await running.audio.read({ timeoutMs: 0 });
    assert.equal(frame?.processing?.isTail, true, 'installed reader lost the graceful-stop tail');
    assert.equal(frame.processing.inputSourceId, microphone.sourceId);
    assert.equal(frame.processing.inputSequenceNumber, 399n);
    assert.equal(frame.processing.paddingSamples, 480);
    assert.equal(frame.processing.tailOffsetSamples, index * 480);
    assert.equal(frame.samples.length, 480);
    assert.ok(frame.samples.every(Number.isFinite));
    tailFrames += 1;
  }
  assert.equal((await running.audio.read({ timeoutMs: 0 }))?.kind, 'end-of-stream');
  const observations = processed.observations();
  assert.equal(observations.state, 'stopped');
  assert.equal(observations.processedMicrophoneFramesTotal, 400n);
  assert.equal(observations.analyzedReferenceFramesTotal, 400n);
  assert.equal(observations.outputFramesTotal, 404n);
  assert.equal(observations.discardedOutputFramesTotal, 0n);
  assert.equal(observations.tailFramesTotal, 4n);
  assert.equal(observations.tailPaddingSamplesTotal, 1920n);
  assert.equal(observations.microphoneSourceId, microphone.sourceId);
  assert.equal(observations.referenceSourceId, reference.sourceId);
  assert.equal(observations.lastError, undefined);
  assert.ok(echoInputPower > 1 && voiceInputPower > 1, 'test signals must be non-silent');
  const echoPowerRatio = echoOutputPower / echoInputPower;
  const voicePowerRatio = voiceOutputPower / voiceInputPower;
  assert.ok(Number.isFinite(echoPowerRatio) && echoPowerRatio >= 0 && echoPowerRatio < 0.5,
    `installed AEC did not reduce echo: ${echoPowerRatio}`);
  assert.ok(Number.isFinite(voicePowerRatio) && voicePowerRatio > 0.5 && voicePowerRatio < 2,
    `installed AEC muted or amplified the near-end signal: ${voicePowerRatio}`);
  return {
    processedFramesTotal: Number(observations.processedMicrophoneFramesTotal),
    discardedOutputFramesTotal: Number(observations.discardedOutputFramesTotal),
    echoPowerRatio,
    voicePowerRatio,
    rawStemUnchanged: true,
    observationsRetained: true,
    terminalState: observations.state,
    tailFrames,
    tailPaddingSamplesTotal: Number(observations.tailPaddingSamplesTotal),
  };
}
