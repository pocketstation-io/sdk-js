#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import process, {
  getActiveResourcesInfo,
  memoryUsage,
  resourceUsage,
} from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const options = parseArguments(process.argv.slice(2));
const packageJsonPath = resolve(options.packageRoot, 'package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const pocketstation = await import(
  pathToFileURL(resolve(options.packageRoot, 'dist/node/index.js')).href
);
const thresholdsDocument = JSON.parse(await readFile(options.thresholds, 'utf8'));
const thresholds = thresholdsDocument[options.scenario][String(options.frameDurationMs)];

if (thresholds === undefined) {
  throw new Error(
    `No ${options.scenario} thresholds exist for ${options.frameDurationMs} ms`,
  );
}

const result = await measure(pocketstation, packageJson, options, thresholds);
await writeFile(options.output, `${JSON.stringify(result, bigIntJson, 2)}\n`);
if (result.status !== 'passed') {
  const failures = result.checks
    .filter((check) => !check.passed)
    .map((check) => check.name)
    .join(', ');
  console.error(`performance thresholds failed: ${failures}`);
  process.exitCode = 1;
}

async function measure(pks, packageMetadata, configuration, limits) {
  const resourcesBefore = countResources(getActiveResourcesInfo());
  forceGarbageCollection();
  const memoryBefore = memoryUsage();
  const usageBefore = resourceUsage();
  const eventLoopBefore = performance.eventLoopUtilization();
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 1 });
  let peakRssBytes = memoryBefore.rss;
  const memorySampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, memoryUsage().rss);
  }, 100);
  memorySampler.unref();
  eventLoopDelay.enable();

  const startedAtMs = performance.now();
  let scenarioResult;
  try {
    scenarioResult = configuration.scenario === 'component'
      ? await measureApplicationAudio(pks, configuration)
      : await measurePhysicalCapture(pks, configuration);
  } finally {
    eventLoopDelay.disable();
    clearInterval(memorySampler);
  }
  const finishedAtMs = performance.now();
  const eventLoop = performance.eventLoopUtilization(eventLoopBefore);
  const usageAfter = resourceUsage();
  forceGarbageCollection();
  await wait(100);
  const memoryAfter = memoryUsage();
  peakRssBytes = Math.max(peakRssBytes, memoryAfter.rss);
  const resourcesAfter = countResources(getActiveResourcesInfo());
  const elapsedMs = finishedAtMs - startedAtMs;
  const cpuUserUs = usageAfter.userCPUTime - usageBefore.userCPUTime;
  const cpuSystemUs = usageAfter.systemCPUTime - usageBefore.systemCPUTime;
  const cpuPct = ((cpuUserUs + cpuSystemUs) / (elapsedMs * 1_000)) * 100;

  const processMetrics = {
    elapsedMs,
    cpuUserUs,
    cpuSystemUs,
    cpuPct,
    rssBeforeBytes: memoryBefore.rss,
    rssPeakBytes: peakRssBytes,
    rssAfterBytes: memoryAfter.rss,
    rssGrowthBytes: memoryAfter.rss - memoryBefore.rss,
    heapUsedBeforeBytes: memoryBefore.heapUsed,
    heapUsedAfterBytes: memoryAfter.heapUsed,
    externalBeforeBytes: memoryBefore.external,
    externalAfterBytes: memoryAfter.external,
    activeResourcesBefore: resourcesBefore,
    activeResourcesAfter: resourcesAfter,
    retainedActiveResources: addedResources(resourcesBefore, resourcesAfter),
  };
  const eventLoopMetrics = {
    utilizationPct: eventLoop.utilization * 100,
    activeMs: eventLoop.active,
    idleMs: eventLoop.idle,
    delayMs: histogramSummary(eventLoopDelay),
  };
  const checks = qualify(
    configuration,
    limits,
    scenarioResult,
    processMetrics,
    eventLoopMetrics,
  );

  return {
    schemaVersion: 1,
    status: checks.every((check) => check.passed) ? 'passed' : 'failed',
    classification:
      configuration.scenario === 'physical'
        ? 'REAL-DEVICE-MEASUREMENT'
        : 'COMPONENT-MEASUREMENT',
    scenario: configuration.scenario,
    mediaProfile: {
      sampleRateHz: 48_000,
      channelCount: 1,
      frameDurationMs: configuration.frameDurationMs,
      frameSamples: (48_000 * configuration.frameDurationMs) / 1_000,
    },
    durations: {
      warmupMs: configuration.warmupMs,
      measurementMs: configuration.measurementMs,
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      packageName: packageMetadata.name,
      packageVersion: packageMetadata.version,
      packageRoot: configuration.packageRoot,
      nativeAddonPath: await resolveNativeAddon(configuration.packageRoot),
      nativeCore: {
        version: configuration.coreVersion,
        source: configuration.coreSource,
        commit:
          configuration.coreCommit === 'unavailable'
            ? null
            : configuration.coreCommit,
      },
      sdkCommit: configuration.sdkCommit,
      hardware: configuration.hardware,
    },
    measurementPlanes: {
      sourceToRoute:
        'Source first-sample timestamp to Core route receipt on the PocketStation monotonic clock',
      routeToNode:
        'Core route receipt to Node main-thread native-read resolution on the PocketStation monotonic clock',
      nativeReadResolve:
        'Core polled-audio dequeue to Node main-thread native-read resolution on the PocketStation monotonic clock',
      javascriptCadence:
        'Successive frame observations by the JavaScript consumer on the Node performance clock',
      excluded:
        'Relay receipt, browser jitter buffer, browser playout, loudspeaker output, provider work, model work, and acoustic hearing',
    },
    thresholds: limits,
    scenarioResult,
    eventLoop: eventLoopMetrics,
    process: processMetrics,
    checks,
  };
}

async function measureApplicationAudio(pks, configuration) {
  const session = new pks.Session({
    channels: 1,
    frameDurationMs: configuration.frameDurationMs,
  });
  const input = session.audioInput('performance source', { capacityFrames: 63 });
  const routeId = input.output.send(session.audio());
  const running = await session.start();
  const observations = createFrameObservations();
  const writeTimesMs = new Map();
  const pacingStartedAtMs = performance.now();
  configuration.measurementStartMs = pacingStartedAtMs + configuration.warmupMs;
  configuration.measurementEndMs =
    configuration.measurementStartMs + configuration.measurementMs;
  const readerAbort = new AbortController();
  const reader = consumeFrames(
    running.audio,
    observations,
    configuration.measurementStartMs,
    configuration.measurementEndMs,
    writeTimesMs,
    readerAbort.signal,
  );
  const frameSamples = (48_000 * configuration.frameDurationMs) / 1_000;
  const samples = new Float32Array(frameSamples);
  samples.fill(0.125);
  let writesTotal = 0;
  const pacingEndMs = configuration.measurementEndMs;

  while (performance.now() < pacingEndMs) {
    const targetMs = pacingStartedAtMs + writesTotal * configuration.frameDurationMs;
    const remainingMs = targetMs - performance.now();
    if (remainingMs > 0) await wait(remainingMs);
    const writeStartedAtMs = performance.now();
    input.tryWrite(samples);
    if (writeStartedAtMs >= configuration.measurementStartMs) {
      writeTimesMs.set(BigInt(writesTotal), writeStartedAtMs);
    }
    writesTotal += 1;
  }
  input.close();
  await waitFor(
    () => observations.lastSequenceNumber >= BigInt(writesTotal - 1),
    2_000,
    'application-owned PCM delivery',
  );
  readerAbort.abort('measurement complete');
  await reader;
  const shutdownStartedAtMs = performance.now();
  const outcome = await running.stop();
  const shutdownMs = performance.now() - shutdownStartedAtMs;

  return summarizeScenario(
    configuration,
    observations,
    outcome,
    [routeId],
    shutdownMs,
    {
      writesTotal,
      sourceRoles: {
        generated: {
          routeId,
          sourceId: input.sourceId,
        },
      },
    },
  );
}

async function measurePhysicalCapture(pks, configuration) {
  if (
    configuration.application.length === 0 &&
    configuration.applicationProcessId === 0
  ) {
    throw new Error(
      '--application or --application-process-id is required for a physical scenario',
    );
  }
  if (configuration.microphone.length === 0) {
    throw new Error('--microphone is required for a physical scenario');
  }
  const session = new pks.Session({
    channels: 1,
    frameDurationMs: configuration.frameDurationMs,
  });
  const applicationSelection =
    configuration.applicationProcessId === 0
      ? configuration.application
      : configuration.applicationProcessId;
  const application = session.capture(pks.Source.application(applicationSelection));
  const microphone = session.capture(pks.Source.microphone(configuration.microphone));
  const output = session.audio();
  const routeIds = [application.send(output), microphone.send(output)];
  const running = await session.start();
  const observations = createFrameObservations();
  const startedAtMs = performance.now();
  configuration.measurementStartMs = startedAtMs + configuration.warmupMs;
  configuration.measurementEndMs =
    configuration.measurementStartMs + configuration.measurementMs;
  const readerAbort = new AbortController();
  const reader = consumeFrames(
    running.audio,
    observations,
    configuration.measurementStartMs,
    configuration.measurementEndMs,
    undefined,
    readerAbort.signal,
  );
  await wait(configuration.warmupMs + configuration.measurementMs);
  readerAbort.abort('measurement complete');
  await reader;
  const shutdownStartedAtMs = performance.now();
  const outcome = await running.stop();
  const shutdownMs = performance.now() - shutdownStartedAtMs;

  return summarizeScenario(
    configuration,
    observations,
    outcome,
    routeIds,
    shutdownMs,
    {
      application: configuration.application,
      applicationProcessId: configuration.applicationProcessId || undefined,
      microphone: configuration.microphone,
      sourceRoles: {
        application: {
          routeId: routeIds[0],
          sourceId: observations.sourceIdByRoute.get(routeIds[0].toString()),
        },
        microphone: {
          routeId: routeIds[1],
          sourceId: observations.sourceIdByRoute.get(routeIds[1].toString()),
        },
      },
    },
  );
}

async function consumeFrames(
  audio,
  observations,
  measurementStartMs,
  measurementEndMs,
  writeTimesMs = new Map(),
  signal,
) {
  try {
    for await (const frame of audio.frames({ timeoutMs: 100, signal })) {
      const observedAtMs = performance.now();
      observations.lastSequenceNumber = frame.sequenceNumber;
      if (observedAtMs < measurementStartMs || observedAtMs > measurementEndMs) {
        continue;
      }
      const sourceId = frame.sourceId.toString();
      observations.sourceIdByRoute.set(frame.routeId.toString(), sourceId);
      observations.framesTotal += 1;
      observations.framesBySource.set(
        sourceId,
        (observations.framesBySource.get(sourceId) ?? 0) + 1,
      );
      observeValue(
        observations.frameSamplesBySource,
        sourceId,
        frame.samples.length / frame.channelCount,
      );
      observeValue(
        observations.frameDurationNsBySource,
        sourceId,
        frame.durationNs.toString(),
      );
      const priorObservedAtMs = observations.lastObservedAtMsBySource.get(sourceId);
      if (priorObservedAtMs !== undefined) {
        observations.javascriptInterarrivalMs.push(observedAtMs - priorObservedAtMs);
      }
      observations.lastObservedAtMsBySource.set(sourceId, observedAtMs);
      observations.routeToNodeMs.push(
        nanosecondsToMilliseconds(
          frame.nodeReadResolvedAtNs - frame.routeReceivedAtNs,
        ),
      );
      if (frame.routeReceivedAtNs >= frame.timestampStartNs) {
        observeMeasurement(
          observations.sourceToRouteMsBySource,
          sourceId,
          nanosecondsToMilliseconds(
            frame.routeReceivedAtNs - frame.timestampStartNs,
          ),
        );
      }
      observations.nativeReadResolveMs.push(
        nanosecondsToMilliseconds(
          frame.nodeReadResolvedAtNs - frame.polledAtNs,
        ),
      );
      observations.endpointQueueMs.push(
        nanosecondsToMilliseconds(frame.polledAtNs - frame.endpointEnqueuedAtNs),
      );
      const writtenAtMs = writeTimesMs.get(frame.sequenceNumber);
      if (writtenAtMs !== undefined) {
        observations.writeToReadMs.push(observedAtMs - writtenAtMs);
        writeTimesMs.delete(frame.sequenceNumber);
      }
    }
  } catch (failure) {
    if (!(signal?.aborted === true && failure?.code === 'stream.aborted')) throw failure;
  }
}

function summarizeScenario(
  configuration,
  observations,
  outcome,
  routeIds,
  shutdownMs,
  details,
) {
  const routes = routeIds.map((routeId) => {
    const route = outcome.metrics?.routes.find((candidate) => candidate.routeId === routeId);
    if (route === undefined) throw new Error(`Route ${routeId} has no final metrics`);
    return {
      routeId,
      framesAttemptedTotal: route.framesAttemptedTotal,
      framesDeliveredTotal: route.delivery.framesDeliveredTotal,
      framesDroppedTotal: route.delivery.framesDroppedTotal,
      discontinuitiesTotal: route.delivery.discontinuitiesTotal,
      workerFailuresTotal: route.delivery.workerFailuresTotal,
      shutdownDiscardedTotal: route.delivery.shutdownDiscardedTotal,
      queueCapacityFrames: route.delivery.queueCapacityFrames,
      queuePeakFrames: route.delivery.queuePeakFrames,
      enqueueToReceive: latencyFromCore(route.delivery.enqueueToReceive),
      sourceToRoute: latencyFromCore(route.delivery.sourceTimestampToReceive),
    };
  });
  const captureFailuresTotal = (outcome.metrics?.sources ?? []).reduce(
    (total, source) =>
      total +
      source.capturePoolExhaustedTotal +
      source.captureDispatchQueueFullTotal +
      source.captureInvalidBufferTotal +
      source.captureOversizedBufferTotal +
      source.captureStreamErrorsTotal,
    0n,
  );
  const measurementSeconds = configuration.measurementMs / 1_000;
  const framesPerSecondBySource = Object.fromEntries(
    [...observations.framesBySource].map(([sourceId, frameCount]) => [
      sourceId,
      frameCount / measurementSeconds,
    ]),
  );
  const sourceFrameRates = Object.values(framesPerSecondBySource);
  const framesPerSecondPerSource =
    sourceFrameRates.length === 0 ? 0 : Math.min(...sourceFrameRates);
  const expectedFrameSamples =
    (48_000 * configuration.frameDurationMs) / 1_000;
  const unexpectedFrameSizesTotal = [...observations.frameSamplesBySource.values()]
    .flatMap((counts) => [...counts])
    .filter(([frameSamples]) => frameSamples !== expectedFrameSamples)
    .reduce((total, [, count]) => total + count, 0);

  return {
    ...details,
    sourceIds: [...observations.framesBySource.keys()],
    framesBySource: Object.fromEntries(observations.framesBySource),
    framesPerSecondBySource,
    frameSamplesBySource: nestedCounts(observations.frameSamplesBySource),
    frameDurationNsBySource: nestedCounts(
      observations.frameDurationNsBySource,
    ),
    sourceToRouteMsBySource: summarizedMeasurements(
      observations.sourceToRouteMsBySource,
    ),
    unexpectedFrameSizesTotal,
    framesTotal: observations.framesTotal,
    framesPerSecondPerSource,
    javascriptInterarrivalMs: summarize(observations.javascriptInterarrivalMs),
    routeToNodeMs: summarize(observations.routeToNodeMs),
    nativeReadResolveMs: summarize(observations.nativeReadResolveMs),
    endpointQueueMs: summarize(observations.endpointQueueMs),
    writeToReadMs: summarize(observations.writeToReadMs),
    routes,
    sources: outcome.metrics?.sources ?? [],
    captureFailuresTotal,
    shutdownMs,
    outcome: {
      success: outcome.success,
      disposition: outcome.disposition,
      sessionState: outcome.sessionState,
      runtimeWorkerPanicked: outcome.runtimeWorkerPanicked,
      runtimeFailuresTotal: outcome.runtimeFailuresTotal,
      sourceSendRejectionsTotal: outcome.sourceSendRejectionsTotal,
      terminalEvent: outcome.terminalEvent,
      finalizationFailuresTotal:
        outcome.captureFinalizationFailuresTotal +
        outcome.operatorFinalizationFailuresTotal +
        outcome.endpointFinalizationFailuresTotal,
    },
  };
}

function qualify(configuration, limits, scenario, processMetrics, eventLoop) {
  const routes = scenario.routes;
  const largestSourceToRouteP95Ms = Math.max(
    0,
    ...Object.values(scenario.sourceToRouteMsBySource).map(
      (measurement) => measurement.p95Ms,
    ),
  );
  const retainedActiveResourcesTotal = Object.values(
    processMetrics.retainedActiveResources,
  ).reduce((total, count) => total + count, 0);
  const expectedSourcesTotal = configuration.scenario === 'physical' ? 2 : 1;
  const checks = [
    exact(
      'observed-sources',
      scenario.sourceIds.length,
      expectedSourcesTotal,
      'sources',
    ),
    exact(
      'unexpected-frame-sizes',
      scenario.unexpectedFrameSizesTotal,
      0,
      'frames',
    ),
    minimum(
      'frames-per-second-per-source',
      scenario.framesPerSecondPerSource,
      limits.minimumFramesPerSecondPerSource,
      'frames/s/source',
    ),
    maximum(
      'route-to-node-p95',
      scenario.routeToNodeMs.p95Ms,
      limits.maximumRouteToNodeP95Ms,
      'ms',
    ),
    maximum(
      'native-read-resolve-p95',
      scenario.nativeReadResolveMs.p95Ms,
      limits.maximumNativeReadResolveP95Ms,
      'ms',
    ),
    maximum(
      'event-loop-delay-p99',
      eventLoop.delayMs.p99Ms,
      limits.maximumEventLoopDelayP99Ms,
      'ms',
    ),
    maximum(
      'event-loop-delay-max',
      eventLoop.delayMs.maxMs,
      limits.maximumEventLoopDelayMs,
      'ms',
    ),
    maximum('cpu', processMetrics.cpuPct, limits.maximumCpuPct, 'pct'),
    maximum(
      'rss-growth',
      processMetrics.rssGrowthBytes,
      limits.maximumRssGrowthBytes,
      'bytes',
    ),
    maximum('shutdown', scenario.shutdownMs, limits.maximumShutdownMs, 'ms'),
    exact(
      'route-drops',
      routes.reduce((total, route) => total + route.framesDroppedTotal, 0n),
      0n,
      'frames',
    ),
    exact(
      'route-discontinuities',
      routes.reduce((total, route) => total + route.discontinuitiesTotal, 0n),
      0n,
      'frames',
    ),
    exact(
      'route-worker-failures',
      routes.reduce((total, route) => total + route.workerFailuresTotal, 0n),
      0n,
      'failures',
    ),
    exact(
      'shutdown-discards',
      routes.reduce((total, route) => total + route.shutdownDiscardedTotal, 0n),
      0n,
      'frames',
    ),
    exact(
      'source-timestamp-invalid-order',
      routes.reduce(
        (total, route) => total + route.sourceToRoute.invalidOrderTotal,
        0n,
      ),
      0n,
      'frames',
    ),
    exact(
      'source-timestamp-missing',
      routes.reduce((total, route) => total + route.sourceToRoute.missingTotal, 0n),
      0n,
      'frames',
    ),
    exact('capture-failures', scenario.captureFailuresTotal, 0n, 'failures'),
    exact(
      'runtime-failures',
      scenario.outcome.runtimeFailuresTotal,
      0n,
      'failures',
    ),
    exact(
      'source-send-rejections',
      scenario.outcome.sourceSendRejectionsTotal,
      0n,
      'frames',
    ),
    exact(
      'finalization-failures',
      scenario.outcome.finalizationFailuresTotal,
      0n,
      'failures',
    ),
    exact('retained-active-resources', retainedActiveResourcesTotal, 0, 'resources'),
    exact('successful-outcome', scenario.outcome.success, true, 'boolean'),
  ];
  if (configuration.scenario === 'physical') {
    checks.push(
      exact(
        'source-timestamp-future',
        routes.reduce(
          (total, route) => total + route.sourceToRoute.futureTotal,
          0n,
        ),
        0n,
        'frames',
      ),
      maximum(
        'source-to-route-p95',
        largestSourceToRouteP95Ms,
        limits.maximumSourceToRouteP95Ms,
        'ms',
      ),
    );
  }
  return checks;
}

function createFrameObservations() {
  return {
    framesTotal: 0,
    framesBySource: new Map(),
    frameSamplesBySource: new Map(),
    frameDurationNsBySource: new Map(),
    sourceToRouteMsBySource: new Map(),
    sourceIdByRoute: new Map(),
    lastSequenceNumber: -1n,
    lastObservedAtMsBySource: new Map(),
    javascriptInterarrivalMs: [],
    routeToNodeMs: [],
    nativeReadResolveMs: [],
    endpointQueueMs: [],
    writeToReadMs: [],
  };
}

function observeValue(collection, sourceId, value) {
  let counts = collection.get(sourceId);
  if (counts === undefined) {
    counts = new Map();
    collection.set(sourceId, counts);
  }
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function nestedCounts(collection) {
  return Object.fromEntries(
    [...collection].map(([sourceId, counts]) => [
      sourceId,
      Object.fromEntries(counts),
    ]),
  );
}

function observeMeasurement(collection, sourceId, value) {
  let values = collection.get(sourceId);
  if (values === undefined) {
    values = [];
    collection.set(sourceId, values);
  }
  values.push(value);
}

function summarizedMeasurements(collection) {
  return Object.fromEntries(
    [...collection].map(([sourceId, values]) => [sourceId, summarize(values)]),
  );
}

function summarize(values) {
  if (values.length === 0) {
    return { samplesTotal: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samplesTotal: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.at(-1),
  };
}

function histogramSummary(histogram) {
  if (histogram.count === 0) {
    return { samplesTotal: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  return {
    samplesTotal: histogram.count,
    p50Ms: histogram.percentile(50) / 1_000_000,
    p95Ms: histogram.percentile(95) / 1_000_000,
    p99Ms: histogram.percentile(99) / 1_000_000,
    maxMs: histogram.max / 1_000_000,
  };
}

function latencyFromCore(histogram) {
  return {
    samplesTotal: histogram.samplesTotal,
    invalidOrderTotal: histogram.invalidOrderTotal,
    missingTotal: histogram.missingTotal,
    futureTotal: histogram.futureTotal,
    p50Ms: nanosecondsToMilliseconds(histogram.p50Ns),
    p95Ms: nanosecondsToMilliseconds(histogram.p95Ns),
    p99Ms: nanosecondsToMilliseconds(histogram.p99Ns),
    maxMs: nanosecondsToMilliseconds(histogram.maxNs),
  };
}

function percentile(sorted, percentage) {
  const rank = Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1);
  return sorted[rank];
}

function nanosecondsToMilliseconds(nanoseconds) {
  return Number(nanoseconds) / 1_000_000;
}

function countResources(resources) {
  return Object.fromEntries(
    [...resources]
      .sort()
      .reduce((counts, resource) => {
        counts.set(resource, (counts.get(resource) ?? 0) + 1);
        return counts;
      }, new Map()),
  );
}

function addedResources(before, after) {
  const additions = {};
  for (const [name, count] of Object.entries(after)) {
    const added = count - (before[name] ?? 0);
    if (added > 0) additions[name] = added;
  }
  return additions;
}

function minimum(name, observed, threshold, unit) {
  return {
    name,
    observed,
    threshold,
    comparison: '>=',
    unit,
    passed: observed >= threshold,
  };
}

function maximum(name, observed, threshold, unit) {
  return {
    name,
    observed,
    threshold,
    comparison: '<=',
    unit,
    passed: observed <= threshold,
  };
}

function exact(name, observed, threshold, unit) {
  return {
    name,
    observed,
    threshold,
    comparison: '==',
    unit,
    passed: observed === threshold,
  };
}

async function waitFor(predicate, timeoutMs, description) {
  const deadlineMs = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadlineMs) {
      throw new Error(`${description} did not complete within ${timeoutMs} ms`);
    }
    await wait(5);
  }
}

function forceGarbageCollection() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
}

async function resolveNativeAddon(packageRoot) {
  const nativeDirectory = resolve(packageRoot, 'native-dist');
  const entries = await readdir(nativeDirectory);
  const addon = entries.find((entry) => entry.endsWith('.node'));
  if (addon === undefined) throw new Error('Installed package has no native addon');
  return resolve(nativeDirectory, addon);
}

function parseArguments(values) {
  const toolDirectory = dirname(fileURLToPath(import.meta.url));
  const parsed = {
    scenario: '',
    frameDurationMs: 0,
    warmupMs: 1_000,
    measurementMs: 5_000,
    application: '',
    applicationProcessId: 0,
    microphone: '',
    packageRoot: process.cwd(),
    thresholds: resolve(toolDirectory, 'thresholds.json'),
    output: '',
    coreVersion: 'unavailable',
    coreSource: 'unavailable',
    coreCommit: 'unavailable',
    sdkCommit: 'unavailable',
    hardware: 'unavailable',
    measurementStartMs: 0,
    measurementEndMs: 0,
  };
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    const value = values[++index];
    if (value === undefined) throw new Error(`${name} requires a value`);
    switch (name) {
      case '--scenario':
        parsed.scenario = value;
        break;
      case '--frame-duration-ms':
        parsed.frameDurationMs = Number(value);
        break;
      case '--warmup-ms':
        parsed.warmupMs = Number(value);
        break;
      case '--measurement-ms':
        parsed.measurementMs = Number(value);
        break;
      case '--application':
        parsed.application = value;
        break;
      case '--application-process-id':
        parsed.applicationProcessId = Number(value);
        break;
      case '--microphone':
        parsed.microphone = value;
        break;
      case '--package-root':
        parsed.packageRoot = resolve(value);
        break;
      case '--thresholds':
        parsed.thresholds = resolve(value);
        break;
      case '--output':
        parsed.output = resolve(value);
        break;
      case '--core-commit':
        parsed.coreCommit = value;
        break;
      case '--core-version':
        parsed.coreVersion = value;
        break;
      case '--core-source':
        parsed.coreSource = value;
        break;
      case '--sdk-commit':
        parsed.sdkCommit = value;
        break;
      case '--hardware':
        parsed.hardware = value;
        break;
      default:
        throw new Error(`Unknown argument: ${name}`);
    }
  }
  if (!['component', 'physical'].includes(parsed.scenario)) {
    throw new Error('--scenario must be component or physical');
  }
  if (![10, 20].includes(parsed.frameDurationMs)) {
    throw new Error('--frame-duration-ms must be 10 or 20');
  }
  if (
    !Number.isSafeInteger(parsed.applicationProcessId) ||
    parsed.applicationProcessId < 0
  ) {
    throw new Error('--application-process-id must be a non-negative integer');
  }
  for (const field of ['warmupMs', 'measurementMs']) {
    if (!Number.isInteger(parsed[field]) || parsed[field] < 100 || parsed[field] > 60_000) {
      throw new Error(`${field} must be an integer from 100 through 60000`);
    }
  }
  if (parsed.output.length === 0) throw new Error('--output is required');
  return parsed;
}

function bigIntJson(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}
