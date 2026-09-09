# Troubleshooting

## The application is not found

Confirm the application is running and use its exact display name or native
application ID. If several processes share a name, call `discoverSources()`
and pass the selected stable identity to `Source.application()`.

## Capture starts but no audio arrives

Check `running.events` and `running.metrics()` before assuming silence is an
empty stream. Confirm that the selected application is producing audio, the
Stem was sent to `session.audio()`, and the host process has the required
operating-system permission.

## The microphone is unavailable

Call `microphonePermissionObservation()` without prompting and show the result
to the user. Request permission from a user action. If the device changed or
disappeared, rediscover devices and start a new Session with the chosen ID.

## A consumer falls behind

Inspect the matching route's queue depth, accepted frames, delivered frames,
drops, rejections, and latency. Choose `RouteSettings` deliberately for that
consumer. Do not add an unbounded JavaScript queue to hide the problem.

## Shutdown takes longer than expected

`stop()` finishes accepted work. Use `cancel()` when prompt shutdown is more
important than draining pending provider or recording work. Always inspect the
returned `StopResult`; a resolved Promise does not by itself mean every
destination finalized successfully.

## A trace cannot be read

`SessionTrace.read()` verifies the file checksum before parsing records. Keep
the original file unchanged and inspect the trace error returned by shutdown.
An incomplete or modified artifact is rejected rather than partially trusted.

## The native addon does not load

The package is not published to npm and only the local macOS build
has passed the packed consumer. Confirm Node 20.17 or newer, build the native
addon for the current target, and import desktop APIs from `pocketstation/node`.
