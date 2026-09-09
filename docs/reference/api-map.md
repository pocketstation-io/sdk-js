# JavaScript API map

Import native desktop features from `pocketstation/node`. The experimental
Relay client is available from `pocketstation/browser`; that import never loads
the native addon.

| Task | Start here | Advanced API |
|---|---|---|
| Capture one application | `capture()` / `Capture` | `Session`, `Source`, `Stem` |
| Discover applications and devices | `discoverSources()` | `DiscoveredSource`, `SourceQuery` |
| Inspect microphone permission | `microphonePermissionObservation()` | `CapturePermissionLifecycle` |
| Read PCM | `running.audio` | `AudioStream`, `AudioFrame`, `END_OF_STREAM` |
| Add existing PCM | `session.audioInput()` | `AudioInput`, write options and observations |
| Replace obsolete generated PCM | `input.beginOutput()` / `output.cancel()` | output identity and route discard metrics |
| Send PCM to application code | `connector()` | `Connector`, `ConnectorContext` |
| Process typed media | `defineOperator()` | `OperatorFactory`, `SignalSpec`, `PortSpec` |
| Add a custom Source | `defineSource()` | `SourceFactory`, `SourceDriver` |
| Add a custom destination | `defineEndpoint()` | `EndpointFactory`, `EndpointContext` |
| Record independent Stems | `stem.record()` | `RecordingOutcome`, `RecordingStemOutcome` |
| Observe delivery and failures | `running.metrics()` / `running.events` | `SessionMetrics`, `SessionTrace` |
| Load trusted native code | `session.loadNativeExtensionLibrary()` | Extension descriptor and port types |
| Run an isolated process | `session.registerSidecar()` | `SidecarProcess`, `SidecarConnection` |
| Evaluate browser Relay publishing or receiving | `RelaySession` from `pocketstation/browser` | [Current limits](browser-relay.md) |

The checked-in [Node API report](../../etc/pocketstation-node.api.md) records
every exported signature. It is generated from the TypeScript declarations and
reviewed whenever the public API changes.
