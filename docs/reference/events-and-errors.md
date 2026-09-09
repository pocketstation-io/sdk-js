# Events, errors, and final results

PocketStation uses exceptions for an operation that cannot begin or continue,
Session events for runtime changes, and `StopResult` for final cleanup.

## Startup errors

`SessionStartError` includes a stable code and may include a
`CompileDiagnostic` naming the route, node, Operator, or port that failed
validation. Capture permission, missing applications, incompatible media, and
invalid declarations are reported before a `RunningSession` is returned.

## Runtime events

`running.events` is an async stream of closed event variants:

- lifecycle state changes;
- Source failures;
- Endpoint failures;
- rollback and finalization failures;
- the terminal Session event.

Use the `type` field to narrow an event. Unknown native variants are rejected
instead of being treated as a known success.

## Stream results

A direct read returns `undefined` when its wait expires and `END_OF_STREAM`
when no more values can arrive. Cancellation uses `AbortSignal` and does not
stop the Session unless application code calls `cancel()`.

Audio input has separate errors for a full queue, timeout, cancellation,
invalid data, and a closed input. Provider and sidecar errors identify their
lifecycle operation and preserve cleanup in the final Session result.

## StopResult

`stop()` and `cancel()` return:

- the requested termination disposition and terminal Session state;
- retained runtime and finalization failure totals;
- final Core metrics when available;
- the complete terminal event;
- multistem recording and trace results when configured;
- final sidecar state and queue counts.

An unavailable result stays absent and includes a reason when Core provides
one. A zero counter means Core measured zero; it is not used as a substitute
for an unavailable measurement.
