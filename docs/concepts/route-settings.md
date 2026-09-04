# Choose media and delivery settings

Each call to `send()` or `connect()` creates an independent route. Normal APIs
select settings suitable for realtime PCM, typed signals, or recording. Use
`RouteSettings` only when a destination needs to state those choices itself.

Two values describe a route:

- `MediaCaps` states the signal representation the destination accepts.
- `DeliveryPolicy` states what happens when the destination cannot keep up.

Keeping those decisions separate prevents queue behavior from being mistaken
for an audio format requirement.

## Start with a preset

Use realtime audio for callback-fed PCM:

```ts
const settings = RouteSettings.realtimeAudio();
const output = session.audio(settings);
```

Use the buffered preset for off-realtime signals:

```ts
const settings = RouteSettings.buffered();
```

Both presets use finite native capacity. Neither creates a JavaScript queue.

## State an exact audio format

```ts
const media = MediaCaps.audio({
  sampleRateHz: 48_000,
  frameSamples: 480,
  channelLayout: "mono",
});

const settings = RouteSettings.create(
  media,
  DeliveryPolicy.realtimeAudio(),
);
```

Core negotiates connected ports and rejects incompatible media before capture
starts. `MediaCaps.negotiate()` exposes the same native negotiation when a
provider package needs to inspect it during configuration.

## Choose queue pressure deliberately

```ts
const delivery = DeliveryPolicy.realtimeAudio()
  .withQueuePressure("drop-oldest")
  .withFrameOwnership("copy");
```

The available queue-pressure choices are:

| Value | Behavior |
|---|---|
| `drop-newest` | Keep data already accepted and reject the arriving item. |
| `drop-oldest` | Remove the oldest queued item so fresher media can proceed. |
| `buffer` | Permit waiting only on work Core has classified as off-realtime. |
| `fail` | Report saturation instead of waiting or discarding silently. |

Core rejects a blocking delivery choice on capture callbacks or realtime
workers. Increasing capacity can retain older media, so it is not a substitute
for measuring destination latency and fixing a slow consumer.

Frame ownership (`move`, `share`, or `copy`) is also compiled by Core. A move
cannot be used where the same frame fans out to several destinations.

## Preserve failures and gaps

Dropped media, restarted Sources, clock resets, and failed destinations remain
observable. PocketStation does not renumber a stream to hide missing frames.
Read Session events and final results before retrying a destination or claiming
that a recording completed.
