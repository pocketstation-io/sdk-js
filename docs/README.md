# PocketStation JavaScript documentation

Start with the job your application needs to perform. The native Node package
and the browser receiver are separate exports and can be installed together
without loading native code in a browser build.

## Get started

- [Capture an application](../README.md#capture-an-application)
- [Add a microphone only when the user asks for it](../README.md#add-a-microphone)
- [Discover applications and devices](../README.md#discover-sources-before-capture)
- [Feed PCM from a provider, decoder, or network connection](guides/application-audio.md)

## Build a Session

- [Route, process, and record media](guides/compose-a-session.md)
- [Consume Operator output](guides/signal-streams.md)
- [Run compiled extensions and managed processes](guides/extensions-and-sidecars.md)
- [Add JavaScript Sources, Operators, Connectors, and Endpoints](guides/provider-authoring.md)
- [Choose media and delivery settings](concepts/route-settings.md)
- [Understand native ownership and shutdown](JAVASCRIPT_SDK_DESIGN.md)

## Check current support

- [Capability status](JAVASCRIPT_CAPABILITY_MATRIX.md)
- [Public API report](../etc/pocketstation-node.api.md)

The Node package is not published to npm yet. Examples in this repository run
against the local package candidate and do not establish Windows, Linux, WAN,
or performance support.
