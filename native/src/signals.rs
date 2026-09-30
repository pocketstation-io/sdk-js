use std::collections::HashMap;
use std::sync::atomic::{fence, AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_timer::Delay;
use napi::bindgen_prelude::Buffer;
use napi::Result;
use napi_derive::napi;
use pocketstation::graph::NodeConfig;
use pocketstation::{
    ConfigError, EndpointCancellationOutcome, EndpointConfiguration, EndpointDriverFactory,
    EndpointDriverFinalization, EndpointDriverObservations, EndpointFailure, EndpointFailureStage,
    EndpointPortInput, EndpointReceiver, EndpointStartGate, ExecutionPartition, ExecutionSafety,
    Multiplicity, NodeDefinition, NodeDescriptor, NodeTypeId, OperatorId, PortDirection, PortSpec,
    PreparedEndpointDriver, RouteId, RunningEndpointDriver, Session, SignalEnvelope, SignalPayload,
};

use crate::application_audio::NativeSourceOutput;
use crate::errors::{error, state_unavailable};
use crate::graph::{NativeDerivedStream, NativeRouteSettings, NativeSignalSpec};

const SUBSCRIPTION_INPUT_PORT: &str = "signal";
const SUBSCRIPTION_CONFIG_KEY: &str = "subscription_id";
const MAXIMUM_WAIT_MS: u32 = 1_000;

enum ReceiptState {
    Declared,
    Active(pocketstation::EndpointSignalReceiver),
    Closed,
    Fault(String),
}

pub(crate) struct SignalReceipt {
    state: Mutex<ReceiptState>,
    received_total: AtomicU64,
    closed: AtomicBool,
}

impl SignalReceipt {
    fn new() -> Self {
        Self {
            state: Mutex::new(ReceiptState::Declared),
            received_total: AtomicU64::new(0),
            closed: AtomicBool::new(false),
        }
    }

    fn activate(
        &self,
        receiver: pocketstation::EndpointSignalReceiver,
    ) -> std::result::Result<(), EndpointFailure> {
        let mut state = self.state.lock().map_err(|_| {
            EndpointFailure::new(
                EndpointFailureStage::Start,
                "JavaScript signal subscription state is unavailable",
            )
        })?;
        if self.closed.load(Ordering::Acquire) {
            *state = ReceiptState::Closed;
            return Ok(());
        }
        if !matches!(*state, ReceiptState::Declared) {
            return Err(EndpointFailure::new(
                EndpointFailureStage::Start,
                "JavaScript signal subscription was activated more than once",
            ));
        }
        *state = ReceiptState::Active(receiver);
        Ok(())
    }

    fn poll(&self) -> SignalRead {
        let Ok(mut state) = self.state.lock() else {
            return SignalRead::Fault(
                "JavaScript signal subscription state is unavailable".to_owned(),
            );
        };
        match &mut *state {
            ReceiptState::Declared => SignalRead::Empty,
            ReceiptState::Active(receiver) => {
                let mut envelope = receiver.try_recv();
                let abandoned = envelope.is_none() && receiver.is_abandoned();
                if abandoned {
                    // Observe the producer's final publication before deciding EOF.
                    // Use this same abandonment observation for the Closed branch.
                    fence(Ordering::Acquire);
                    envelope = receiver.try_recv();
                }
                if let Some(envelope) = envelope {
                    if let Err(failure) = envelope.validate() {
                        let message = format!(
                            "JavaScript signal subscription received an invalid envelope: {failure}"
                        );
                        self.closed.store(true, Ordering::Release);
                        *state = ReceiptState::Fault(message.clone());
                        return SignalRead::Fault(message);
                    }
                    let envelope = match copy_envelope(&envelope) {
                        Ok(envelope) => envelope,
                        Err(message) => {
                            self.closed.store(true, Ordering::Release);
                            *state = ReceiptState::Fault(message.clone());
                            return SignalRead::Fault(message);
                        }
                    };
                    self.received_total.fetch_add(1, Ordering::Relaxed);
                    return SignalRead::Item(Box::new(envelope));
                }
                if abandoned {
                    self.closed.store(true, Ordering::Release);
                    *state = ReceiptState::Closed;
                    SignalRead::Closed
                } else {
                    SignalRead::Empty
                }
            }
            ReceiptState::Closed => SignalRead::Closed,
            ReceiptState::Fault(message) => SignalRead::Fault(message.clone()),
        }
    }

    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        if let Ok(mut state) = self.state.lock() {
            *state = ReceiptState::Closed;
        }
    }

    #[cfg(test)]
    fn fail(&self, message: impl Into<String>) {
        let message = message.into();
        self.closed.store(true, Ordering::Release);
        if let Ok(mut state) = self.state.lock() {
            *state = ReceiptState::Fault(message);
        }
    }

    fn observations(&self) -> EndpointDriverObservations {
        let received = self.received_total.load(Ordering::Relaxed);
        EndpointDriverObservations {
            frames_received_total: received,
            frames_delivered_total: received,
            ..EndpointDriverObservations::default()
        }
    }
}

pub(crate) type SignalReceipts = Arc<Mutex<HashMap<u64, Arc<SignalReceipt>>>>;

pub(crate) fn new_signal_receipts() -> SignalReceipts {
    Arc::new(Mutex::new(HashMap::new()))
}

struct SubscriptionDefinition {
    descriptor: NodeDescriptor,
    subscription_id: String,
}

impl NodeDefinition for SubscriptionDefinition {
    fn descriptor(&self) -> NodeDescriptor {
        self.descriptor.clone()
    }

    fn validate_config(&self, config: &NodeConfig) -> std::result::Result<(), ConfigError> {
        match config.get(SUBSCRIPTION_CONFIG_KEY) {
            Some(value) if value == self.subscription_id => Ok(()),
            Some(_) => Err(ConfigError::Invalid {
                key: SUBSCRIPTION_CONFIG_KEY.to_owned(),
                reason: "does not match the registered signal subscription".to_owned(),
            }),
            None => Err(ConfigError::Missing(SUBSCRIPTION_CONFIG_KEY.to_owned())),
        }
    }
}

struct SubscriptionFactory {
    subscription_id: String,
    receipt: Arc<SignalReceipt>,
}

impl EndpointDriverFactory for SubscriptionFactory {
    fn prepare(
        &self,
        mut inputs: Vec<EndpointPortInput>,
    ) -> std::result::Result<Box<dyn PreparedEndpointDriver>, EndpointFailure> {
        if inputs.len() != 1 {
            return Err(EndpointFailure::new(
                EndpointFailureStage::Prepare,
                "one JavaScript signal subscription requires exactly one input",
            ));
        }
        let Some(input) = inputs.pop() else {
            return Err(EndpointFailure::new(
                EndpointFailureStage::Prepare,
                "JavaScript signal subscription input is missing",
            ));
        };
        if input
            .context()
            .node_configuration()
            .get(SUBSCRIPTION_CONFIG_KEY)
            != Some(self.subscription_id.as_str())
        {
            return Err(EndpointFailure::new(
                EndpointFailureStage::Prepare,
                "JavaScript signal subscription configuration does not match its receipt",
            ));
        }
        if !matches!(input.receiver(), EndpointReceiver::Signal(_)) {
            return Err(EndpointFailure::new(
                EndpointFailureStage::Prepare,
                "JavaScript signal subscriptions accept typed signals only",
            ));
        }
        Ok(Box::new(PreparedSubscription {
            input,
            receipt: Arc::clone(&self.receipt),
        }))
    }
}

struct PreparedSubscription {
    input: EndpointPortInput,
    receipt: Arc<SignalReceipt>,
}

impl PreparedEndpointDriver for PreparedSubscription {
    fn start(
        self: Box<Self>,
        _start_gate: Arc<EndpointStartGate>,
    ) -> std::result::Result<Box<dyn RunningEndpointDriver>, EndpointFailure> {
        let (receiver, _) = self.input.into_parts();
        let EndpointReceiver::Signal(receiver) = receiver else {
            self.receipt.close();
            return Err(EndpointFailure::new(
                EndpointFailureStage::Start,
                "JavaScript signal subscription received realtime audio",
            ));
        };
        self.receipt.activate(receiver)?;
        Ok(Box::new(RunningSubscription {
            receipt: Arc::clone(&self.receipt),
        }))
    }

    fn cancel_preparation(self: Box<Self>) -> EndpointCancellationOutcome {
        self.receipt.close();
        EndpointCancellationOutcome {
            observations: self.receipt.observations(),
            result: Ok(()),
        }
    }
}

struct RunningSubscription {
    receipt: Arc<SignalReceipt>,
}

impl RunningEndpointDriver for RunningSubscription {
    fn observations(&self) -> EndpointDriverObservations {
        self.receipt.observations()
    }

    fn request_stop(&mut self) -> std::result::Result<(), EndpointFailure> {
        // Producers are joined before endpoint finalization. Preserve this bounded
        // receipt until the consumer drains the final flush and observes EOF.
        // Only explicit subscription close discards already accepted signals.
        Ok(())
    }

    fn join_and_finalize(self: Box<Self>) -> EndpointDriverFinalization {
        EndpointDriverFinalization {
            observations: self.receipt.observations(),
            result: Ok(()),
        }
    }
}

#[napi(js_name = "NativeBusSubscription")]
pub struct NativeBusSubscription {
    pub(crate) id: u64,
    pub(crate) session_id: u64,
    pub(crate) route_id: u64,
    signal: NativeSignalSpec,
    route_settings: NativeRouteSettings,
}

#[napi]
impl NativeBusSubscription {
    #[napi(getter)]
    pub fn id(&self) -> String {
        self.id.to_string()
    }

    #[napi(getter)]
    pub fn session_id(&self) -> String {
        self.session_id.to_string()
    }

    #[napi(getter)]
    pub fn route_id(&self) -> String {
        self.route_id.to_string()
    }

    #[napi(getter)]
    pub fn signal(&self) -> NativeSignalSpec {
        self.signal.clone()
    }

    #[napi(getter)]
    pub fn route_settings(&self) -> NativeRouteSettings {
        self.route_settings
    }
}

pub(crate) fn subscribe_derived(
    session: &Session,
    stream: &NativeDerivedStream,
    signal: &NativeSignalSpec,
    route_settings: &NativeRouteSettings,
    subscription_id: u64,
    receipts: &SignalReceipts,
) -> Result<NativeBusSubscription> {
    declare_subscription(
        session,
        stream.session_id,
        signal,
        route_settings,
        subscription_id,
        receipts,
        |endpoint| stream.handle.send_to(endpoint, None),
    )
}

pub(crate) fn subscribe_source_output(
    session: &Session,
    stream: &NativeSourceOutput,
    signal: &NativeSignalSpec,
    route_settings: &NativeRouteSettings,
    subscription_id: u64,
    receipts: &SignalReceipts,
) -> Result<NativeBusSubscription> {
    declare_subscription(
        session,
        stream.session_id,
        signal,
        route_settings,
        subscription_id,
        receipts,
        |endpoint| stream.handle.send_to(endpoint, None),
    )
}

fn declare_subscription(
    session: &Session,
    stream_session_id: u64,
    signal: &NativeSignalSpec,
    route_settings: &NativeRouteSettings,
    subscription_id: u64,
    receipts: &SignalReceipts,
    send: impl FnOnce(
        pocketstation::EndpointHandle,
    ) -> std::result::Result<RouteId, pocketstation::SessionError>,
) -> Result<NativeBusSubscription> {
    if stream_session_id != session.id().get() {
        return Err(error(
            "session.invalid_route",
            "signal stream belongs to a different Session",
        ));
    }
    signal
        .value
        .validate()
        .map_err(|failure| error("graph.invalid_signal", failure.to_string()))?;
    if !route_settings.value.media().supports_signal(&signal.value) {
        return Err(error(
            "graph.incompatible_route",
            "route media does not support the selected signal",
        ));
    }

    let subscription_key = subscription_id.to_string();
    let node_type_id =
        format!("io.pocketstation.javascript.signal-subscription.node.v1.{subscription_id}");
    let operator_id =
        format!("io.pocketstation.javascript.signal-subscription.v1.{subscription_id}");
    let input = PortSpec::new(
        SUBSCRIPTION_INPUT_PORT,
        PortDirection::Input,
        signal.value.clone(),
        route_settings.value.media(),
        Multiplicity::Many,
        true,
    )
    .map_err(|failure| error("graph.invalid_signal", failure.to_string()))?;
    let descriptor = NodeDescriptor::new(
        NodeTypeId::from(node_type_id.as_str()),
        "JavaScript signal subscription",
        vec![input],
        Vec::new(),
        ExecutionPartition::External,
        ExecutionSafety::ExternalService,
        true,
    )
    .map_err(|failure| error("graph.invalid_signal", failure.to_string()))?;
    let receipt = Arc::new(SignalReceipt::new());
    session
        .register_endpoint(
            OperatorId::new(operator_id.clone()),
            Arc::new(SubscriptionDefinition {
                descriptor,
                subscription_id: subscription_key.clone(),
            }),
            Arc::new(SubscriptionFactory {
                subscription_id: subscription_key.clone(),
                receipt: Arc::clone(&receipt),
            }),
        )
        .map_err(|failure| error("session.invalid_endpoint", failure.to_string()))?;
    let endpoint = session
        .endpoint(
            pocketstation::EndpointDescriptor::new(
                NodeTypeId::from(node_type_id.as_str()),
                OperatorId::new(operator_id),
            )
            .with_configuration(
                EndpointConfiguration::new().with(SUBSCRIPTION_CONFIG_KEY, subscription_key),
            )
            .with_route_settings(route_settings.value),
        )
        .map_err(|failure| error("session.invalid_endpoint", failure.to_string()))?;
    let route_id =
        send(endpoint).map_err(|failure| error("session.invalid_route", failure.to_string()))?;
    receipts
        .lock()
        .map_err(|_| state_unavailable("signal subscription registry"))?
        .insert(subscription_id, receipt);
    Ok(NativeBusSubscription {
        id: subscription_id,
        session_id: session.id().get(),
        route_id: route_id.get(),
        signal: signal.clone(),
        route_settings: *route_settings,
    })
}

enum SignalRead {
    Item(Box<NativeSignalEnvelope>),
    Empty,
    Closed,
    Fault(String),
}

#[napi(object)]
pub struct NativeSignalTiming {
    pub source_timestamp_ns: Option<String>,
    pub observed_timestamp_ns: String,
    pub session_timestamp_ns: Option<String>,
    pub duration_ns: Option<String>,
}

#[napi(object)]
pub struct NativeSignalLineage {
    pub session_id: String,
    pub stream_id: String,
    pub source_id: String,
    pub clock_id: u32,
    pub clock_kind: String,
    pub clock_origin: String,
    pub clock_tick_rate_hz: Option<String>,
    pub sequence_number: String,
    pub source_generation: u32,
    pub discontinuity_epoch: String,
    pub policy_epoch: String,
}

#[napi(object)]
pub struct NativeSignalDerivation {
    pub upstream_lineage: NativeSignalLineage,
    pub upstream_timing: NativeSignalTiming,
    pub operator_id: String,
    pub operator_revision: u32,
    pub operator_generation: u32,
    pub connector_id: Option<String>,
}

#[napi(object)]
pub struct NativeSignalAudio {
    pub samples_f32le: Buffer,
    pub sample_count: u32,
    pub sample_rate_hz: u32,
    pub channel_count: u8,
    pub stream_id: String,
    pub source_id: String,
    pub sequence_number: String,
    pub timestamp_ns: String,
}

#[napi(object)]
pub struct NativeSignalEnvelope {
    pub signal_kind: String,
    pub signal_format: Option<String>,
    pub signal_custom_id: Option<String>,
    pub signal_role: Option<String>,
    pub signal_schema: Option<String>,
    pub signal_wire_id: String,
    pub timing: NativeSignalTiming,
    pub lineage: Option<NativeSignalLineage>,
    pub derivation: Option<NativeSignalDerivation>,
    pub payload_kind: String,
    pub text: Option<String>,
    pub bytes: Option<Buffer>,
    pub audio: Option<NativeSignalAudio>,
}

#[napi(object)]
pub struct NativeSignalRead {
    pub status: String,
    pub envelope: Option<NativeSignalEnvelope>,
    pub error: Option<String>,
}

#[napi(object)]
pub struct NativeSignalMetrics {
    pub capacity_signals: String,
    pub max_payload_bytes: String,
    pub maximum_buffered_payload_bytes: String,
    pub depth_signals: String,
    pub peak_depth_signals: String,
    pub enqueued_total: String,
    pub received_total: String,
    pub dropped_total: String,
}

fn copy_timing(value: pocketstation::SignalTiming) -> NativeSignalTiming {
    NativeSignalTiming {
        source_timestamp_ns: value.source_timestamp_ns().map(|value| value.to_string()),
        observed_timestamp_ns: value.observed_timestamp_ns().to_string(),
        session_timestamp_ns: value.session_timestamp_ns().map(|value| value.to_string()),
        duration_ns: value.duration_ns().map(|value| value.to_string()),
    }
}

fn copy_lineage(value: pocketstation::SignalLineage) -> NativeSignalLineage {
    let clock = pocketstation::timing::describe_clock_domain(value.clock_id());
    let clock_kind = match clock.kind() {
        pocketstation::timing::ClockDomainKind::Unspecified => "unspecified",
        pocketstation::timing::ClockDomainKind::ProcessMonotonic => "process-monotonic",
        pocketstation::timing::ClockDomainKind::ProviderDefined => "provider-defined",
    };
    let clock_origin = match clock.origin() {
        pocketstation::timing::ClockDomainOrigin::Unspecified => "unspecified",
        pocketstation::timing::ClockDomainOrigin::ProcessStart => "process-start",
        pocketstation::timing::ClockDomainOrigin::ProviderDefined => "provider-defined",
    };
    NativeSignalLineage {
        session_id: value.session_id().get().to_string(),
        stream_id: value.stream_id().get().to_string(),
        source_id: value.source_id().get().to_string(),
        clock_id: value.clock_id().get(),
        clock_kind: clock_kind.to_owned(),
        clock_origin: clock_origin.to_owned(),
        clock_tick_rate_hz: clock.tick_rate_hz().map(|value| value.to_string()),
        sequence_number: value.sequence_number().to_string(),
        source_generation: value.source_generation(),
        discontinuity_epoch: value.discontinuity_epoch().to_string(),
        policy_epoch: value.policy_epoch().to_string(),
    }
}

pub(crate) fn copy_envelope(
    value: &SignalEnvelope,
) -> std::result::Result<NativeSignalEnvelope, String> {
    let (payload_kind, text, bytes, audio) = match value.payload() {
        SignalPayload::Audio(frame) => {
            let mut samples = Vec::with_capacity(std::mem::size_of_val(frame.samples()));
            for sample in frame.samples() {
                samples.extend_from_slice(&sample.to_le_bytes());
            }
            (
                "audio".to_owned(),
                None,
                None,
                Some(NativeSignalAudio {
                    samples_f32le: samples.into(),
                    sample_count: u32::try_from(frame.samples().len())
                        .map_err(|_| "signal audio sample count exceeds u32".to_owned())?,
                    sample_rate_hz: frame.sample_rate_hz(),
                    channel_count: frame.channels(),
                    stream_id: frame.stream_id().get().to_string(),
                    source_id: frame.source_id().get().to_string(),
                    sequence_number: frame.sequence_number().to_string(),
                    timestamp_ns: frame.timestamp_ns().to_string(),
                }),
            )
        }
        SignalPayload::Text(value) => ("text".to_owned(), Some(value.clone()), None, None),
        SignalPayload::Bytes(value) => ("bytes".to_owned(), None, Some(value.clone().into()), None),
    };
    let signal = NativeSignalSpec {
        value: value.signal_spec().clone(),
    };
    Ok(NativeSignalEnvelope {
        signal_kind: signal.kind().to_owned(),
        signal_format: signal.format().map(str::to_owned),
        signal_custom_id: signal.custom_id(),
        signal_role: signal.role(),
        signal_schema: signal.schema(),
        signal_wire_id: signal.wire_id(),
        timing: copy_timing(value.timing()),
        lineage: value.lineage().map(copy_lineage),
        derivation: value.derivation().map(|derivation| NativeSignalDerivation {
            upstream_lineage: copy_lineage(derivation.upstream_lineage()),
            upstream_timing: copy_timing(derivation.upstream_timing()),
            operator_id: derivation.operator_id().as_str().to_owned(),
            operator_revision: derivation.operator_revision(),
            operator_generation: derivation.operator_generation(),
            connector_id: derivation
                .connector_id()
                .map(|value| value.get().to_string()),
        }),
        payload_kind,
        text,
        bytes,
        audio,
    })
}

fn receipt(
    receipts: &SignalReceipts,
    session_id: u64,
    subscription: &NativeBusSubscription,
) -> Result<Arc<SignalReceipt>> {
    if subscription.session_id != session_id {
        return Err(error(
            "session.invalid_route",
            "signal subscription belongs to a different running Session",
        ));
    }
    receipts
        .lock()
        .map_err(|_| state_unavailable("signal subscription registry"))?
        .get(&subscription.id)
        .cloned()
        .ok_or_else(|| {
            error(
                "session.invalid_route",
                "signal subscription is not registered on this Session",
            )
        })
}

pub(crate) async fn read_signal(
    receipts: &SignalReceipts,
    session_id: u64,
    subscription: &NativeBusSubscription,
    timeout_ms: u32,
) -> Result<NativeSignalRead> {
    if timeout_ms > MAXIMUM_WAIT_MS {
        return Err(error(
            "stream.invalid_timeout",
            "timeoutMs must be between 0 and 1000",
        ));
    }
    let receipt = receipt(receipts, session_id, subscription)?;
    let deadline = Instant::now() + Duration::from_millis(u64::from(timeout_ms));
    loop {
        let read = receipt.poll();
        if !matches!(read, SignalRead::Empty) || Instant::now() >= deadline {
            return Ok(project_read(read));
        }
        Delay::new(Duration::from_millis(1)).await;
    }
}

pub(crate) fn close_signal(
    receipts: &SignalReceipts,
    session_id: u64,
    subscription: &NativeBusSubscription,
) -> Result<()> {
    receipt(receipts, session_id, subscription)?.close();
    Ok(())
}

pub(crate) fn close_signals(receipts: &SignalReceipts) -> Result<()> {
    for receipt in receipts
        .lock()
        .map_err(|_| state_unavailable("signal subscription registry"))?
        .values()
    {
        receipt.close();
    }
    Ok(())
}

pub(crate) fn validate_subscription(
    receipts: &SignalReceipts,
    session_id: u64,
    subscription: &NativeBusSubscription,
) -> Result<()> {
    receipt(receipts, session_id, subscription).map(|_| ())
}

fn project_read(read: SignalRead) -> NativeSignalRead {
    match read {
        SignalRead::Item(envelope) => NativeSignalRead {
            status: "item".to_owned(),
            envelope: Some(*envelope),
            error: None,
        },
        SignalRead::Empty => NativeSignalRead {
            status: "empty".to_owned(),
            envelope: None,
            error: None,
        },
        SignalRead::Closed => NativeSignalRead {
            status: "closed".to_owned(),
            envelope: None,
            error: None,
        },
        SignalRead::Fault(message) => NativeSignalRead {
            status: "fault".to_owned(),
            envelope: None,
            error: Some(message),
        },
    }
}

pub(crate) fn copy_signal_metrics(
    running: &pocketstation::RunningSession,
    route_id: u64,
) -> std::result::Result<NativeSignalMetrics, String> {
    let routes = running.derived_route_metrics();
    let metrics = routes
        .iter()
        .find(|metrics| metrics.route_id.get() == route_id)
        .ok_or_else(|| format!("signal metrics are unavailable for route {route_id}"))?;
    let value = metrics.output;
    Ok(NativeSignalMetrics {
        capacity_signals: value.capacity_signals.to_string(),
        max_payload_bytes: value.max_payload_bytes.to_string(),
        maximum_buffered_payload_bytes: value.maximum_buffered_payload_bytes.to_string(),
        depth_signals: value.depth_signals.to_string(),
        peak_depth_signals: value.peak_depth_signals.to_string(),
        enqueued_total: value.enqueued_total.to_string(),
        received_total: value.received_total.to_string(),
        dropped_total: value.dropped_total.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{ReceiptState, SignalRead, SignalReceipt};

    #[test]
    fn declared_receipt_is_empty_and_close_is_idempotent() {
        let receipt = SignalReceipt::new();
        assert!(matches!(receipt.poll(), SignalRead::Empty));
        receipt.close();
        receipt.close();
        assert!(matches!(receipt.poll(), SignalRead::Closed));
        let state = receipt.state.lock().expect("receipt state");
        assert!(matches!(&*state, ReceiptState::Closed));
    }

    #[test]
    fn receipt_fault_remains_visible() {
        let receipt = SignalReceipt::new();
        receipt.fail("fixture failure");
        assert!(
            matches!(receipt.poll(), SignalRead::Fault(message) if message == "fixture failure")
        );
        assert!(
            matches!(receipt.poll(), SignalRead::Fault(message) if message == "fixture failure")
        );
    }
}
