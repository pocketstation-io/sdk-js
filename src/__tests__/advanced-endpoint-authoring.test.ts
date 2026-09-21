import {
  EndpointDriverError,
  EndpointDriverObservations,
  EndpointFailureRetryability,
  EndpointManifest,
  EndpointProvider,
  EndpointShutdownMode,
  MediaCaps,
  PortSpec,
  PreparedEndpointDriver,
  RouteSettings,
  RunningEndpointDriver,
  Session,
  SignalSpec,
  defineSource,
  secret,
  type EndpointDriverItem,
  type EndpointPortInput,
  type EndpointStartGate,
} from '../node/index.js';

describe('Advanced Endpoint authoring', () => {
  it('preserves Core route context through transactional start and finalization', async () => {
    const lifecycle: string[] = [];
    const inputs: EndpointPortInput[] = [];
    const deliveries: EndpointDriverItem[] = [];
    let gateDuringStart: boolean | undefined;
    let gateDuringDelivery: boolean | undefined;
    let startGate: EndpointStartGate | undefined;

    class Running extends RunningEndpointDriver {
      public receive(delivery: EndpointDriverItem): void {
        gateDuringDelivery = startGate?.isOpen;
        deliveries.push(delivery);
      }
      public requestShutdown(mode: 'drain' | 'abort'): void {
        lifecycle.push(`shutdown:${mode}`);
      }
      public joinAndFinalize(): EndpointDriverObservations {
        lifecycle.push('join');
        return new EndpointDriverObservations({
        framesReceivedTotal: deliveries.length,
        framesDeliveredTotal: deliveries.length,
        discontinuitiesTotal: 3,
      });
      }
    }
    class Prepared extends PreparedEndpointDriver {
      public start(gate: EndpointStartGate): RunningEndpointDriver {
        startGate = gate;
        gateDuringStart = gate.isOpen;
        lifecycle.push('start');
        return new Running();
      }
      public cancelPreparation(): void { lifecycle.push('cancel'); }
    }

    const provider = new EndpointProvider({
      manifest: EndpointManifest.audio('org.example.endpoint.advanced.v1'),
      factory: (preparedInputs) => {
        inputs.push(...preparedInputs);
        lifecycle.push('prepare');
        return new Prepared();
      },
    });
    const session = new Session({ frameDurationMs: 10 });
    const source = session.audioInput('advanced endpoint');
    const registered = session.registerEndpoint(provider);
    expect(session.registerEndpoint(provider)).toBe(registered);
    const endpoint = registered.declare({
      region: 'local',
      token: secret('private'),
    });
    source.output.send(endpoint);
    source.tryWrite(new Float32Array(480).fill(0.375));
    source.close();

    const running = await session.start();
    await waitFor(() => deliveries.length === 1);
    const result = await running.stop();

    expect(result.success).toBe(true);
    expect(gateDuringStart).toBe(false);
    expect(gateDuringDelivery).toBe(true);
    expect(lifecycle).toEqual(['prepare', 'start', 'shutdown:drain', 'join']);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ portName: 'audio' });
    expect(inputs[0]?.signal.wireId).toBe('pks.signal.pcm-audio.v1');
    expect(inputs[0]?.media.kind).toBe('audio-pcm');
    expect(inputs[0]?.routeSettings.delivery.queuePressure).toBe('drop-newest');
    expect(inputs[0]?.context).toMatchObject({
      sessionId: session.id,
      endpointId: endpoint.id,
      routeId: deliveries[0]?.item.routeId,
      originKind: 'source',
    });
    expect(inputs[0]?.context.sourceId).toBeDefined();
    expect(inputs[0]?.context.streamId).toBeDefined();
    expect(inputs[0]?.context.stemId).toBeDefined();
    expect(inputs[0]?.context.sessionTimelineOriginNs).toBeGreaterThan(0n);
    expect(inputs[0]?.context.configuration.region).toBe('local');
    expect(inputs[0]?.context.configuration.token).toEqual(secret('private'));
    expect(deliveries[0]?.item.kind).toBe('audio');
    expect(deliveries[0]?.item.kind === 'audio' ? deliveries[0].item.frame.samples[0] : 0).toBe(0.375);
    expect(registered.observations()).toEqual([
      expect.objectContaining({
        endpointIds: [endpoint.id],
        framesReceivedTotal: 1n,
        framesDeliveredTotal: 1n,
        discontinuitiesTotal: 3n,
        finalized: true,
      }),
    ]);
    expect(result.metrics?.routes[0]?.endpoint.discontinuitiesTotal).toBe(3n);
  });

  it('groups several routes into one prepared runtime', async () => {
    const preparedGroups: bigint[][] = [];
    const received: EndpointDriverItem[] = [];
    class Running extends RunningEndpointDriver {
      public receive(delivery: EndpointDriverItem): void { received.push(delivery); }
    }
    class Prepared extends PreparedEndpointDriver {
      public start(): RunningEndpointDriver { return new Running(); }
    }
    const provider = new EndpointProvider({
      manifest: EndpointManifest.audio('org.example.endpoint.grouped.v1'),
      preparationGroup: () => 'shared-output',
      factory: (inputs) => {
        preparedGroups.push(inputs.map((input) => input.context.endpointId));
        return new Prepared();
      },
    });
    const session = new Session({ frameDurationMs: 10 });
    const first = session.audioInput('first');
    const second = session.audioInput('second');
    const registered = session.registerEndpoint(provider);
    const firstEndpoint = registered.declare();
    const secondEndpoint = registered.declare();
    first.output.send(firstEndpoint);
    second.output.send(secondEndpoint);
    first.tryWrite(new Float32Array(480).fill(0.25));
    second.tryWrite(new Float32Array(480).fill(-0.5));
    first.close();
    second.close();

    const running = await session.start();
    await waitFor(() => received.length === 2);
    const result = await running.stop();

    expect(result.success).toBe(true);
    expect(preparedGroups).toEqual([[firstEndpoint.id, secondEndpoint.id]]);
    expect(new Set(received.map((delivery) => delivery.input.context.endpointId))).toEqual(
      new Set([firstEndpoint.id, secondEndpoint.id]),
    );
  });

  it('delivers finite native-owned batches with explicit drop accounting', async () => {
    const batchSizes: number[] = [];
    let received = 0;
    class Running extends RunningEndpointDriver {
      public receive(): void {}
      public receiveBatch(deliveries: readonly EndpointDriverItem[]): readonly ('delivered' | 'dropped')[] {
        batchSizes.push(deliveries.length);
        received += deliveries.length;
        return deliveries.map((_delivery, index) => index % 2 === 0 ? 'delivered' : 'dropped');
      }
      public joinAndFinalize(): EndpointDriverObservations {
        return new EndpointDriverObservations({
          framesReceivedTotal: received,
          framesDeliveredTotal: received - 4,
          framesDroppedTotal: 4,
        });
      }
    }
    class Prepared extends PreparedEndpointDriver {
      public start(): RunningEndpointDriver { return new Running(); }
    }
    const provider = new EndpointProvider({
      manifest: EndpointManifest.audio('org.example.endpoint.batch.v1'),
      maximumBatchItems: 4,
      factory: () => new Prepared(),
    });
    const session = new Session({ frameDurationMs: 10 });
    const source = session.audioInput('batch', { capacityFrames: 8 });
    source.output.send(session.registerEndpoint(provider).declare());
    for (let index = 0; index < 8; index += 1) {
      source.tryWrite(new Float32Array(480).fill(index / 10));
    }
    source.close();

    const running = await session.start();
    await waitFor(() => received === 8);
    const result = await running.stop();

    expect(result.success).toBe(true);
    expect(batchSizes.some((size) => size > 1 && size <= 4)).toBe(true);
    expect(result.metrics?.routes[0]?.endpoint.framesDroppedTotal).toBe(4n);
  });

  it('delivers typed signals through the same advanced lifecycle', async () => {
    const received: EndpointDriverItem[] = [];
    class Running extends RunningEndpointDriver {
      public receive(delivery: EndpointDriverItem): void { received.push(delivery); }
    }
    class Prepared extends PreparedEndpointDriver {
      public start(): RunningEndpointDriver { return new Running(); }
    }
    const text = SignalSpec.text();
    const provider = new EndpointProvider({
      manifest: new EndpointManifest({
        operatorId: 'org.example.endpoint.signal.v1',
        inputs: [PortSpec.input('text', text)],
      }),
      factory: () => new Prepared(),
    });
    const source = defineSource({
      id: 'org.example.source.endpoint-signal.v1',
      outputs: [PortSpec.output('text', text)],
      create: () => {
        let sent = false;
        return { next: () => {
          if (sent) return undefined;
          sent = true;
          return { output: 'text', data: 'hello', terminal: true };
        } };
      },
    });
    const session = new Session();
    sourceOutput(session, source).send(session.registerEndpoint(provider).declare(), { input: 'text' });

    const running = await session.start();
    await waitFor(() => received.length === 1);
    const result = await running.stop();

    expect(result.success).toBe(true);
    expect(received[0]?.input.context.originKind).toBe('source');
    expect(received[0]?.input.context.sourceId).toBeDefined();
    expect(received[0]?.input.context.streamId).toBeDefined();
    expect(received[0]?.item.kind === 'signal' ? received[0].item.signal.payload : undefined).toEqual({
      kind: 'text',
      text: 'hello',
    });
  });

  it('retains structured delivery failures in the terminal result', async () => {
    class Running extends RunningEndpointDriver {
      public receive(): never {
        throw new EndpointDriverError('service unavailable', {
          code: 'vendor.endpoint.unavailable',
          stage: 'join-finalize',
          retryability: EndpointFailureRetryability.Retryable,
        });
      }
    }
    class Prepared extends PreparedEndpointDriver {
      public start(): RunningEndpointDriver { return new Running(); }
    }
    const provider = new EndpointProvider({
      manifest: EndpointManifest.audio('org.example.endpoint.failure.v1'),
      factory: () => new Prepared(),
    });
    const session = new Session({ frameDurationMs: 10 });
    const source = session.audioInput('failure');
    source.output.send(session.registerEndpoint(provider).declare());
    source.tryWrite(new Float32Array(480));
    source.close();

    const running = await session.start();
    await waitFor(async () => (await running.metrics()).routes[0]?.endpoint.failuresTotal === 1n);
    const result = await running.stop();

    expect(result.success).toBe(false);
    expect(result.terminalEvent?.endpointFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'vendor.endpoint.unavailable',
        retryability: 'retryable',
      }),
    ]));
  });

  it('retains a structured request-shutdown failure', async () => {
    class Running extends RunningEndpointDriver {
      public receive(): void {}
      public requestShutdown(): never {
        throw new EndpointDriverError('provider did not drain', {
          code: 'provider.drain_timeout',
          stage: 'request-stop',
          retryability: 'retryable',
        });
      }
    }
    class Prepared extends PreparedEndpointDriver {
      public start(): RunningEndpointDriver { return new Running(); }
    }
    const session = new Session({ frameDurationMs: 10 });
    const source = session.audioInput('shutdown failure');
    source.output.send(session.registerEndpoint(new EndpointProvider({
      manifest: EndpointManifest.audio('org.example.endpoint.shutdown-failure.v1'),
      factory: () => new Prepared(),
    })).declare());
    source.tryWrite(new Float32Array(480));
    source.close();

    const running = await session.start();
    const result = await running.stop();

    expect(result.success).toBe(false);
    expect(result.terminalEvent?.endpointFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'request-stop',
        code: 'provider.drain_timeout',
        retryability: 'retryable',
      }),
    ]));
  });

  it('rolls back a prepared peer when another Endpoint preparation fails', async () => {
    const lifecycle: string[] = [];
    class Running extends RunningEndpointDriver { public receive(): void {} }
    class Prepared extends PreparedEndpointDriver {
      public start(): RunningEndpointDriver { return new Running(); }
      public cancelPreparation(): void { lifecycle.push('cancel'); }
    }
    const first = new EndpointProvider({
      manifest: EndpointManifest.audio('org.example.endpoint.rollback-peer.v1'),
      factory: () => { lifecycle.push('prepare'); return new Prepared(); },
    });
    const second = new EndpointProvider({
      manifest: EndpointManifest.audio('org.example.endpoint.rollback-failure.v1'),
      factory: () => {
        throw new EndpointDriverError('configuration unavailable', {
          code: 'provider.prepare_unavailable',
          retryability: 'retryable',
        });
      },
    });
    const session = new Session({ frameDurationMs: 10 });
    const source = session.audioInput('rollback peer');
    source.output.send(session.registerEndpoint(first).declare());
    source.output.send(session.registerEndpoint(second).declare());
    source.tryWrite(new Float32Array(480));
    source.close();

    await expect(session.start()).rejects.toThrow('configuration unavailable');
    expect(lifecycle).toEqual(['prepare', 'cancel']);
  });

  it('bounds preparation and cancels prepared resources exactly once after start failure', async () => {
    const cancelled: string[] = [];
    class SlowPrepared extends PreparedEndpointDriver {
      public async start(): Promise<RunningEndpointDriver> {
        await new Promise(() => {});
        throw new Error('unreachable');
      }
      public cancelPreparation(): void { cancelled.push('cancel'); }
    }
    const provider = new EndpointProvider({
      manifest: EndpointManifest.audio('org.example.endpoint.timeout.v1'),
      deadlines: { startMs: 10 },
      factory: () => new SlowPrepared(),
    });
    const session = new Session();
    const source = session.audioInput('timeout');
    source.output.send(session.registerEndpoint(provider).declare());
    source.tryWrite(new Float32Array(960));
    source.close();

    await expect(session.start()).rejects.toBeInstanceOf(Error);
    expect(cancelled).toEqual(['cancel']);
  });

  it('supports the Session.endpoint convenience and blocks cross-Session reuse', async () => {
    const received: EndpointDriverItem[] = [];
    class Running extends RunningEndpointDriver {
      public receive(delivery: EndpointDriverItem): void { received.push(delivery); }
    }
    class Prepared extends PreparedEndpointDriver {
      public start(): RunningEndpointDriver { return new Running(); }
    }
    const provider = new EndpointProvider({
      manifest: EndpointManifest.audio('org.example.endpoint.convenience.v1'),
      factory: () => new Prepared(),
    });
    const first = new Session({ frameDurationMs: 10 });
    const second = new Session({ frameDurationMs: 10 });
    const source = first.audioInput('convenience');
    source.output.send(first.endpoint(provider, { mode: 'memory' }));
    expect(() => second.registerEndpoint(provider)).toThrow(
      'An Endpoint provider cannot be shared by different Sessions',
    );
    source.tryWrite(new Float32Array(480));
    source.close();

    const running = await first.start();
    await waitFor(() => received.length === 1);
    expect((await running.stop()).success).toBe(true);
  });

  it('validates manifests, observations, deadlines, batches, and configuration', () => {
    expect(EndpointShutdownMode).toEqual({ Drain: 'drain', Abort: 'abort' });
    expect(() => new EndpointDriverObservations({ failuresTotal: -1 })).toThrow(RangeError);
    expect(() => new EndpointDriverObservations({ failuresTotal: 18_446_744_073_709_551_616n })).toThrow(RangeError);
    expect(() => new EndpointManifest({ operatorId: '', inputs: [] })).toThrow(TypeError);
    expect(() => new EndpointManifest({
      operatorId: 'org.example.endpoint.outputs-invalid.v1',
      inputs: [PortSpec.output('bad', SignalSpec.audio())],
    })).toThrow(TypeError);
    const manifest = EndpointManifest.audio('org.example.endpoint.validation.v1');
    expect(() => new EndpointProvider({ manifest, factory: () => { throw new Error(); }, maximumBatchItems: 0 })).toThrow(RangeError);
    expect(() => new EndpointProvider({ manifest, factory: () => { throw new Error(); }, deadlines: { deliveryMs: 0 } })).toThrow(RangeError);
    const provider = new EndpointProvider({ manifest, factory: () => { throw new Error(); } });
    const session = new Session();
    expect(() => session.registerEndpoint(provider).declare({ ' bad ': 'value' })).toThrow(TypeError);
    expect(() => session.registerEndpoint(provider).declare({ bad: 1 as unknown as string })).toThrow(TypeError);
  });

  it('preserves an explicit buffered route override', async () => {
    let input: EndpointPortInput | undefined;
    class Running extends RunningEndpointDriver { public receive(): void {} }
    class Prepared extends PreparedEndpointDriver { public start(): RunningEndpointDriver { return new Running(); } }
    const provider = new EndpointProvider({
      manifest: EndpointManifest.audio('org.example.endpoint.route.v1'),
      factory: (inputs) => { input = inputs[0]; return new Prepared(); },
    });
    const session = new Session({ frameDurationMs: 10 });
    const source = session.audioInput('route');
    source.output.send(session.registerEndpoint(provider).declare({}, {
      routeSettings: RouteSettings.create(
        MediaCaps.audio({ sampleRateHz: 48_000, frameSamples: 480, channelLayout: 'mono' }),
        RouteSettings.buffered().delivery,
      ),
    }));
    source.tryWrite(new Float32Array(480));
    source.close();

    const running = await session.start();
    await waitFor(() => input !== undefined);
    expect(input?.routeSettings.delivery.queuePressure).toBe('buffer');
    expect((await running.stop()).success).toBe(true);
  });
});

function sourceOutput(session: Session, source: ReturnType<typeof defineSource>) {
  return session.source(source).output('text');
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for Endpoint state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
