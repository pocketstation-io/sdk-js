# PocketStation JavaScript documentation

Start with the job your application needs to perform. Native Node capture,
trusted control-plane lifecycle, and browser Relay media are separate exports,
so browser-safe packages do not load native code.

## Get started

- [Capture an application](getting-started/capture.md)
- [Run the examples](../examples/README.md)
- [Feed PCM from a provider, decoder, or network connection](guides/application-audio.md)
- [Feed application or provider events into a Session](guides/event-input.md)

## Build a Session

- [Route, process, and record media](guides/compose-a-session.md)
- [Reduce playback echo in a microphone](guides/echo-cancellation.md)
- [Consume Operator output](guides/signal-streams.md)
- [Run compiled extensions and managed processes](guides/extensions-and-sidecars.md)
- [Add JavaScript Sources, Operators, Connectors, and Endpoints](guides/provider-authoring.md)
- [Integrate application-owned and demo processing](guides/integrations.md)
- [Compose a source-aware voice workflow](guides/voice.md)
- [Choose media and delivery settings](concepts/route-settings.md)
- [Understand Session lifecycle and limits](concepts/session-lifecycle.md)
- [Choose Sources and handle permissions](concepts/sources-and-permissions.md)
- [Understand delivery, failures, recordings, and traces](guides/observe-a-session.md)
- [Understand native ownership and shutdown](JAVASCRIPT_SDK_DESIGN.md)

## Operate and troubleshoot

- [Capability status](JAVASCRIPT_CAPABILITY_MATRIX.md)
- [Platform support](operations/platform-support.md)
- [Troubleshooting](troubleshooting.md)
- [API map](reference/api-map.md)
- [Events, errors, and final results](reference/events-and-errors.md)
- [Browser Relay status](reference/browser-relay.md)
- [Control Session lifecycle](reference/control-plane.md)
- [Public API report](../api-reports/pocketstation-node.api.md)
- [Demo integration API report](../api-reports/pocketstation-demo.api.md)
- [Control API report](../api-reports/pocketstation-control.api.md)

The Node package is not published to npm yet. Examples use a packed local
archive and do not establish Windows, Linux, WAN, or performance support.
