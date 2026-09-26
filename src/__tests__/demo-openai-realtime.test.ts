import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OpenAIRealtime,
  RealtimeVoiceConfig,
  type RealtimeSocket,
  TranscriptProgress,
  encodeRealtimeMicrophoneFrame,
  transcriptEventValues,
} from '../demo/index.js';
import { Session } from '../node/index.js';
import { ConversationConfig, DuplexVoiceContext } from '../voice/index.js';

describe('demo OpenAI Realtime adapter', () => {
  it.each([480, 960])('accepts a %i-sample 48 kHz microphone frame', (sampleCount) => {
    const samples = new Float32Array(sampleCount).fill(0.25);
    const encoded = encodeRealtimeMicrophoneFrame({
      sampleRateHz: 48_000,
      channelCount: 1,
      samplesF32le: new Uint8Array(samples.buffer),
    });

    expect(Buffer.from(encoded, 'base64')).toHaveLength(sampleCount);
  });

  it('retains stable transcript identity and increasing revisions', () => {
    const transcripts = new Map<string, TranscriptProgress>();
    const first = transcriptEventValues(
      transcripts,
      'conversation.item.input_audio_transcription.delta',
      { item_id: 'item-1' },
      'hello',
    );
    const second = transcriptEventValues(
      transcripts,
      'conversation.item.input_audio_transcription.delta',
      { item_id: 'item-1' },
      ' world',
    );
    const final = transcriptEventValues(
      transcripts,
      'conversation.item.input_audio_transcription.completed',
      { item_id: 'item-1' },
      'hello world',
    );

    expect(first).toEqual({
      text: 'hello',
      stablePrefix: '',
      utteranceId: 'item-1',
      transcriptRevision: 1,
      final: false,
    });
    expect(second.text).toBe('hello world');
    expect(second.transcriptRevision).toBe(2);
    expect(final.transcriptRevision).toBe(3);
    expect(final.stablePrefix).toBe('hello world');
    expect(final.final).toBe(true);
  });

  it('does not claim stable partial transcripts', () => {
    const provider = new OpenAIRealtime({ apiKey: 'test-only' });

    expect(provider.capabilities.transcriptRevisions).toBe(true);
    expect(provider.capabilities.stablePrefix).toBe(false);
  });

  it('rejects unsupported frame formats before provider transport', () => {
    expect(() => encodeRealtimeMicrophoneFrame({
      sampleRateHz: 44_100,
      channelCount: 1,
      samplesF32le: new Uint8Array(new Float32Array(480).buffer),
    })).toThrow('48 kHz mono');
    expect(() => encodeRealtimeMicrophoneFrame({
      sampleRateHz: 48_000,
      channelCount: 2,
      samplesF32le: new Uint8Array(new Float32Array(960).buffer),
    })).toThrow('48 kHz mono');
  });

  it('moves real Session PCM through a bounded socket and writes provider output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pks-openai-realtime-'));
    const socket = new FakeRealtimeSocket();
    const provider = new OpenAIRealtime({
      apiKey: 'test-only',
      socketFactory: async () => socket,
    });
    const session = new Session({ frameDurationMs: 10, recordingRoot: directory });
    const microphone = session.audioInput('microphone', {
      frameSamplesPerChannel: 480,
    });
    const output = session.audioInput('assistant', {
      frameSamplesPerChannel: 480,
    });
    output.output.record('assistant');
    const connection = provider.connect(new DuplexVoiceContext(
      session,
      microphone.output,
      output,
      new ConversationConfig(),
    ));
    const running = await session.start();
    try {
      await connection.start(running);
      await microphone.write(new Float32Array(480).fill(0.25));
      await waitUntil(() => socket.sent.some((value) => value.type === 'input_audio_buffer.append'));

      socket.receive({
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'item-1',
        delta: 'hello',
      });
      socket.receive({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'item-1',
        transcript: 'hello',
      });
      socket.receive({ type: 'response.created', response: { id: 'response-1' } });
      socket.receive({
        type: 'response.output_audio.delta',
        response_id: 'response-1',
        delta: Buffer.alloc(480).toString('base64'),
      });
      socket.receive({ type: 'response.output_audio.done', response_id: 'response-1' });
      await waitUntil(() => provider.observations.outputFramesWritten === 1);

      connection.stop();
      const outcome = await connection.wait();
      expect(outcome.success).toBe(true);
      expect(outcome.transcriptUpdatesReceived).toBe(2);
      expect(provider.observations).toMatchObject({
        inputFramesSent: 1,
        inputFramesDropped: 0,
        inputFramesDroppedBySocketPressure: 0,
        outputChunksReceived: 1,
        outputFramesWritten: 1,
      });
      expect(socket.sent[0]).toMatchObject({
        type: 'session.update',
        session: {
          audio: {
            input: {
              transcription: { model: 'gpt-4o-mini-transcribe' },
            },
          },
        },
      });
    } finally {
      await connection.close();
      microphone.close();
      output.close();
      await running.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('drops microphone frames before the WebSocket exceeds its byte bound', async () => {
    const socket = new FakeRealtimeSocket();
    const provider = new OpenAIRealtime({
      apiKey: 'test-only',
      config: new RealtimeVoiceConfig({ maximumWebSocketBufferedBytes: 1_024 }),
      socketFactory: async () => socket,
    });
    const session = new Session({ frameDurationMs: 10 });
    const microphone = session.audioInput('microphone', { frameSamplesPerChannel: 480 });
    const output = session.audioInput('assistant', { frameSamplesPerChannel: 480 });
    output.output.send(session.polledAudio());
    const connection = provider.connect(new DuplexVoiceContext(
      session,
      microphone.output,
      output,
      new ConversationConfig(),
    ));
    const running = await session.start();
    try {
      await connection.start(running);
      socket.bufferedAmount = 1_024;
      await microphone.write(new Float32Array(480).fill(0.25));
      await waitUntil(() => provider.observations.inputFramesDroppedBySocketPressure === 1);

      expect(provider.observations).toMatchObject({
        inputFramesSent: 0,
        inputFramesDropped: 1,
        inputFramesDroppedBySocketPressure: 1,
      });
      expect(socket.sent.filter((value) => value.type === 'input_audio_buffer.append')).toHaveLength(0);
    } finally {
      await connection.close();
      microphone.close();
      output.close();
      await running.stop();
    }
  });

  it('closes an opened socket when Realtime startup fails', async () => {
    const socket = new FakeRealtimeSocket({ updateSession: false });
    const provider = new OpenAIRealtime({
      apiKey: 'test-only',
      config: new RealtimeVoiceConfig({ connectTimeoutS: 0.01, closeTimeoutS: 0.1 }),
      socketFactory: async () => socket,
    });
    const session = new Session({ frameDurationMs: 10 });
    const microphone = session.audioInput('microphone', { frameSamplesPerChannel: 480 });
    const output = session.audioInput('assistant', { frameSamplesPerChannel: 480 });
    output.output.send(session.polledAudio());
    const connection = provider.connect(new DuplexVoiceContext(
      session,
      microphone.output,
      output,
      new ConversationConfig(),
    ));
    const running = await session.start();
    try {
      await expect(connection.start(running)).rejects.toThrow('session.updated timed out');
      expect(socket.closeCalls).toBe(1);
    } finally {
      microphone.close();
      output.close();
      await running.stop();
    }
  });

  it('enforces the configured close deadline', async () => {
    const socket = new FakeRealtimeSocket({ emitClose: false });
    const provider = new OpenAIRealtime({
      apiKey: 'test-only',
      config: new RealtimeVoiceConfig({ closeTimeoutS: 0.01 }),
      socketFactory: async () => socket,
    });
    const session = new Session({ frameDurationMs: 10 });
    const microphone = session.audioInput('microphone', { frameSamplesPerChannel: 480 });
    const output = session.audioInput('assistant', { frameSamplesPerChannel: 480 });
    output.output.send(session.polledAudio());
    const connection = provider.connect(new DuplexVoiceContext(
      session,
      microphone.output,
      output,
      new ConversationConfig(),
    ));
    const running = await session.start();
    try {
      await connection.start(running);
      await expect(connection.close()).rejects.toThrow('OpenAI Realtime close timed out');
      expect(socket.closeCalls).toBe(1);
    } finally {
      microphone.close();
      output.close();
      await running.stop();
    }
  });

  it('releases completed transcript state before accepting the next item', async () => {
    const socket = new FakeRealtimeSocket();
    const provider = new OpenAIRealtime({
      apiKey: 'test-only',
      socketFactory: async () => socket,
    });
    const session = new Session({ frameDurationMs: 10 });
    const microphone = session.audioInput('microphone', { frameSamplesPerChannel: 480 });
    const output = session.audioInput('assistant', { frameSamplesPerChannel: 480 });
    output.output.send(session.polledAudio());
    const connection = provider.connect(new DuplexVoiceContext(
      session,
      microphone.output,
      output,
      new ConversationConfig({ transcriptStateCapacity: 1 }),
    ));
    const running = await session.start();
    try {
      await connection.start(running);
      socket.receive({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'item-1',
        transcript: 'first',
      });
      socket.receive({
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'item-2',
        delta: 'second',
      });
      connection.stop();

      await expect(connection.wait()).resolves.toMatchObject({
        turnsCompleted: 1,
        transcriptUpdatesReceived: 2,
      });
    } finally {
      await connection.close();
      microphone.close();
      output.close();
      await running.stop();
    }
  });

  it('rejects late audio from a cancelled response and accepts a new generation', async () => {
    const socket = new FakeRealtimeSocket();
    const provider = new OpenAIRealtime({
      apiKey: 'test-only',
      socketFactory: async () => socket,
    });
    const session = new Session({ frameDurationMs: 10 });
    const microphone = session.audioInput('microphone', { frameSamplesPerChannel: 480 });
    const output = session.audioInput('assistant', { frameSamplesPerChannel: 480 });
    output.output.send(session.polledAudio());
    const connection = provider.connect(new DuplexVoiceContext(
      session,
      microphone.output,
      output,
      new ConversationConfig(),
    ));
    const running = await session.start();
    try {
      await connection.start(running);
      socket.receive({ type: 'response.created', response: { id: 'response-1' } });
      await connection.interrupt();
      socket.receive({
        type: 'response.output_audio.delta',
        response_id: 'response-1',
        delta: Buffer.alloc(480).toString('base64'),
      });
      socket.receive({ type: 'response.done', response: { id: 'response-1' } });
      socket.receive({ type: 'response.created', response: { id: 'response-2' } });
      socket.receive({
        type: 'response.output_audio.delta',
        response_id: 'response-2',
        delta: Buffer.alloc(480).toString('base64'),
      });
      socket.receive({ type: 'response.output_audio.done', response_id: 'response-2' });
      await waitUntil(() => provider.observations.outputFramesWritten === 1);

      expect(provider.observations).toMatchObject({
        outputChunksRejected: 1,
        outputGenerationsCancelled: 1,
        outputFramesWritten: 1,
      });
      expect(socket.sent).toContainEqual({
        type: 'response.cancel',
        response_id: 'response-1',
      });
    } finally {
      await connection.close();
      microphone.close();
      output.close();
      await running.stop();
    }
  });

  it('cancels a response generation when its bounded output queue drops audio', async () => {
    const socket = new FakeRealtimeSocket();
    const provider = new OpenAIRealtime({
      apiKey: 'test-only',
      config: new RealtimeVoiceConfig({ outputQueueChunks: 1 }),
      socketFactory: async () => socket,
    });
    const session = new Session({ frameDurationMs: 10 });
    const microphone = session.audioInput('microphone', { frameSamplesPerChannel: 480 });
    const output = session.audioInput('assistant', { frameSamplesPerChannel: 480 });
    output.output.send(session.polledAudio());
    const connection = provider.connect(new DuplexVoiceContext(
      session,
      microphone.output,
      output,
      new ConversationConfig(),
    ));
    const running = await session.start();
    try {
      await connection.start(running);
      socket.receive({ type: 'response.created', response: { id: 'response-1' } });
      const audio = Buffer.alloc(480).toString('base64');
      socket.receive({ type: 'response.output_audio.delta', response_id: 'response-1', delta: audio });
      socket.receive({ type: 'response.output_audio.delta', response_id: 'response-1', delta: audio });
      socket.receive({ type: 'response.output_audio.delta', response_id: 'response-1', delta: audio });
      socket.receive({ type: 'response.done', response: { id: 'response-1' } });

      expect(provider.observations).toMatchObject({
        outputChunksDropped: 1,
        outputChunksCancelled: 1,
        outputChunksRejected: 1,
        outputGenerationsCancelled: 1,
        outputFramesWritten: 0,
      });
      expect(socket.sent).toContainEqual({
        type: 'response.cancel',
        response_id: 'response-1',
      });
    } finally {
      await connection.close();
      microphone.close();
      output.close();
      await running.stop();
    }
  });
});

class FakeRealtimeSocket implements RealtimeSocket {
  public readonly readyState = 1;
  public bufferedAmount = 0;
  public readonly sent: Record<string, unknown>[] = [];
  public closeCalls = 0;
  readonly #updateSession: boolean;
  readonly #emitClose: boolean;
  readonly #listeners = new Map<string, ((...values: never[]) => void)[]>();

  public constructor(options: {
    readonly updateSession?: boolean;
    readonly emitClose?: boolean;
  } = {}) {
    this.#updateSession = options.updateSession ?? true;
    this.#emitClose = options.emitClose ?? true;
  }

  public send(data: string): void {
    const value = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(value);
    if (value.type === 'session.update' && this.#updateSession) {
      queueMicrotask(() => this.receive({ type: 'session.updated' }));
    }
  }

  public close(): void {
    this.closeCalls += 1;
    if (this.#emitClose) this.#emit('close', 1000, Buffer.alloc(0));
  }

  public on(event: 'message', listener: (data: unknown) => void): this;
  public on(event: 'close', listener: (code: number, reason: unknown) => void): this;
  public on(event: 'error', listener: (failure: Error) => void): this;
  public on(event: string, listener: (...values: never[]) => void): this {
    const listeners = this.#listeners.get(event) ?? [];
    listeners.push(listener);
    this.#listeners.set(event, listeners);
    return this;
  }

  public receive(value: Readonly<Record<string, unknown>>): void {
    this.#emit('message', Buffer.from(JSON.stringify(value)));
  }

  #emit(event: string, ...values: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      Reflect.apply(listener, this, values);
    }
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
