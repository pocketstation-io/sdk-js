import {
  Connector,
  connector,
  Session,
  type ConnectorAudioFrame,
  type ConnectorContext,
} from '../node/index.js';

describe('Connector authoring', () => {
  it('uses one class instance for multiple source-aware routes', async () => {
    const lifecycle: string[] = [];
    const received: ConnectorAudioFrame[] = [];

    class MemoryConnector extends Connector {
      public async start(): Promise<void> {
        lifecycle.push('start');
      }

      public async send(frame: ConnectorAudioFrame): Promise<void> {
        received.push(frame);
      }

      public async stop(mode: 'drain' | 'abort'): Promise<void> {
        lifecycle.push(`stop:${mode}`);
      }
    }

    const session = new Session({ frameDurationMs: 10 });
    const application = session.audioInput('application');
    const microphone = session.audioInput('microphone');
    const destination = new MemoryConnector();
    application.output.sendTo(destination);
    microphone.output.sendTo(destination);
    application.tryWrite(new Float32Array(480).fill(0.25));
    microphone.tryWrite(new Float32Array(480).fill(-0.5));
    application.close();
    microphone.close();

    const running = await session.start();
    await waitFor(() => received.length === 2);
    const outcome = await running.stop();

    expect(outcome.success).toBe(true);
    expect(lifecycle).toEqual(['start', 'stop:drain']);
    expect(received).toHaveLength(2);
    expect(new Set(received.map((frame) => frame.sourceId)).size).toBe(2);
    expect(received.map((frame) => frame.samples[0]).sort()).toEqual([-0.5, 0.25]);
    expect(received.every((frame) => frame.sequenceNumber === 0n)).toBe(true);
  });

  it('creates a Connector from one delivery function', async () => {
    const samples: number[] = [];
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('function connector');
    input.output.sendTo(
      connector((frame) => {
        samples.push(frame.samples[0] ?? Number.NaN);
      }),
    );
    input.tryWrite(new Float32Array(480).fill(0.75));
    input.close();

    const running = await session.start();
    await waitFor(() => samples.length === 1);
    await running.stop();

    expect(samples).toEqual([0.75]);
  });

  it('propagates Session cancellation through AbortSignal', async () => {
    let observedAbort = false;
    let deliveryStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      deliveryStarted = resolve;
    });
    class WaitingConnector extends Connector {
      public send(_frame: ConnectorAudioFrame, context: ConnectorContext): Promise<void> {
        deliveryStarted();
        return new Promise((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => {
              observedAbort = true;
              resolve();
            },
            { once: true },
          );
        });
      }
    }

    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('cancel connector');
    input.output.sendTo(new WaitingConnector({ deadlineMs: 1_000 }));
    input.tryWrite(new Float32Array(480));
    input.close();
    const running = await session.start();
    await started;

    const result = await running.cancel();

    expect(result.disposition).toBe('cancelled');
    expect(observedAbort).toBe(true);
  });

  it('reports a rejected startup promise without terminating Node.js', async () => {
    class FailingConnector extends Connector {
      public send(): void {}

      public start(): void {
        throw new Error('credential rejected');
      }
    }

    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('failing connector');
    input.output.sendTo(new FailingConnector());

    const running = await session.start();
    const result = await running.stop();

    expect(result.success).toBe(false);
    expect(result.endpointFinalizationFailuresTotal).toBeGreaterThan(0n);
  });

  it('rejects invalid deadlines and cross-Session reuse before capture starts', async () => {
    expect(() => connector(() => {}, { deadlineMs: 0 })).toThrow(RangeError);

    const destination = connector(() => {});
    const first = new Session();
    const second = new Session();
    const input = first.audioInput('first');
    input.output.send(first.destination(destination));

    expect(() => second.destination(destination)).toThrow(
      'A Connector object cannot be shared by different Sessions',
    );
    input.close();
    await (await first.start()).cancel();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for Connector delivery');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
