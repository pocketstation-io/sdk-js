# JavaScript API map

Import native desktop features from `pocketstation/node`. Own trusted Session
lifecycle through `pocketstation/control`. Publish or receive authorized Relay
media through `pocketstation/browser`. Define provider-neutral voice values and
lifecycle interfaces through `pocketstation/voice`. The control, browser, and
voice entries never load the native addon.

| Task | Start here | Advanced API |
|---|---|---|
| Capture one application | `capture()` / `Capture` | `Session`, `Source`, `Stem` |
| Discover applications and devices | `discoverSources()` | `DiscoveredSource`, `SourceQuery` |
| Inspect microphone permission | `microphonePermissionObservation()` | `CapturePermissionLifecycle` |
| Read PCM | `running.audio` | `AudioStream`, `AudioBatch`, `AudioFrame`, `ClockDomainDescriptor`, `END_OF_STREAM` |
| Add existing PCM | `session.audioInput()` | `AudioInput`, write options and observations |
| Add application-owned JSON events | `session.eventInput()` | `EventInput`, finite capacity and observations |
| Replace obsolete generated PCM | `input.beginOutput()` / `output.cancel()` | output identity and route discard metrics |
| Send PCM or typed signals to application code | `connector()` | `ConnectorManifest`, `ConnectorDriver`, `ConnectorWorker`, `RegisteredConnector`, typed configuration and observations |
| Process typed media | `defineOperator()` | `OperatorFactory`, `SignalSpec`, `PortSpec` |
| Add a custom Source | `defineSource()` | `SourceFactory`, `SourceDriver` |
| Add a custom destination | `defineEndpoint()` | `EndpointFactory`, `EndpointContext` |
| Record independent Stems | `stem.record()` | `RecordingOutcome`, `RecordingStemOutcome` |
| Observe delivery and failures | `running.metrics()` / `running.events` | `SessionMetrics`, `SessionTrace` |
| Load trusted native code | `session.loadNativeExtensionLibrary()` | Extension descriptor and port types |
| Run an isolated process | `session.registerSidecar()` | `SidecarProcess`, `SidecarConnection` |
| Publish named audio buses | `session.relay()` / `relay.audio()` | `RelayPublisherOptions` |
| Receive one Relay AudioBus in a browser | `RelayReceiver` | direct subscriber access and [receiver observations](browser-relay.md) |
| Create and inspect remote Sessions | `ControlClient` | [bounded control operations](control-plane.md) |
| Issue receiver access | `issueSubscriberCredentials()` / `createInvitation()` | `SecretToken`, `SubscriberCredentials`, `Invitation` |
| Define finite voice composition | `Session.conversation()`, `ConversationConfig` | `Conversation.fromComponents()`, `Conversation.fromDuplex()`, provider interfaces |
| Preserve recognized-speech lineage | `TranscriptUpdate` | `ConversationTurn`, `VoiceEvent`, `ConversationOutcome` |

The checked-in [Node API report](../../etc/pocketstation-node.api.md) records
every exported signature. It is generated from the TypeScript declarations and
reviewed whenever the public API changes.

The separate [Control API report](../../etc/pocketstation-control.api.md)
records the browser-safe lifecycle surface.

The separate [Voice API report](../../etc/pocketstation-voice.api.md) records
the environment-neutral provider contracts and immutable values.
