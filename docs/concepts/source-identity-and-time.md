# Source identity and media time

Every audio frame identifies the Source, Stream, and Stem that produced it.
Those values let an application keep microphone, selected-application, system,
and generated audio separate even when they share one destination.

`sourceId`, `streamId`, `stemId`, sequence values, discontinuity epochs, and
nanosecond timestamps are JavaScript `bigint`. Converting them to `number`
would lose precision during long Sessions.

`timestampStartNs` and `durationNs` describe the frame in its declared clock.
`routeEnqueuedAtNs`, `routeReceivedAtNs`, `endpointEnqueuedAtNs`, and
`polledAtNs` describe its progress through the Session and into Node. These
values answer different questions and should not be subtracted unless the
metrics explicitly state that their clocks are comparable.

A discontinuity epoch changes when media continuity is broken. Keep it with
the frame when batching, transcribing, recording, or sending media to another
service. Do not hide the gap by renumbering later frames.

Derived signals retain their original Source lineage and name the Operator that
produced them. Provider code can keep that lineage when emitting a result, so
delivery failures and timing remain associated with the correct input Stem.
