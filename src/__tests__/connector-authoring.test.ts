import {
  Connector,
  ConnectorConfigurationConstraint,
  ConnectorConfigurationField,
  ConnectorConfigurationSchema,
  ConnectorConfigurationValue,
  ConnectorDriver,
  ConnectorError,
  ConnectorManifest,
  ConnectorWorker,
  PortSpec,
  RouteSettings,
  SignalSpec,
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

  it('keeps native lineage through the audio convenience and reuses one Core registration', async () => {
    const received: ConnectorAudioFrame[] = [];
    const destination = Connector.fromAudioHandler(
      'dev.pocketstation.test.audio-convenience.v1',
      (frame) => { received.push(frame); return 'delivered'; },
      { packageVersion: '1.0.0' },
    );
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('audio convenience');
    const first = session.destination(destination);
    const registration = session.registerConnector(destination);
    const second = registration.declare();

    expect(session.destination(destination)).toBe(first);
    expect(session.registerConnector(destination)).toBe(registration);
    expect(first.sessionId).toBe(session.id);
    expect(second.sessionId).toBe(session.id);
    expect(first.connectorId).toBeDefined();
    expect(second.connectorId).toBeDefined();
    expect(second.connectorId).not.toBe(first.connectorId);

    input.output.send(first);
    input.tryWrite(new Float32Array(480).fill(0.5));
    input.close();
    const running = await session.start();
    await waitFor(() => received.length === 1);
    expect(received[0]).toMatchObject({
      sourceId: input.sourceId,
      streamId: input.streamId,
      connectorId: first.connectorId,
      endpointId: first.id,
    });
    expect(received[0]?.routeEnqueuedAtNs).toBeGreaterThan(0n);
    expect(received[0]?.routeReceivedAtNs).toBeGreaterThanOrEqual(received[0]?.routeEnqueuedAtNs ?? 0n);
    expect((await running.stop()).success).toBe(true);
  });

  it('applies the configured capacity to every Source route', async () => {
    let delivered = 0;
    const session = new Session({ frameDurationMs: 10 });
    const application = session.audioInput('capacity application');
    const microphone = session.audioInput('capacity microphone');
    const destination = connector(() => {
      delivered += 1;
    }, { capacityFrames: 32 });
    application.output.sendTo(destination);
    microphone.output.sendTo(destination);
    application.tryWrite(new Float32Array(480));
    microphone.tryWrite(new Float32Array(480));
    application.close();
    microphone.close();

    const running = await session.start();
    await waitFor(() => delivered === 2);
    const metrics = await running.metrics();
    await running.stop();

    const connectorRoutes = metrics.routes;
    expect(connectorRoutes).toHaveLength(2);
    expect(
      connectorRoutes.every((route) => route.delivery.queueCapacityFrames === 32n),
    ).toBe(true);
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
    let stops = 0;
    class FailingConnector extends Connector {
      public send(): void {}

      public start(): void {
        throw new Error('credential rejected');
      }

      public override stop(): void {
        stops += 1;
      }
    }

    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('failing connector');
    input.output.sendTo(new FailingConnector());

    const running = await session.start();
    const result = await running.stop();

    expect(result.success).toBe(false);
    expect(result.endpointFinalizationFailuresTotal).toBeGreaterThan(0n);
    expect(stops).toBe(1);
  });

  it('rejects invalid deadlines and cross-Session reuse before capture starts', async () => {
    expect(() => connector(() => {}, { deadlineMs: 0 })).toThrow(RangeError);
    expect(() => connector(() => {}, { capacityFrames: 0 })).toThrow(RangeError);
    expect(() => connector(() => {}, { capacityFrames: 64 })).toThrow(RangeError);

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

  it('runs the manifest-driven control plane with resolved configuration and observations', async () => {
    const lifecycle: string[] = [];
    const descriptors: bigint[] = [];
    const schema = new ConnectorConfigurationSchema([
      new ConnectorConfigurationField({
        name: 'region',
        kind: 'text',
        documentation: 'Provider region.',
        requirement: 'default',
        default: 'local',
        constraints: [ConnectorConfigurationConstraint.oneOf(['local', 'remote'])],
      }),
      new ConnectorConfigurationField({
        name: 'token',
        kind: 'secret',
        documentation: 'Provider credential.',
      }),
    ]);
    const manifest = ConnectorManifest.audio('dev.pocketstation.test.connector.v1', {
      packageVersion: '1.0.0',
      configuration: schema,
      multiplicity: 'many',
    });
    const destination = Connector.withDriver(manifest, {
      preparationGroup: () => 'shared-test-provider',
      prepare: (inputs) => {
        expect(inputs).toHaveLength(2);
        expect(inputs[0]?.configuration.region?.value).toBe('local');
        expect(inputs[0]?.configuration.token?.toString()).toContain('<redacted>');
        expect(inputs[0]?.configuration.token?.exposeSecret()).toBe('secret-value');
        descriptors.push(...inputs.map((input) => input.routeId));
        return new (class extends ConnectorDriver {
          public override start(context: ConnectorContext): void {
            lifecycle.push('start');
            context.setReady();
            context.setDegraded('provider.slow');
            context.setHealthy();
          }
          public deliver(): 'delivered' {
            lifecycle.push('deliver');
            return 'delivered';
          }
          public override shutdown(mode: 'drain' | 'abort'): void {
            lifecycle.push(`shutdown:${mode}`);
          }
        })();
      },
    });
    const session = new Session({ frameDurationMs: 10 });
    const application = session.audioInput('advanced application');
    const microphone = session.audioInput('advanced microphone');
    const registered = session.registerConnector(destination);
    const endpoint = registered.declare({
      token: ConnectorConfigurationValue.secret('secret-value'),
    });
    application.output.send(endpoint, { input: 'audio' });
    microphone.output.send(endpoint, { input: 'audio' });
    application.tryWrite(new Float32Array(480).fill(0.1));
    microphone.tryWrite(new Float32Array(480).fill(0.2));
    application.close();
    microphone.close();

    const running = await session.start();
    await waitFor(() => lifecycle.filter((value) => value === 'deliver').length === 2);
    const stopped = await running.stop();

    expect(stopped.success).toBe(true);
    expect(descriptors).toHaveLength(2);
    expect(lifecycle).toEqual(['start', 'deliver', 'deliver', 'shutdown:drain']);
    expect(registered.sessionId).toBe(session.id);
    expect(registered.observation(endpoint)).toMatchObject({
      serviceStatus: {
        deliveryReadiness: 'ready',
        health: 'healthy',
        acceptsDelivery: true,
      },
      statusTransitionsTotal: 3n,
    });
    expect(registered.observations()[0]).toMatchObject({
      framesReceivedTotal: 2n,
      framesDeliveredTotal: 2n,
      framesDroppedTotal: 0n,
    });
  });

  it('supports finite worker batches, typed drops, and deadline failures', async () => {
    const manifest = ConnectorManifest.audio('dev.pocketstation.test.worker.v1', {
      packageVersion: '1.0.0',
    });
    const batchSizes: number[] = [];
    const worker = Connector.withWorker(
      manifest,
      async () => new (class extends ConnectorWorker {
        public deliverBatch(items: readonly unknown[]): 'dropped' {
          batchSizes.push(items.length);
          return 'dropped';
        }
      })(),
      { maximumBatchItems: 32 },
    );
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('worker input');
    const registered = session.registerConnector(worker);
    const endpoint = registered.declare();
    input.output.send(endpoint);
    input.tryWrite(new Float32Array(480));
    input.tryWrite(new Float32Array(480));
    input.tryWrite(new Float32Array(480));
    input.close();
    const running = await session.start();
    await waitFor(() => batchSizes.reduce((sum, size) => sum + size, 0) === 3);
    await running.stop();
    expect(batchSizes.some((size) => size > 1)).toBe(true);
    expect(registered.observations()[0]).toMatchObject({
      framesReceivedTotal: 3n,
      framesDeliveredTotal: 0n,
      framesDroppedTotal: 3n,
    });

    const timeout = Connector.withDriver(
      manifest,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new (class extends ConnectorDriver { public deliver(): void {} })();
      },
      { deadlines: { prepareMs: 1 } },
    );
    const failed = new Session();
    const failedInput = failed.audioInput('timeout input');
    failedInput.output.send(failed.registerConnector(timeout).declare());
    failedInput.close();
    await expect(failed.start()).rejects.toBeInstanceOf(Error);
  });

  it('rejects invalid advanced configuration before native startup', () => {
    const schema = new ConnectorConfigurationSchema([
      new ConnectorConfigurationField({
        name: 'count',
        kind: 'unsigned-integer',
        documentation: 'Finite count.',
        constraints: [ConnectorConfigurationConstraint.unsignedRange(1, 4)],
      }),
    ]);
    expect(() => schema.configuration({ count: 0 })).toThrow(ConnectorError);
    expect(() => schema.configuration({ unknown: 1 })).toThrow(ConnectorError);
    expect(() => ConnectorConfigurationValue.secret('').exposeSecret()).toThrow(
      ConnectorError,
    );
  });

  it('preserves complete lineage, route metadata, and typed configuration', async () => {
    const schema = new ConnectorConfigurationSchema([
      new ConnectorConfigurationField({
        name: 'token', kind: 'secret', documentation: 'Provider credential.',
      }),
      new ConnectorConfigurationField({
        name: 'timeout_ms', kind: 'duration-milliseconds', documentation: 'Timeout.',
        requirement: 'default', default: 250,
      }),
    ]);
    const manifest = ConnectorManifest.audio('dev.pocketstation.test.lineage.v1', {
      packageVersion: '1.0.0', configuration: schema,
    });
    const seen: unknown[] = [];
    const destination = Connector.withDriver(manifest, (inputs) => {
      expect(inputs[0]?.connectorId).toBe(1n);
      expect(inputs[0]?.configuration.token?.exposeSecret()).toBe('very-secret');
      expect(inputs[0]?.configuration.token?.toString()).not.toContain('very-secret');
      expect(inputs[0]?.configuration.timeout_ms?.value).toBe(250n);
      expect(inputs[0]?.routeSettings.media.kind).toBe('audio-pcm');
      return new (class extends ConnectorDriver {
        public deliver(item: unknown): 'delivered' { seen.push(item); return 'delivered'; }
      })();
    });
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('lineage input');
    const endpoint = session.destination(destination, {
      configuration: { token: ConnectorConfigurationValue.secret('very-secret') },
      routeSettings: RouteSettings.realtimeAudio(),
    });
    expect(endpoint.sessionId).toBe(session.id);
    expect(endpoint.connectorId).toBe(1n);
    const routeId = input.output.send(endpoint);
    input.tryWrite(new Float32Array(480).fill(0.25), { discontinuity: true });
    input.close();
    const running = await session.start();
    await waitFor(() => seen.length === 1);
    expect((seen[0] as { input: { endpointId: bigint; routeId: bigint }; audio: ConnectorAudioFrame })).toMatchObject({
      kind: 'audio',
      input: { endpointId: endpoint.id, connectorId: 1n, routeId },
      audio: {
        sourceId: input.sourceId, streamId: input.streamId, connectorId: 1n,
        endpointId: endpoint.id, routeId, sequenceNumber: 0n, discontinuityEpoch: 1n,
      },
    });
    expect((await running.stop()).success).toBe(true);

    expect(() => schema.configuration({ token: 'not-explicitly-secret' })).toThrow(ConnectorError);
    expect(() => new ConnectorConfigurationSchema([schema.fields[0]!, schema.fields[0]!])).toThrow(ConnectorError);
    expect(() => new ConnectorManifest({
      operatorId: 'dev.pocketstation.test.invalid.v1', packageVersion: '1.0.0',
      inputs: [PortSpec.output('audio', SignalSpec.audio())],
    })).toThrow('input');
  });

  it('preserves structured delivery failures in the terminal Session outcome', async () => {
    const manifest = ConnectorManifest.audio('dev.pocketstation.test.failure.v1', { packageVersion: '1.0.0' });
    let attempted = false;
    const destination = Connector.fromHandler(manifest, () => {
      attempted = true;
      throw new ConnectorError('provider request timed out', {
        code: 'provider.timeout', stage: 'delivery', retryability: 'retryable',
      });
    });
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('failure input');
    input.output.send(session.destination(destination));
    input.tryWrite(new Float32Array(480));
    input.close();
    const running = await session.start();
    await waitFor(() => attempted);
    const result = await running.stop();
    expect(result.success).toBe(false);
    expect(result.terminalEvent?.endpointFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'provider.timeout', retryability: 'retryable' }),
    ]));
  });

  it('expires contexts after shutdown and cancels prepared drivers on rollback', async () => {
    let retained: ConnectorContext | undefined;
    let cancelled = 0;
    const firstManifest = ConnectorManifest.audio('dev.pocketstation.test.rollback.first.v1', { packageVersion: '1.0.0' });
    const secondManifest = ConnectorManifest.audio('dev.pocketstation.test.rollback.second.v1', { packageVersion: '1.0.0' });
    const first = Connector.withDriver(firstManifest, () => new (class extends ConnectorDriver {
      public deliver(_item: unknown, context: ConnectorContext): void { retained = context; }
      public override cancelPreparation(): void { cancelled += 1; }
    })());
    const second = Connector.withDriver(secondManifest, () => {
      throw new ConnectorError('configuration unavailable', { code: 'provider.unavailable', stage: 'prepare' });
    });
    const failed = new Session();
    const source = failed.audioInput('rollback');
    source.output.send(failed.registerConnector(first).declare());
    source.output.send(failed.registerConnector(second).declare());
    await expect(failed.start()).rejects.toBeInstanceOf(Error);
    expect(cancelled).toBe(1);

    const successful = new Session({ frameDurationMs: 10 });
    const successfulSource = successful.audioInput('context');
    let delivered = false;
    const handler = Connector.fromHandler(
      ConnectorManifest.audio('dev.pocketstation.test.context.v1', { packageVersion: '1.0.0' }),
      (_item, context) => { retained = context; delivered = true; },
    );
    successfulSource.output.send(successful.destination(handler));
    successfulSource.tryWrite(new Float32Array(480));
    successfulSource.close();
    const successfulRunning = await successful.start();
    await waitFor(() => delivered);
    await successfulRunning.stop();
    expect(() => retained?.setReady()).toThrow(ConnectorError);
    try { retained?.setReady(); } catch (failure) {
      expect((failure as ConnectorError).code).toBe('connector.context_closed');
    }
  });

  it('groups separate declarations, accounts finite batch outcomes, and bounds delivery', async () => {
    const manifest = ConnectorManifest.audio('dev.pocketstation.test.grouped-worker.v1', { packageVersion: '1.0.0' });
    const prepared: bigint[][] = [];
    const sizes: number[] = [];
    const destination = Connector.withWorker(manifest, {
      preparationGroup: () => 'one-service',
      prepare: (inputs) => {
        prepared.push(inputs.map((input) => input.endpointId));
        return new (class extends ConnectorWorker {
          public deliverBatch(items: readonly unknown[]): readonly ('delivered' | 'dropped')[] {
            sizes.push(items.length);
            return items.map((_item, index) => index === 0 ? 'dropped' : 'delivered');
          }
        })();
      },
    }, { maximumBatchItems: 4 });
    const session = new Session({ frameDurationMs: 10 });
    const first = session.audioInput('first', { capacityFrames: 16 });
    const second = session.audioInput('second', { capacityFrames: 16 });
    const registered = session.registerConnector(destination);
    const firstEndpoint = registered.declare();
    const secondEndpoint = registered.declare();
    first.output.send(firstEndpoint);
    second.output.send(secondEndpoint);
    for (let index = 0; index < 4; index += 1) {
      first.tryWrite(new Float32Array(480).fill(index));
      second.tryWrite(new Float32Array(480).fill(index));
    }
    first.close(); second.close();
    const running = await session.start();
    await waitFor(() => sizes.reduce((sum, size) => sum + size, 0) === 8);
    const result = await running.stop();
    expect(result.success).toBe(true);
    expect(prepared).toEqual([[firstEndpoint.id, secondEndpoint.id]]);
    expect(sizes.every((size) => size >= 1 && size <= 4)).toBe(true);
    const [observation] = registered.observations();
    expect(observation?.framesReceivedTotal).toBe(8n);
    expect((observation?.framesDeliveredTotal ?? 0n) + (observation?.framesDroppedTotal ?? 0n)).toBe(8n);
    expect(result.metrics?.routes[0]?.endpoint.framesDroppedTotal).toBeGreaterThan(0n);
    expect(() => Connector.withWorker(manifest, async () => new (class extends ConnectorWorker { public deliverBatch(): void {} })(), { maximumBatchItems: 0 })).toThrow(RangeError);
  });

  it('enforces a finite asynchronous delivery deadline and shuts down once', async () => {
    let shutdowns = 0;
    const started = { value: false };
    const manifest = ConnectorManifest.audio('dev.pocketstation.test.deadline.v1', { packageVersion: '1.0.0' });
    const destination = Connector.withDriver(manifest, () => new (class extends ConnectorDriver {
      public async deliver(): Promise<void> { started.value = true; await new Promise(() => {}); }
      public override shutdown(): void { shutdowns += 1; }
    })(), { deadlines: { deliveryMs: 10, shutdownMs: 100 } });
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('deadline');
    input.output.send(session.destination(destination));
    input.tryWrite(new Float32Array(480));
    input.close();
    const running = await session.start();
    await waitFor(() => started.value);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const result = await running.stop();
    expect(result.success).toBe(false);
    expect(shutdowns).toBe(1);
    expect(result.terminalEvent?.endpointFailures.some((failure) => failure.code === 'javascript.connector.timeout')).toBe(true);
  });

  it('keeps concise Connector lifecycles independent and finalizes delivery failure once', async () => {
    const deliveries = [0, 0];
    const stops = [0, 0];
    class IndependentConnector extends Connector {
      public constructor(private readonly index: number, private readonly fail: boolean) { super({ deadlineMs: 50 }); }
      public send(): void {
        deliveries[this.index] = (deliveries[this.index] ?? 0) + 1;
        if (this.fail) throw new Error('delivery failed');
      }
      public override stop(): void { stops[this.index] = (stops[this.index] ?? 0) + 1; }
    }
    const session = new Session({ frameDurationMs: 10 });
    const input = session.audioInput('independent');
    input.output.sendTo(new IndependentConnector(0, false));
    input.output.sendTo(new IndependentConnector(1, true));
    input.tryWrite(new Float32Array(480));
    input.close();
    const running = await session.start();
    await waitFor(() => deliveries[0] === 1 && deliveries[1] === 1);
    const result = await running.stop();
    expect(result.success).toBe(false);
    expect(deliveries).toEqual([1, 1]);
    expect(stops).toEqual([1, 1]);
  });

  it('rejects a second implementation with the same Connector identity', () => {
    const manifest = ConnectorManifest.audio('dev.pocketstation.test.identity.v1', { packageVersion: '1.0.0' });
    const first = Connector.fromHandler(manifest, () => 'delivered');
    const second = Connector.fromHandler(manifest, () => 'dropped');
    const session = new Session();
    session.destination(first);
    expect(() => session.destination(second)).toThrow();
  });

  it('invokes idle work only for a driver that explicitly overrides it', async () => {
    let idles = 0;
    const destination = Connector.withDriver(
      ConnectorManifest.audio('dev.pocketstation.test.idle.v1', { packageVersion: '1.0.0' }),
      () => new (class extends ConnectorDriver {
        public deliver(): void {}
        public override idle(): void { idles += 1; }
      })(),
    );
    const session = new Session();
    const input = session.audioInput('idle');
    input.output.send(session.destination(destination));
    const running = await session.start();
    await waitFor(() => idles > 0);
    input.close();
    expect((await running.stop()).success).toBe(true);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for Connector delivery');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
