import assert from 'node:assert/strict';

const node = await import('pocketstation/node');
assert.equal(typeof node.RuntimeCompatibility, 'function');
assert.equal(node.runtimeCompatibility.sdkVersion, '0.1.4');
assert.equal(node.runtimeCompatibility.coreVersion, '1.1.12');
for (const identity of [
  node.ClockDomainId,
  node.ConnectorId,
  node.EndpointId,
  node.OperatorInstanceId,
  node.RouteId,
  node.RuntimeSessionId,
  node.SidecarId,
  node.SourceId,
  node.SourceInstanceId,
  node.StemId,
  node.StreamId,
]) {
  assert.equal(typeof identity, 'function');
}
assert.equal(node.SourceId(42n), 42n);
assert.equal(typeof node.Session, 'function');
assert.equal(typeof node.Source, 'function');
assert.equal(typeof node.RunningSession, 'function');
assert.equal(typeof node.Capture, 'function');
assert.equal(typeof node.capture, 'function');
assert.equal(typeof node.discoverSources, 'function');
assert.equal(typeof node.microphonePermissionObservation, 'function');
assert.equal(typeof node.CapturePermissionLifecycle, 'function');
assert.equal(typeof node.EventStream, 'function');
assert.equal(typeof node.SignalSpec, 'function');
assert.equal(typeof node.MediaCaps, 'function');
assert.equal(typeof node.DeliveryPolicy, 'function');
assert.equal(typeof node.RouteSettings, 'function');
assert.equal(typeof node.Operator, 'function');
assert.equal(typeof node.EndpointDefinition, 'function');
assert.equal(typeof node.SessionStartError, 'function');
assert.equal(typeof node.AudioInput, 'function');
assert.equal(typeof node.AudioInputFullError, 'function');
assert.equal(typeof node.AudioInputTimeoutError, 'function');
assert.equal(typeof node.EventInput, 'function');
assert.equal(typeof node.EventInputError, 'function');
assert.equal(typeof node.EventInputFullError, 'function');
assert.equal(typeof node.EventInputClosedError, 'function');
assert.equal(typeof node.Session.prototype.eventInput, 'function');
assert.equal(typeof node.OutputGeneration, 'function');
assert.equal(typeof node.OutputCancelledError, 'function');
assert.equal(typeof node.OutputOwnershipError, 'function');
assert.equal(typeof node.SourceOutput, 'function');
assert.equal(typeof node.SourceInstance, 'function');
assert.equal(typeof node.ExtensionAbiVersion, 'function');
assert.equal(typeof node.ExtensionDescriptor, 'function');
assert.equal(typeof node.ExtensionPort, 'function');
assert.equal(typeof node.SidecarProcess, 'function');
assert.equal(typeof node.SidecarMessage, 'function');
assert.equal(typeof node.SidecarConnection, 'function');
assert.equal(typeof node.SidecarSnapshot, 'function');
assert.equal(typeof node.SidecarStream, 'function');
assert.equal(typeof node.PublisherActivation, 'function');
assert.equal(typeof node.ReceiverActivation, 'function');
assert.equal(typeof node.ReceiverInvitation, 'function');
assert.equal(typeof node.InvitationUnavailableError, 'function');
assert.equal(typeof node.SecretUrl, 'function');
assert.equal(typeof node.RelayError, 'function');
assert.equal(typeof node.RelayRoute, 'function');
assert.equal(typeof node.RelaySession, 'function');
assert.equal(typeof node.RelayTimeoutError, 'function');
assert.equal(typeof node.Connector, 'function');
assert.equal(typeof node.connector, 'function');
assert.equal(typeof node.SourceFactory, 'function');
assert.equal(typeof node.defineSource, 'function');
assert.equal(typeof node.OperatorFactory, 'function');
assert.equal(typeof node.defineOperator, 'function');
assert.equal(typeof node.EndpointFactory, 'function');
assert.equal(typeof node.defineEndpoint, 'function');
assert.equal(typeof node.ExtensionError, 'function');
assert.equal(typeof node.SidecarError, 'function');
assert.equal(typeof node.SidecarBackpressureError, 'function');
assert.equal(typeof node.BusSubscription, 'function');
assert.equal(typeof node.SignalStream, 'function');
assert.equal(typeof node.EndOfStream, 'function');
assert.equal(node.END_OF_STREAM.kind, 'end-of-stream');
assert.equal(typeof node.StreamAbortError, 'function');

const browser = await import('pocketstation/browser');
assert.equal(typeof browser.RelayPublisher, 'function');
assert.equal(typeof browser.RelayReceiver, 'function');
assert.equal(typeof browser.resolveRelayInvitation, 'function');
assert.equal(typeof browser.parseRelayInvitationLocation, 'function');
assert.equal(typeof browser.InvitationUnavailableError, 'function');
assert.equal(typeof browser.SecretToken, 'function');
assert.equal(typeof browser.PocketStationError, 'function');
assert.deepEqual(Object.keys(browser).sort(), [
  'InvitationUnavailableError',
  'PocketStationError',
  'RelayPublisher',
  'RelayReceiver',
  'SecretToken',
  'parseRelayInvitationLocation',
  'resolveRelayInvitation',
]);

const control = await import('pocketstation/control');
assert.equal(typeof control.ControlClient, 'function');
assert.equal(typeof control.ControlPlaneError, 'function');
assert.equal(typeof control.InvitationUnavailableError, 'function');
assert.equal(typeof control.SecretToken, 'function');
assert.equal(typeof control.SecretUrl, 'function');
assert.equal(typeof control.SessionId, 'function');
assert.equal(typeof control.SessionOwner, 'function');
assert.deepEqual(Object.keys(control).sort(), [
  'ControlClient',
  'ControlPlaneError',
  'InvitationUnavailableError',
  'PocketStationError',
  'SecretToken',
  'SecretUrl',
  'SessionId',
  'SessionOwner',
]);
const redacted = new control.SecretToken('package-resolution-secret');
assert.equal(String(redacted), "SecretToken('[redacted]')");
assert.equal(JSON.stringify(redacted), '"[redacted]"');

const voice = await import('pocketstation/voice');
assert.equal(typeof voice.ConversationConfig, 'function');
assert.equal(typeof voice.TranscriptUpdate, 'function');
assert.equal(typeof voice.ResponseChunk, 'function');
assert.equal(typeof voice.SynthesisChunk, 'function');
assert.equal(typeof voice.SpeechActivity, 'function');
assert.equal(typeof voice.VoiceError, 'function');
assert.equal(typeof voice.Conversation, 'function');
assert.equal(typeof voice.RunningConversation, 'function');
assert.equal(typeof voice.declareConversation, 'function');
assert.equal(typeof node.Session.prototype.conversation, 'function');
assert.equal(new voice.ConversationConfig().historyCapacity, 32);
assert.deepEqual(
  Object.keys(voice).filter((name) => name === 'Session'),
  [],
);

const demo = await import('pocketstation/demo');
assert.equal(typeof demo.AudioWindowBuffer, 'function');
assert.equal(typeof demo.WhisperTranscriber, 'function');
assert.equal(typeof demo.WhisperTranscriberConfiguration, 'function');
assert.equal(typeof demo.WhisperCliModel, 'function');
assert.equal(typeof demo.OpenAIRealtime, 'function');
assert.equal(typeof demo.RealtimeVoiceConfig, 'function');
assert.equal(typeof demo.Transcript, 'function');
assert.equal(typeof demo.encodeRealtimeMicrophoneFrame, 'function');

const root = await import('pocketstation');
assert.deepEqual(Object.keys(root), [
  'PocketStationError',
  'RuntimeCompatibility',
  'runtimeCompatibility',
  'version',
]);
assert.equal(root.version, '0.1.4');
assert.equal(root.runtimeCompatibility.sdkVersion, root.version);
assert.equal(root.runtimeCompatibility.nativeAbi, 'napi8');

console.log('package exports: PASS');
