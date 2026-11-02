import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const workletSource = await readFile(new URL('./fixtures/relay-stereo-worklet.js', import.meta.url), 'utf8');

/** Test-only decoded PCM evidence. The default and optional old receiver are descriptive controls. */
export async function stereoBrowserProof(page, access, settings, timeoutMs, privateSdpPath) {
  const phaseUrl = new URL(settings.phaseControlUrl);
  if (phaseUrl.protocol !== 'http:' || phaseUrl.hostname !== '127.0.0.1'
    || phaseUrl.username || phaseUrl.password || typeof settings.phaseControlToken !== 'string') {
    throw new Error('Stereo proof requires its owned loopback phase controller');
  }
  const limits = { sampleRateHz: 48_000, windowSamples: 48_000, settleMs: 750,
    minimumRms: 0.05, minimumToneAmplitude: 0.08, minimumSeparationDb: 25, silenceRms: 0.001 };
  const result = { limits, controls: [], windows: [], phaseChanges: [], executionError: null,
    cleanup: null, negotiations: [], rendererActivations: [], passed: false, defaultIsDescriptive: true,
    rendererActivationHypothesis: 'An owned quiet HTML renderer may activate remote decode; this is an instrument hypothesis, not a product repair or established cause.' };
  try {
    const setup = await page.evaluate(async ({ access, workletSource, limits, timeoutMs }) => {
      const proof = { arms: [], controls: [], negotiations: [], privateSdp: [], peerConnections: [], rendererActivations: [], activeArm: null,
        originalPeerConnection: globalThis.RTCPeerConnection, originalWebSocket: globalThis.WebSocket };
      globalThis.__relayStereoProof = proof;
      const safeSdp = (sdp) => (sdp ?? '').split(/(?=^m=)/m).flatMap((section) => {
        if (!section.startsWith('m=audio ')) return [];
        const lines = section.split(/\r\n|\n|\r/);
        const opus = lines.flatMap((line) => /^a=rtpmap:\d+ opus\/48000\/2$/i.test(line) ? [line] : []);
        const payloads = opus.map((line) => line.match(/^a=rtpmap:(\d+)/i)[1]);
        return [{ mid: lines.find((line) => line.startsWith('a=mid:'))?.slice(6) ?? null,
          opus, parameters: lines.filter((line) => payloads.includes(/^a=fmtp:(\d+)/i.exec(line)?.[1])) }];
      });
      const recordSdp = (kind, sdp) => {
        proof.negotiations.push({ arm: proof.activeArm, kind, audio: safeSdp(sdp) });
        proof.privateSdp.push({ arm: proof.activeArm, kind, sdp: sdp ?? null });
      };
      globalThis.RTCPeerConnection = class extends proof.originalPeerConnection {
        constructor(configuration) {
          super(configuration);
          proof.peerConnections.push({ arm: proof.activeArm, connection: this });
        }
        async setLocalDescription(description) {
          await super.setLocalDescription(description);
          recordSdp('accepted-local', this.localDescription?.sdp);
        }
        async setRemoteDescription(description) {
          await super.setRemoteDescription(description);
          recordSdp('accepted-remote', this.remoteDescription?.sdp);
        }
      };
      globalThis.WebSocket = class extends proof.originalWebSocket {
        send(value) {
          const message = typeof value === 'string' ? JSON.parse(value) : null;
          if (message?.type === 'SUBSCRIBE') recordSdp('signaled', message.sdp_offer);
          return super.send(value);
        }
      };
      const moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
      const addObserver = async (context, offline = false) => {
        await context.audioWorklet.addModule(moduleUrl);
        return new AudioWorkletNode(context, 'relay-stereo-window', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCountMode: 'max', channelInterpretation: 'discrete',
          processorOptions: { windowSamples: limits.windowSamples, offline },
        });
      };
      const receiveWindow = (node, start) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { node.port.postMessage('cancel'); reject(new Error('PCM window deadline')); }, 3_000);
        node.port.onmessage = ({ data }) => { clearTimeout(timer); node.port.onmessage = null; resolve(data); };
        if (start) node.port.postMessage('measure');
      });
      proof.rendererState = (arm, event, error = null) => {
        const renderer = arm.renderer;
        const audio = renderer?.audio;
        return { arm: arm.name, sequence: arm.rendererSequence, event, observedAtMs: performance.now(),
          contextState: arm.context.state, paused: audio?.paused ?? null,
          readyState: audio?.readyState ?? null, currentTimeSeconds: audio?.currentTime ?? null,
          muted: audio?.muted ?? null, volume: audio?.volume ?? null,
          quietGain: renderer?.gain?.gain.value ?? null, mediaErrorCode: audio?.error?.code ?? null,
          trackId: renderer?.trackId ?? null, error };
      };
      proof.detachRenderer = (arm) => {
        const renderer = arm.renderer;
        if (!renderer) return [];
        const errors = [];
        for (const [name, close] of [
          ['pause', () => renderer.audio.pause()],
          ['detach', () => { renderer.audio.srcObject = null; }],
          ['source', () => renderer.source?.disconnect()],
          ['gain', () => renderer.gain?.disconnect()],
        ]) {
          try { close(); } catch (error) { errors.push({ operation: `${arm.name}:renderer:${name}`, error: String(error) }); }
        }
        proof.rendererActivations.push(proof.rendererState(arm, 'detached', errors.length ? JSON.stringify(errors) : null));
        if (errors.length === 0) arm.renderer = null;
        return errors;
      };
      const receiverSnapshot = async (arm) => {
        const connection = proof.peerConnections.filter((item) => item.arm === arm.name).at(-1)?.connection;
        const reports = connection ? await connection.getStats() : null;
        const records = new Map();
        reports?.forEach((report, id) => records.set(id, report));
        const track = arm.stream.getAudioTracks()[0] ?? null;
        const exactReceivers = connection?.getReceivers().filter((receiver) => receiver.track === track) ?? [];
        const inboundCandidates = [...records.values()].filter((report) => report.type === 'inbound-rtp'
          && (report.kind ?? report.mediaType) === 'audio');
        const matched = inboundCandidates.filter((report) => report.trackIdentifier === track?.id);
        const rawInbound = (report) => Object.fromEntries([
          'id', 'timestamp', 'type', 'ssrc', 'kind', 'mediaType', 'mid', 'trackIdentifier', 'codecId', 'transportId',
          'packetsReceived', 'bytesReceived', 'packetsLost', 'packetsDiscarded', 'jitter',
          'jitterBufferDelay', 'jitterBufferEmittedCount', 'totalSamplesReceived', 'totalSamplesDuration',
          'totalAudioEnergy', 'audioLevel', 'concealedSamples', 'silentConcealedSamples', 'concealmentEvents',
          'insertedSamplesForDeceleration', 'removedSamplesForAcceleration', 'decoderImplementation', 'playoutId',
        ].map((name) => [name, report[name] ?? null]));
        const selected = [];
        records.forEach((transport) => {
          if (transport.type !== 'transport') return;
          const pair = records.get(transport.selectedCandidatePairId);
          const candidate = (id) => {
            const value = records.get(id);
            return value ? { id, type: value.type, candidateType: value.candidateType ?? null,
              protocol: value.protocol ?? null, address: value.address ?? null, port: value.port ?? null } : null;
          };
          selected.push({ transportId: transport.id, selectedCandidatePairId: transport.selectedCandidatePairId ?? null,
            pair: pair ? { id: pair.id, type: pair.type, state: pair.state ?? null, nominated: pair.nominated ?? null,
              localCandidateId: pair.localCandidateId ?? null, remoteCandidateId: pair.remoteCandidateId ?? null } : null,
            localCandidate: candidate(pair?.localCandidateId), remoteCandidate: candidate(pair?.remoteCandidateId) });
        });
        return { receiverTrackId: track?.id ?? null, exactReceiverTrackMatches: exactReceivers.length,
          selectedInbound: exactReceivers.length === 1 && matched.length === 1 ? rawInbound(matched[0]) : null,
          inboundCandidates: inboundCandidates.map(rawInbound),
          selectedCandidatePairs: selected.length ? selected : null };
      };
      try {
        for (const control of ['stereo', 'mono', 'duplicated-mono', 'swapped', 'missing-right']) {
          const count = control === 'mono' ? 1 : 2;
          const context = new OfflineAudioContext(count, limits.windowSamples, limits.sampleRateHz);
          const node = await addObserver(context, true);
          const buffer = context.createBuffer(count, limits.windowSamples, limits.sampleRateHz);
          for (let frame = 0; frame < limits.windowSamples; frame += 1) {
            const left = 0.2 * Math.sin(2 * Math.PI * 440 * frame / limits.sampleRateHz);
            const right = 0.2 * Math.sin(2 * Math.PI * 880 * frame / limits.sampleRateHz);
            buffer.getChannelData(0)[frame] = control === 'swapped' ? right
              : control === 'mono' || control === 'duplicated-mono' ? left + right : left;
            if (count === 2) buffer.getChannelData(1)[frame] = control === 'swapped' ? left
              : control === 'duplicated-mono' ? left + right : control === 'missing-right' ? 0 : right;
          }
          const source = new AudioBufferSourceNode(context, { buffer });
          source.connect(node).connect(context.destination);
          const observed = receiveWindow(node, false);
          source.start();
          const [raw] = await Promise.all([observed, context.startRendering()]);
          proof.controls.push({ control, raw });
          source.disconnect(); node.disconnect(); node.port.close();
        }
        if (access.default === undefined || access.musicStereo === undefined) throw new Error('Both receiver arms are required');
        for (const [name, credentials] of Object.entries(access)) {
          if (!['default', 'musicStereo', 'legacy'].includes(name)) throw new Error('Unknown receiver arm');
          const sdk = await import(name === 'legacy'
            ? '/baseline-pocketstation/browser/index.js' : '/pocketstation/browser/index.js');
          const context = new AudioContext({ sampleRate: limits.sampleRateHz });
          const arm = { name, context, receiver: null, node: null, source: null, errors: [], stream: null,
            renderer: null, rendererSequence: 0 };
          proof.arms.push(arm);
          if (context.sampleRate !== limits.sampleRateHz) throw new Error('Unexpected AudioContext sample rate');
          const options = { connectTimeoutMs: timeoutMs, disconnectTimeoutMs: 2_000,
            onError: (error) => arm.errors.push({ code: error.code ?? null, message: String(error) }) };
          if (name !== 'legacy') options.audioProfile = name === 'musicStereo' ? 'music-stereo' : 'default';
          arm.receiver = new sdk.RelayReceiver({ ...credentials,
            subscriberToken: new sdk.SecretToken(credentials.subscriberToken),
            iceServers: credentials.iceServers?.map((server) => ({ ...server,
              credential: server.credential == null ? null : new sdk.SecretToken(server.credential) })),
          }, options);
          arm.node = await addObserver(context);
          const silent = new GainNode(context, { gain: 0 });
          arm.node.connect(silent).connect(context.destination);
        }
      } finally { URL.revokeObjectURL(moduleUrl); }
      document.querySelector('#start-audio').onclick = () => {
        Promise.all(proof.arms.map((arm) => arm.context.resume())).then(() => {
          proof.activated = proof.arms.every((arm) => arm.context.state === 'running');
        }).catch((error) => { proof.activationError = String(error); });
      };
      proof.attach = async (reconnect) => {
        for (const arm of proof.arms) {
          proof.activeArm = arm.name;
          const rendererErrors = proof.detachRenderer(arm);
          if (rendererErrors.length) throw new Error('Previous quiet renderer cleanup unconfirmed');
          arm.source?.disconnect();
          arm.stream = await (reconnect ? arm.receiver.reconnect() : arm.receiver.connect());
          const audio = new Audio();
          audio.volume = 1;
          audio.muted = false;
          arm.rendererSequence += 1;
          arm.renderer = { audio, source: null, gain: null, trackId: arm.stream.getAudioTracks()[0]?.id ?? null };
          // Reroute before assigning/playing the stream; the declared output graph ends at gain0.
          arm.renderer.source = arm.context.createMediaElementSource(audio);
          arm.renderer.gain = new GainNode(arm.context, { gain: 0 });
          arm.renderer.source.connect(arm.renderer.gain).connect(arm.context.destination);
          audio.srcObject = arm.stream;
          proof.rendererActivations.push(proof.rendererState(arm, 'play-start'));
          let timer;
          try {
            await Promise.race([audio.play(), new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('Quiet renderer play deadline')), timeoutMs);
            })]);
            proof.rendererActivations.push(proof.rendererState(arm, 'play-resolved'));
            if (audio.paused) throw new Error('Quiet renderer remains paused after play');
          } catch (error) {
            proof.rendererActivations.push(proof.rendererState(arm, 'play-error', String(error)));
            throw error;
          } finally { clearTimeout(timer); }
          arm.source = new MediaStreamAudioSourceNode(arm.context, { mediaStream: arm.stream });
          arm.source.connect(arm.node);
        }
        proof.activeArm = null;
      };
      proof.measure = async () => Promise.all(proof.arms.map(async (arm) => {
        if (arm.context.state !== 'running') throw new Error('AudioContext is not running');
        const before = await arm.receiver.observe();
        const inboundBefore = await receiverSnapshot(arm);
        const rendererBefore = proof.rendererState(arm, 'window-before');
        const raw = await receiveWindow(arm.node, true);
        const after = await arm.receiver.observe();
        const inboundAfter = await receiverSnapshot(arm);
        return { arm: arm.name, raw, before, after, receiverState: arm.receiver.state,
          inboundBefore, inboundAfter, rendererBefore, rendererAfter: proof.rendererState(arm, 'window-after'),
          selectedCandidatePairs: inboundAfter.selectedCandidatePairs,
          audioTrackCount: arm.stream.getAudioTracks().length, contextState: arm.context.state };
      }));
      return { controls: proof.controls, userAgent: navigator.userAgent };
    }, { access, workletSource, limits, timeoutMs });
    result.controls = setup.controls.map((value) => ({ ...value,
      evaluation: evaluateStereoWindow(value.raw, 'both', limits) }));
    result.userAgent = setup.userAgent;
    if (!result.controls.every((value) => value.evaluation.passed === (value.control === 'stereo'))) {
      throw new Error('PCM observer positive or negative control failed');
    }
    await page.click('#start-audio');
    await page.waitForFunction(() => globalThis.__relayStereoProof.activated === true
      || globalThis.__relayStereoProof.activationError !== undefined, undefined, { timeout: timeoutMs });
    await page.evaluate(async () => {
      const proof = globalThis.__relayStereoProof;
      if (proof.activationError) throw new Error(proof.activationError);
      await proof.attach(false);
    });
    for (const stage of ['initial', 'reconnected']) {
      if (stage === 'reconnected') await page.evaluate(() => globalThis.__relayStereoProof.attach(true));
      for (const phase of ['left', 'right', 'both', 'silent']) {
        const startedAtMs = Date.now();
        const response = await fetch(phaseUrl, { method: 'POST', signal: AbortSignal.timeout(5_000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.phaseControlToken}` },
          body: JSON.stringify({ phase }) });
        if (!response.ok) throw new Error(`Source phase request failed: HTTP${response.status}`);
        const changed = await response.json();
        if (changed.phase !== phase || changed.sampleRateHz !== limits.sampleRateHz
          || !Number.isSafeInteger(changed.changedAtSourceFrame) || changed.changedAtSourceFrame < 0) {
          throw new Error('Invalid source phase acknowledgment');
        }
        result.phaseChanges.push({ stage, phase, startedAtMs, acknowledgedAtMs: Date.now(), ...changed });
        await new Promise((resolve) => setTimeout(resolve, limits.settleMs));
        const windows = await page.evaluate(() => globalThis.__relayStereoProof.measure());
        result.windows.push(...windows.map((window) => ({ ...window, stage, phase,
          evaluation: evaluateStereoWindow(window.raw, phase, limits) })));
        for (const window of result.windows.slice(-windows.length)) console.log(JSON.stringify({ type: 'relay_stereo_window', ...window }));
      }
    }
  } catch (error) {
    result.executionError = String(error);
  } finally {
    try {
      const closed = await page.evaluate(async () => {
        const proof = globalThis.__relayStereoProof;
        if (!proof) return { errors: [], arms: [], negotiations: [] };
        const rendererErrors = proof.arms.flatMap((arm) => proof.detachRenderer(arm));
        const operations = proof.arms.flatMap((arm) => [
          { name: `${arm.name}:context`, close: () => arm.context.close() },
          { name: `${arm.name}:receiver`, close: () => arm.receiver?.disconnect() },
        ]);
        const outcomes = await Promise.allSettled(operations.map(async ({ close }) => {
          let timer;
          try { await Promise.race([close(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Cleanup unconfirmed after5000ms')), 5_000);
          })]); } finally { clearTimeout(timer); }
        }));
        const errors = [...rendererErrors, ...outcomes.flatMap((value, index) => value.status === 'rejected'
          ? [{ operation: operations[index].name, error: String(value.reason) }] : [])];
        const arms = proof.arms.map((arm) => {
          arm.source?.disconnect(); arm.node?.disconnect(); arm.node?.port.close();
          return { arm: arm.name, contextState: arm.context.state,
            receiverState: arm.receiver?.state ?? null, rendererClosed: arm.renderer === null, errors: arm.errors };
        });
        globalThis.RTCPeerConnection = proof.originalPeerConnection;
        globalThis.WebSocket = proof.originalWebSocket;
        return { errors, arms, negotiations: proof.negotiations, rendererActivations: proof.rendererActivations,
          controls: proof.controls, privateSdp: proof.privateSdp };
      });
      const privateBytes = JSON.stringify(closed.privateSdp ?? [], null, 2) + '\n';
      delete closed.privateSdp;
      result.cleanup = closed;
      result.negotiations = closed.negotiations;
      result.rendererActivations = closed.rendererActivations ?? [];
      if (result.controls.length === 0) result.controls = closed.controls ?? [];
      if (Buffer.byteLength(privateBytes) > 4 * 1024 * 1024) throw new Error('Private SDP output exceeds4MiB');
      await writeFile(privateSdpPath, privateBytes, { flag: 'wx', mode: 0o600 });
      result.privateSdp = { path: privateSdpPath, bytes: Buffer.byteLength(privateBytes),
        sha256: createHash('sha256').update(privateBytes).digest('hex'), privateRuntimeCredentials: true };
    } catch (error) {
      result.cleanup ??= { errors: [], arms: [] };
      result.cleanup.errors.push(String(error));
    }
  }
  const expectedWindows = Object.keys(access).length * 8;
  result.passed = result.executionError === null && result.windows.length === expectedWindows
    && result.cleanup?.errors.length === 0
    && result.cleanup.arms.every((arm) => arm.contextState === 'closed' && arm.receiverState === 'closed'
      && arm.rendererClosed && arm.errors.length === 0)
    && result.windows.every((window) => window.raw.windowSamples === limits.windowSamples
      && window.receiverState === 'connected' && window.contextState === 'running' && window.audioTrackCount === 1
      && Number.isFinite(window.before.packetsReceived) && Number.isFinite(window.after.packetsReceived)
      && window.after.packetsReceived > window.before.packetsReceived
      && (window.arm !== 'musicStereo' || window.evaluation.passed));
  return result;
}

export function evaluateStereoWindow(raw, phase, limits) {
  const values = [...(raw.rms ?? []), ...(raw.toneAmplitudes ?? []).flat()];
  const valid = raw.windowSamples === limits.windowSamples && raw.sampleRateHz === limits.sampleRateHz
    && Number.isSafeInteger(raw.firstContextFrame) && Number.isSafeInteger(raw.endContextFrame)
    && raw.endContextFrame - raw.firstContextFrame === limits.windowSamples
    && raw.minimumChannelCount === 2 && raw.maximumChannelCount === 2
    && raw.rms?.length === 2 && raw.toneAmplitudes?.length === 2
    && raw.toneAmplitudes.every((row) => row.length === 2)
    && values.every((value) => Number.isFinite(value) && value >= 0);
  if (!valid) return { passed: false, reason: 'invalid-stereo-window' };
  const ratioDb = (wanted, leakage) => 20 * Math.log10(Math.max(wanted, 1e-12) / Math.max(leakage, 1e-12));
  const leftSeparationDb = ratioDb(raw.toneAmplitudes[0][0], raw.toneAmplitudes[1][0]);
  const rightSeparationDb = ratioDb(raw.toneAmplitudes[1][1], raw.toneAmplitudes[0][1]);
  const left = raw.rms[0] >= limits.minimumRms && raw.toneAmplitudes[0][0] >= limits.minimumToneAmplitude
    && leftSeparationDb >= limits.minimumSeparationDb
    && ratioDb(raw.toneAmplitudes[0][0], raw.toneAmplitudes[0][1]) >= limits.minimumSeparationDb;
  const right = raw.rms[1] >= limits.minimumRms && raw.toneAmplitudes[1][1] >= limits.minimumToneAmplitude
    && rightSeparationDb >= limits.minimumSeparationDb
    && ratioDb(raw.toneAmplitudes[1][1], raw.toneAmplitudes[1][0]) >= limits.minimumSeparationDb;
  const passed = phase === 'left' ? left && ratioDb(raw.rms[0], raw.rms[1]) >= limits.minimumSeparationDb
    : phase === 'right' ? right && ratioDb(raw.rms[1], raw.rms[0]) >= limits.minimumSeparationDb
      : phase === 'both' ? left && right
        : phase === 'silent' && raw.rms.every((value) => value <= limits.silenceRms);
  return { passed, leftSeparationDb, rightSeparationDb };
}
