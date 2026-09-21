use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use futures::future::{select, Either};
use napi::bindgen_prelude::{Buffer, Function, Promise};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Result, Status};
use napi_derive::napi;
use pocketstation::connector::{
    AudioConnector, Connector, ConnectorCapability, ConnectorConfiguration,
    ConnectorConfigurationConstraint, ConnectorConfigurationField,
    ConnectorConfigurationRequirement, ConnectorConfigurationSchema, ConnectorConfigurationValue,
    ConnectorConfigurationValueKind, ConnectorContext, ConnectorDeliveryOutcome, ConnectorDriver,
    ConnectorDriverFactory, ConnectorError, ConnectorErrorCode, ConnectorErrorStage,
    ConnectorFactory, ConnectorInputDescriptor, ConnectorItem, ConnectorManifest,
    ConnectorReadinessPolicy, ConnectorRequirement, ConnectorRetryability, ConnectorRunOutcome,
    ConnectorSecret, ConnectorWorker, RegisteredConnector, ResolvedConnectorConfiguration,
};
use pocketstation::graph::NodeConfig;
use pocketstation::EndpointAudioFrame;
use pocketstation::{
    AsyncNode, AsyncNodeFuture, AsyncOperatorFactory, AsyncOperatorManifest,
    AsyncOperatorPrepareContext, AudioBufferPool, AudioFrame, BackpressurePolicy, ChannelLayout,
    ClockDomainId, ConfigError, CopyPolicy, EndpointCancellationOutcome, EndpointDriverFactory,
    EndpointDriverFinalization, EndpointDriverObservations, EndpointFailure,
    EndpointFailureRetryability, EndpointFailureStage, EndpointGroupId, EndpointPortInput,
    EndpointPreparationGroup, EndpointReceiver, EndpointShutdownMode, EndpointStartGate,
    ExecutionPartition, ExecutionSafety, MediaCaps, NodeDefinition, NodeDescriptor, NodeError,
    NodeTypeId, OperatorCancellationPolicy, OperatorDeadlinePolicy, OperatorFailurePolicy,
    OperatorId, OperatorOutputRolePolicy, OperatorPermissionPolicy, PortSpec,
    PreparedEndpointDriver, RouteId, RunningEndpointDriver, SampleFormat, SampleSpec,
    SignalDerivation, SignalEnvelope, SignalLineage, SignalPayload, SignalTiming,
    SourceCancellation, SourceConfiguration, SourceDriver, SourceDriverError, SourceEmission,
    SourceFactory, SourceManifest, SourcePrepareContext, SourceSessionContext,
};

const PROVIDER_QUEUE_CAPACITY: usize = 16;
const DEFAULT_PROVIDER_DEADLINE_MS: u32 = 5_000;
const MAXIMUM_PROVIDER_DEADLINE_MS: u32 = 300_000;
const MAXIMUM_PROVIDER_ERROR_BYTES: usize = 4_096;
static NEXT_PROVIDER_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);

#[napi(object)]
pub struct NativeProviderAudio {
    pub samples_f32_le: Buffer,
    pub sample_count: u32,
    pub sample_rate_hz: u32,
    pub channel_count: u8,
    pub source_id: String,
    pub stream_id: String,
    pub sequence_number: String,
    pub timestamp_ns: String,
    pub route_enqueued_at_ns: String,
    pub route_received_at_ns: String,
    pub output_generation_id: Option<String>,
    pub source_generation: u32,
    pub discontinuity_epoch: String,
    pub permission_epoch: String,
    pub clock_id: u32,
    pub duration_ns: String,
    pub connector_id: Option<String>,
}

#[napi(object)]
pub struct NativeProviderCall {
    pub operation: String,
    pub instance_id: Option<String>,
    pub shutdown_mode: Option<String>,
    pub audio: Option<NativeProviderAudio>,
    pub configuration: Option<Vec<crate::graph::NativeConfigurationEntry>>,
    pub source_context: Option<NativeSourceContext>,
    pub cancelled: Option<bool>,
    pub input_port: Option<String>,
    pub signal: Option<crate::signals::NativeSignalEnvelope>,
    pub route_id: Option<String>,
    pub endpoint_id: Option<String>,
    pub endpoint_inputs: Option<Vec<NativeEndpointInputDescriptor>>,
    pub endpoint_items: Option<Vec<NativeEndpointItem>>,
}

#[napi(object)]
pub struct NativeProviderResult {
    pub outcome: Option<String>,
    pub outcomes: Option<Vec<String>>,
    pub emission: Option<NativeProviderEmission>,
    pub emissions: Option<Vec<NativeProviderEmission>>,
    pub preparation_group: Option<String>,
    pub route_preparation: Option<bool>,
    pub idle_enabled: Option<bool>,
}

#[napi(object)]
pub struct NativeConnectorConstraint {
    pub kind: String,
    pub minimum: Option<String>,
    pub maximum: Option<String>,
    pub values: Option<Vec<String>>,
}

#[napi(object)]
pub struct NativeConnectorConfigurationField {
    pub name: String,
    pub kind: String,
    pub requirement: String,
    pub documentation: String,
    pub default_value: Option<String>,
    pub constraints: Option<Vec<NativeConnectorConstraint>>,
    pub deprecation: Option<String>,
}

#[napi(object)]
pub struct NativeConnectorManifest {
    pub operator_id: String,
    pub node_type_id: String,
    pub package_version: String,
    pub manifest_revision: u32,
    pub startup_timeout_ms: u32,
    pub probe_interval_ms: u32,
    pub success_threshold: u32,
    pub failure_threshold: u32,
    pub configuration_revision: u32,
    pub configuration_fields: Vec<NativeConnectorConfigurationField>,
    pub capabilities: Vec<NativeConnectorManifestEntry>,
    pub requirements: Vec<NativeConnectorRequirement>,
}

#[napi(object)]
pub struct NativeConnectorManifestEntry {
    pub id: String,
    pub documentation: String,
}

#[napi(object)]
pub struct NativeConnectorRequirement {
    pub id: String,
    pub required: Option<bool>,
    pub documentation: String,
}

#[napi(object)]
pub struct NativeEndpointInputDescriptor {
    pub endpoint_id: String,
    pub connector_id: Option<String>,
    pub route_id: String,
    pub port_name: String,
}

#[napi(object)]
pub struct NativeEndpointItem {
    pub input_port: String,
    pub endpoint_id: String,
    pub route_id: String,
    pub audio: Option<NativeProviderAudio>,
    pub signal: Option<crate::signals::NativeSignalEnvelope>,
}

#[napi(object)]
pub struct NativeSourceOutput {
    pub name: String,
    pub stream_id: String,
}

#[napi(object)]
pub struct NativeSourceContext {
    pub source_type_id: String,
    pub session_id: Option<String>,
    pub source_id: Option<String>,
    pub outputs: Vec<NativeSourceOutput>,
}

#[napi(object)]
pub struct NativeProviderEmission {
    pub output: String,
    pub payload_kind: String,
    pub text: Option<String>,
    pub bytes: Option<Buffer>,
    pub samples_f32_le: Option<Buffer>,
    pub source_timestamp_ns: Option<String>,
    pub observed_timestamp_ns: Option<String>,
    pub duration_ns: Option<String>,
    pub source_generation: Option<u32>,
    pub discontinuity_epoch: Option<String>,
    pub policy_epoch: Option<String>,
    pub clock_id: Option<u32>,
    pub terminal: Option<bool>,
}

type ProviderDispatch = ThreadsafeFunction<
    NativeProviderCall,
    Promise<NativeProviderResult>,
    NativeProviderCall,
    Status,
    false,
    false,
    PROVIDER_QUEUE_CAPACITY,
>;

#[derive(Clone)]
pub(crate) struct ProviderBridge {
    dispatch: Arc<ProviderDispatch>,
    deadline: Duration,
}

impl ProviderBridge {
    pub(crate) fn new(
        dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
        deadline_ms: Option<u32>,
    ) -> Result<Self> {
        let deadline_ms = deadline_ms.unwrap_or(DEFAULT_PROVIDER_DEADLINE_MS);
        if deadline_ms == 0 || deadline_ms > MAXIMUM_PROVIDER_DEADLINE_MS {
            return Err(crate::errors::error(
                "provider.invalid_deadline",
                format!(
                    "provider deadline must be between 1 and {MAXIMUM_PROVIDER_DEADLINE_MS} milliseconds"
                ),
            ));
        }
        let dispatch = dispatch
            .build_threadsafe_function::<NativeProviderCall>()
            .max_queue_size::<PROVIDER_QUEUE_CAPACITY>()
            .build()?;
        Ok(Self {
            dispatch: Arc::new(dispatch),
            deadline: Duration::from_millis(u64::from(deadline_ms)),
        })
    }

    fn call(
        &self,
        request: NativeProviderCall,
    ) -> std::result::Result<NativeProviderResult, String> {
        let (sender, receiver) = sync_channel(1);
        let status = self.dispatch.call_with_return_value(
            request,
            ThreadsafeFunctionCallMode::NonBlocking,
            move |promise, _env| {
                let _ = sender.send(promise);
                Ok(())
            },
        );
        if status != Status::Ok {
            return Err(match status {
                Status::QueueFull => "JavaScript provider queue is full".to_owned(),
                Status::Closing => "JavaScript provider is closing".to_owned(),
                other => format!("JavaScript provider dispatch failed: {other}"),
            });
        }
        let promise = receiver
            .recv_timeout(self.deadline)
            .map_err(|_| {
                "JavaScript provider did not accept the call before its deadline".to_owned()
            })?
            .map_err(|failure| bounded_message(failure.to_string()))?;
        futures::executor::block_on(async {
            let promise = Box::pin(promise);
            let deadline = Box::pin(futures_timer::Delay::new(self.deadline));
            match select(promise, deadline).await {
                Either::Left((result, _)) => {
                    result.map_err(|failure| bounded_message(failure.to_string()))
                }
                Either::Right(((), _)) => {
                    Err("JavaScript provider promise exceeded its deadline".to_owned())
                }
            }
        })
    }

    async fn call_async(
        &self,
        request: NativeProviderCall,
    ) -> std::result::Result<NativeProviderResult, String> {
        let started = std::time::Instant::now();
        let callback = Box::pin(self.dispatch.call_async_catch(request));
        let deadline = Box::pin(futures_timer::Delay::new(self.deadline));
        let promise = match select(callback, deadline).await {
            Either::Left((result, _)) => {
                result.map_err(|failure| bounded_message(failure.to_string()))?
            }
            Either::Right(((), _)) => {
                return Err(
                    "JavaScript provider did not accept the call before its deadline".to_owned(),
                )
            }
        };
        let remaining = self.deadline.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return Err("JavaScript provider promise exceeded its deadline".to_owned());
        }
        let promise = Box::pin(promise);
        let deadline = Box::pin(futures_timer::Delay::new(remaining));
        match select(promise, deadline).await {
            Either::Left((result, _)) => {
                result.map_err(|failure| bounded_message(failure.to_string()))
            }
            Either::Right(((), _)) => {
                Err("JavaScript provider promise exceeded its deadline".to_owned())
            }
        }
    }
}

pub(crate) fn audio_connector(
    dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
    deadline_ms: Option<u32>,
) -> Result<Connector> {
    let bridge = ProviderBridge::new(dispatch, deadline_ms)?;
    Connector::from_audio(JavaScriptAudioConnector { bridge }).map_err(|failure| {
        crate::errors::error("connector.invalid_configuration", failure.to_string())
    })
}

pub(crate) fn register_source(
    session: &pocketstation::Session,
    source_type_id: String,
    revision: u32,
    generation: u32,
    outputs: Vec<pocketstation::PortSpec>,
    dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
    deadline_ms: Option<u32>,
) -> Result<()> {
    if outputs.iter().any(|output| {
        output.direction() != pocketstation::PortDirection::Output
            || output.signal().class().is_audio()
    }) {
        return Err(crate::errors::error(
            "source.invalid_declaration",
            "JavaScript Sources emit typed non-PCM signals; use Session.audioInput() for application-owned PCM",
        ));
    }
    let manifest = SourceManifest::new(
        pocketstation::SourceTypeId::new(source_type_id).map_err(|failure| {
            crate::errors::error("source.invalid_declaration", failure.to_string())
        })?,
        revision,
        generation,
        outputs,
        ExecutionPartition::BlockingWorker,
        ExecutionSafety::AllocationAllowed,
    )
    .map_err(|failure| crate::errors::error("source.invalid_declaration", failure.to_string()))?;
    let bridge = ProviderBridge::new(dispatch, deadline_ms)?;
    session
        .register_source(Arc::new(JavaScriptSourceFactory { manifest, bridge }))
        .map_err(|failure| crate::errors::error("source.registration_failed", failure.to_string()))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn register_operator(
    session: &pocketstation::Session,
    operator_id: String,
    revision: u32,
    generation: u32,
    inputs: Vec<PortSpec>,
    outputs: Vec<PortSpec>,
    queue_capacity: u32,
    dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
    deadline_ms: Option<u32>,
) -> Result<()> {
    let deadline_ms = deadline_ms.unwrap_or(DEFAULT_PROVIDER_DEADLINE_MS);
    let node_type_id = format!("{operator_id}.node");
    let node = NodeDescriptor::new(
        NodeTypeId::from(node_type_id.as_str()),
        "JavaScript Operator",
        inputs,
        outputs,
        ExecutionPartition::AsyncWorker,
        ExecutionSafety::NetworkAllowed,
        true,
    )
    .map_err(|failure| crate::errors::error("operator.invalid_declaration", failure.to_string()))?;
    let roles = node
        .outputs()
        .iter()
        .filter_map(|port| port.signal().role().cloned())
        .collect();
    let manifest = AsyncOperatorManifest::new(
        OperatorId::new(operator_id),
        revision,
        generation,
        node,
        pocketstation::RouteSettings::bounded_async()
            .with_backpressure(BackpressurePolicy::DropNewest)
            .with_copy_policy(CopyPolicy::CopyToBranchPool),
        pocketstation::RouteSettings::bounded_async(),
        usize::try_from(queue_capacity).unwrap_or(usize::MAX),
        OperatorPermissionPolicy {
            network_allowed: true,
            filesystem_allowed: true,
        },
        OperatorDeadlinePolicy {
            process_timeout_ms: deadline_ms,
        },
        OperatorCancellationPolicy::DiscardQueued,
        OperatorFailurePolicy::StopWorker,
        OperatorOutputRolePolicy {
            allowed: roles,
            terminal: Vec::new(),
        },
    )
    .map_err(|failure| crate::errors::error("operator.invalid_declaration", failure.to_string()))?;
    let audio_output = operator_audio_output(&manifest)?;
    let output_ports = manifest.output_ports().cloned().collect();
    let bridge = ProviderBridge::new(dispatch, Some(deadline_ms))?;
    session
        .register_operator(Arc::new(JavaScriptOperatorFactory {
            manifest,
            bridge,
            audio_output,
            output_ports,
        }))
        .map_err(|failure| {
            crate::errors::error("operator.registration_failed", failure.to_string())
        })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn register_endpoint(
    session: &pocketstation::Session,
    operator_id: String,
    node_type_id: String,
    inputs: Vec<PortSpec>,
    dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
    deadline_ms: Option<u32>,
    maximum_batch_items: Option<u32>,
) -> Result<()> {
    if inputs.is_empty()
        || inputs
            .iter()
            .any(|input| input.direction() != pocketstation::PortDirection::Input)
    {
        return Err(crate::errors::error(
            "endpoint.invalid_declaration",
            "JavaScript Endpoint inputs must contain at least one input PortSpec",
        ));
    }
    let descriptor = NodeDescriptor::new(
        NodeTypeId::from(node_type_id.as_str()),
        "JavaScript Endpoint",
        inputs,
        Vec::new(),
        ExecutionPartition::External,
        ExecutionSafety::ExternalService,
        true,
    )
    .map_err(|failure| crate::errors::error("endpoint.invalid_declaration", failure.to_string()))?;
    let bridge = ProviderBridge::new(dispatch, deadline_ms)?;
    let maximum_batch_items = maximum_batch_items.unwrap_or(1);
    if maximum_batch_items == 0 || maximum_batch_items > 1_024 {
        return Err(crate::errors::error(
            "endpoint.invalid_batch_size",
            "JavaScript Endpoint maximumBatchItems must be between 1 and 1024",
        ));
    }
    let group = EndpointGroupId::new(format!(
        "javascript-endpoint:{}",
        next_provider_instance()
            .map_err(|message| crate::errors::error("endpoint.identity_exhausted", message))?
    ));
    session
        .register_endpoint(
            OperatorId::new(operator_id),
            Arc::new(JavaScriptEndpointDefinition {
                descriptor,
                bridge: bridge.clone(),
            }),
            Arc::new(JavaScriptEndpointFactory {
                bridge,
                group,
                maximum_batch_items: maximum_batch_items as usize,
            }),
        )
        .map_err(|failure| {
            crate::errors::error("endpoint.registration_failed", failure.to_string())
        })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn register_connector(
    session: &pocketstation::Session,
    manifest: NativeConnectorManifest,
    inputs: Vec<PortSpec>,
    dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
    deadline_ms: Option<u32>,
    maximum_batch_items: u32,
    worker: bool,
) -> Result<RegisteredConnector> {
    if maximum_batch_items == 0 || maximum_batch_items > 1_024 {
        return Err(crate::errors::error(
            "connector.invalid_contract",
            "maximumBatchItems must be between 1 and 1024",
        ));
    }
    let manifest = connector_manifest(manifest, inputs)?;
    let bridge = ProviderBridge::new(dispatch, deadline_ms)?;
    let connector = if worker {
        Connector::new(
            manifest,
            Arc::new(JavaScriptConnectorFactory {
                bridge,
                maximum_batch_items: maximum_batch_items as usize,
            }),
        )
    } else {
        Connector::with_driver(
            manifest,
            Arc::new(JavaScriptConnectorDriverFactory { bridge }),
        )
    }
    .map_err(|failure| crate::errors::error("connector.invalid_contract", failure.to_string()))?;
    session.register_connector(connector).map_err(|failure| {
        crate::errors::error("connector.registration_failed", failure.to_string())
    })
}

pub(crate) fn connector_configuration(
    entries: Vec<crate::graph::NativeConfigurationEntry>,
    manifest: &ConnectorManifest,
) -> Result<ConnectorConfiguration> {
    let mut configuration = ConnectorConfiguration::new();
    for entry in entries {
        let field = manifest.configuration().field(&entry.key).ok_or_else(|| {
            crate::errors::error(
                "connector.configuration.unknown_field",
                format!("unknown Connector configuration field {}", entry.key),
            )
        })?;
        let sensitive = entry.sensitive.unwrap_or(false);
        let value = parse_connector_value(field.value_kind(), entry.value, sensitive)?;
        configuration.insert(entry.key, value);
    }
    Ok(configuration)
}

fn connector_manifest(
    value: NativeConnectorManifest,
    inputs: Vec<PortSpec>,
) -> Result<ConnectorManifest> {
    if inputs.is_empty()
        || inputs
            .iter()
            .any(|input| input.direction() != pocketstation::PortDirection::Input)
    {
        return Err(crate::errors::error(
            "connector.invalid_contract",
            "Connector manifest requires at least one input and cannot declare outputs",
        ));
    }
    let fields = value
        .configuration_fields
        .into_iter()
        .map(connector_configuration_field)
        .collect::<Result<Vec<_>>>()?;
    let schema = ConnectorConfigurationSchema::new(value.configuration_revision, fields).map_err(
        |failure| crate::errors::error("connector.invalid_contract", failure.to_string()),
    )?;
    let node = NodeDescriptor::new(
        NodeTypeId::from(value.node_type_id.as_str()),
        "JavaScript Connector",
        inputs,
        Vec::new(),
        ExecutionPartition::AsyncWorker,
        ExecutionSafety::NetworkAllowed,
        true,
    )
    .map_err(|failure| crate::errors::error("connector.invalid_contract", failure.to_string()))?;
    let readiness = ConnectorReadinessPolicy::new(
        Duration::from_millis(u64::from(value.startup_timeout_ms)),
        Duration::from_millis(u64::from(value.probe_interval_ms)),
        value.success_threshold,
        value.failure_threshold,
    )
    .map_err(|failure| crate::errors::error("connector.invalid_contract", failure.to_string()))?;
    let mut manifest = ConnectorManifest::new(
        value.manifest_revision,
        OperatorId::new(value.operator_id),
        value.package_version,
        node,
        schema,
        readiness,
    )
    .map_err(|failure| crate::errors::error("connector.invalid_contract", failure.to_string()))?;
    for entry in value.capabilities {
        let capability =
            ConnectorCapability::new(entry.id, entry.documentation).map_err(|failure| {
                crate::errors::error("connector.invalid_contract", failure.to_string())
            })?;
        manifest = manifest.with_capability(capability);
    }
    for entry in value.requirements {
        let requirement = ConnectorRequirement::new(
            entry.id,
            entry.required.unwrap_or(true),
            entry.documentation,
        )
        .map_err(|failure| {
            crate::errors::error("connector.invalid_contract", failure.to_string())
        })?;
        manifest = manifest.with_requirement(requirement);
    }
    manifest.validate().map_err(|failure| {
        crate::errors::error("connector.invalid_contract", failure.to_string())
    })?;
    Ok(manifest)
}

fn connector_configuration_field(
    value: NativeConnectorConfigurationField,
) -> Result<ConnectorConfigurationField> {
    let kind = connector_value_kind(&value.kind)?;
    let requirement = match value.requirement.as_str() {
        "required" => ConnectorConfigurationRequirement::Required,
        "optional" => ConnectorConfigurationRequirement::Optional,
        "default" => ConnectorConfigurationRequirement::Default(parse_connector_value(
            kind,
            value.default_value.ok_or_else(|| {
                crate::errors::error(
                    "connector.invalid_contract",
                    "default Connector field requires a value",
                )
            })?,
            false,
        )?),
        _ => {
            return Err(crate::errors::error(
                "connector.invalid_contract",
                "Connector configuration requirement is invalid",
            ))
        }
    };
    let mut field =
        ConnectorConfigurationField::new(value.name, kind, requirement, value.documentation);
    for constraint in value.constraints.unwrap_or_default() {
        field = field.with_constraint(connector_constraint(constraint)?);
    }
    if let Some(deprecation) = value.deprecation {
        field = field.deprecated(deprecation);
    }
    Ok(field)
}

fn connector_constraint(
    value: NativeConnectorConstraint,
) -> Result<ConnectorConfigurationConstraint> {
    let invalid = || {
        crate::errors::error(
            "connector.invalid_contract",
            "Connector configuration constraint is invalid",
        )
    };
    match value.kind.as_str() {
        "non-empty" => Ok(ConnectorConfigurationConstraint::NonEmpty),
        "text-length-bytes" => Ok(ConnectorConfigurationConstraint::TextLengthBytes {
            minimum: value
                .minimum
                .ok_or_else(invalid)?
                .parse()
                .map_err(|_| invalid())?,
            maximum: value
                .maximum
                .ok_or_else(invalid)?
                .parse()
                .map_err(|_| invalid())?,
        }),
        "signed-range" => Ok(ConnectorConfigurationConstraint::SignedRange {
            minimum: value
                .minimum
                .ok_or_else(invalid)?
                .parse()
                .map_err(|_| invalid())?,
            maximum: value
                .maximum
                .ok_or_else(invalid)?
                .parse()
                .map_err(|_| invalid())?,
        }),
        "unsigned-range" => Ok(ConnectorConfigurationConstraint::UnsignedRange {
            minimum: value
                .minimum
                .ok_or_else(invalid)?
                .parse()
                .map_err(|_| invalid())?,
            maximum: value
                .maximum
                .ok_or_else(invalid)?
                .parse()
                .map_err(|_| invalid())?,
        }),
        "one-of" => Ok(ConnectorConfigurationConstraint::OneOf(
            value.values.ok_or_else(invalid)?,
        )),
        _ => Err(invalid()),
    }
}

fn connector_value_kind(value: &str) -> Result<ConnectorConfigurationValueKind> {
    match value {
        "text" => Ok(ConnectorConfigurationValueKind::Text),
        "boolean" => Ok(ConnectorConfigurationValueKind::Boolean),
        "signed-integer" => Ok(ConnectorConfigurationValueKind::SignedInteger),
        "unsigned-integer" => Ok(ConnectorConfigurationValueKind::UnsignedInteger),
        "duration-milliseconds" => Ok(ConnectorConfigurationValueKind::DurationMilliseconds),
        "byte-count" => Ok(ConnectorConfigurationValueKind::ByteCount),
        "secret" => Ok(ConnectorConfigurationValueKind::Secret),
        _ => Err(crate::errors::error(
            "connector.invalid_contract",
            "Connector configuration value kind is invalid",
        )),
    }
}

fn parse_connector_value(
    kind: ConnectorConfigurationValueKind,
    value: String,
    sensitive: bool,
) -> Result<ConnectorConfigurationValue> {
    let invalid = || {
        crate::errors::error(
            "connector.configuration.invalid_representation",
            "Connector configuration value has an invalid representation",
        )
    };
    match (kind, sensitive) {
        (ConnectorConfigurationValueKind::Text, false) => {
            Ok(ConnectorConfigurationValue::Text(value))
        }
        (ConnectorConfigurationValueKind::Boolean, false) => value
            .parse()
            .map(ConnectorConfigurationValue::Boolean)
            .map_err(|_| invalid()),
        (ConnectorConfigurationValueKind::SignedInteger, false) => value
            .parse()
            .map(ConnectorConfigurationValue::SignedInteger)
            .map_err(|_| invalid()),
        (ConnectorConfigurationValueKind::UnsignedInteger, false) => value
            .parse()
            .map(ConnectorConfigurationValue::UnsignedInteger)
            .map_err(|_| invalid()),
        (ConnectorConfigurationValueKind::DurationMilliseconds, false) => value
            .parse()
            .map(ConnectorConfigurationValue::DurationMilliseconds)
            .map_err(|_| invalid()),
        (ConnectorConfigurationValueKind::ByteCount, false) => value
            .parse()
            .map(ConnectorConfigurationValue::ByteCount)
            .map_err(|_| invalid()),
        (ConnectorConfigurationValueKind::Secret, true) => ConnectorSecret::new(value)
            .map(ConnectorConfigurationValue::Secret)
            .map_err(|_| invalid()),
        _ => Err(invalid()),
    }
}

fn resolved_connector_configuration(
    configuration: &ResolvedConnectorConfiguration,
) -> Vec<crate::graph::NativeConfigurationEntry> {
    configuration
        .iter()
        .map(|(key, value)| {
            let (encoded, sensitive) = match value {
                ConnectorConfigurationValue::Text(value) => (value.clone(), false),
                ConnectorConfigurationValue::Boolean(value) => (value.to_string(), false),
                ConnectorConfigurationValue::SignedInteger(value) => (value.to_string(), false),
                ConnectorConfigurationValue::UnsignedInteger(value)
                | ConnectorConfigurationValue::DurationMilliseconds(value)
                | ConnectorConfigurationValue::ByteCount(value) => (value.to_string(), false),
                ConnectorConfigurationValue::Secret(value) => {
                    (value.expose_secret().to_owned(), true)
                }
            };
            crate::graph::NativeConfigurationEntry {
                key: key.to_owned(),
                value: encoded,
                sensitive: Some(sensitive),
            }
        })
        .collect()
}

struct JavaScriptConnectorDriverFactory {
    bridge: ProviderBridge,
}

impl ConnectorDriverFactory for JavaScriptConnectorDriverFactory {
    fn preparation_group(
        &self,
        route_id: RouteId,
        configuration: &ResolvedConnectorConfiguration,
    ) -> std::result::Result<EndpointPreparationGroup, ConnectorError> {
        connector_preparation_group(
            &self.bridge,
            route_id,
            resolved_connector_configuration(configuration),
        )
    }

    fn prepare(
        &self,
        inputs: &[ConnectorInputDescriptor],
    ) -> std::result::Result<Box<dyn ConnectorDriver>, ConnectorError> {
        let instance_id = next_provider_instance()
            .map_err(|message| connector_error(ConnectorErrorStage::Prepare, message))?;
        let descriptors = inputs
            .iter()
            .map(native_connector_descriptor)
            .collect::<Vec<_>>();
        let configuration = inputs
            .first()
            .map(|input| resolved_connector_configuration(input.configuration()))
            .unwrap_or_default();
        create_connector_instance(&self.bridge, instance_id, configuration, descriptors)?;
        let preparation = self
            .bridge
            .call(provider_call("endpoint.prepare", Some(instance_id), None))
            .map_err(|message| connector_error(ConnectorErrorStage::Prepare, message))?;
        Ok(Box::new(JavaScriptConnectorDriver {
            bridge: self.bridge.clone(),
            instance_id,
            idle_enabled: preparation.idle_enabled.unwrap_or(false),
            closed: false,
        }))
    }
}

struct JavaScriptConnectorDriver {
    bridge: ProviderBridge,
    instance_id: u64,
    idle_enabled: bool,
    closed: bool,
}

impl Drop for JavaScriptConnectorDriver {
    fn drop(&mut self) {
        if !self.closed {
            let _ = cancel_connector_instance(&self.bridge, self.instance_id);
            self.closed = true;
        }
    }
}

impl ConnectorDriver for JavaScriptConnectorDriver {
    fn start(&mut self, context: &ConnectorContext) -> std::result::Result<(), ConnectorError> {
        self.bridge
            .call(provider_call(
                "endpoint.start",
                Some(self.instance_id),
                None,
            ))
            .map_err(|message| connector_error(ConnectorErrorStage::Startup, message))?;
        let _ = context.set_ready();
        Ok(())
    }

    fn deliver(
        &mut self,
        item: ConnectorItem<'_>,
        _context: &ConnectorContext,
    ) -> std::result::Result<ConnectorDeliveryOutcome, ConnectorError> {
        let mut request = provider_call("endpoint.receive", Some(self.instance_id), None);
        let item = native_connector_item(item)?;
        request.input_port = Some(item.input_port);
        request.endpoint_id = Some(item.endpoint_id);
        request.route_id = Some(item.route_id);
        request.audio = item.audio;
        request.signal = item.signal;
        let result = self
            .bridge
            .call(request)
            .map_err(|message| connector_error(ConnectorErrorStage::Delivery, message))?;
        match result.outcome.as_deref().unwrap_or("delivered") {
            "delivered" => Ok(ConnectorDeliveryOutcome::Delivered),
            "dropped" => Ok(ConnectorDeliveryOutcome::Dropped),
            _ => Err(connector_error(
                ConnectorErrorStage::Delivery,
                "JavaScript Connector returned an invalid outcome".to_owned(),
            )),
        }
    }

    fn idle(&mut self, _context: &ConnectorContext) -> std::result::Result<(), ConnectorError> {
        if !self.idle_enabled {
            return Ok(());
        }
        self.bridge
            .call(provider_call("endpoint.idle", Some(self.instance_id), None))
            .map(|_| ())
            .map_err(|message| connector_error(ConnectorErrorStage::Delivery, message))
    }

    fn shutdown(
        &mut self,
        mode: EndpointShutdownMode,
        _context: &ConnectorContext,
    ) -> std::result::Result<(), ConnectorError> {
        let result = stop_connector_instance(&self.bridge, self.instance_id, mode);
        self.closed = true;
        result
    }

    fn cancel_preparation(mut self: Box<Self>) -> std::result::Result<(), ConnectorError> {
        let result = cancel_connector_instance(&self.bridge, self.instance_id);
        self.closed = true;
        result
    }
}

struct JavaScriptConnectorFactory {
    bridge: ProviderBridge,
    maximum_batch_items: usize,
}

impl ConnectorFactory for JavaScriptConnectorFactory {
    fn preparation_group(
        &self,
        route_id: RouteId,
        configuration: &NodeConfig,
    ) -> std::result::Result<EndpointPreparationGroup, ConnectorError> {
        connector_preparation_group(&self.bridge, route_id, node_configuration(configuration))
    }

    fn prepare(
        &self,
        inputs: Vec<EndpointPortInput>,
    ) -> std::result::Result<Box<dyn ConnectorWorker>, ConnectorError> {
        let instance_id = next_provider_instance()
            .map_err(|message| connector_error(ConnectorErrorStage::Prepare, message))?;
        let descriptors = inputs
            .iter()
            .map(|input| NativeEndpointInputDescriptor {
                endpoint_id: input.context().endpoint_id().get().to_string(),
                connector_id: input
                    .context()
                    .connector_id()
                    .map(|value| value.get().to_string()),
                route_id: input.context().route_context().route_id().get().to_string(),
                port_name: input.port_name().to_owned(),
            })
            .collect::<Vec<_>>();
        let configuration = inputs
            .first()
            .map(|input| node_configuration(input.context().node_configuration()))
            .unwrap_or_default();
        create_connector_instance(&self.bridge, instance_id, configuration, descriptors)?;
        let preparation = self
            .bridge
            .call(provider_call("endpoint.prepare", Some(instance_id), None))
            .map_err(|message| connector_error(ConnectorErrorStage::Prepare, message))?;
        let inputs = inputs
            .into_iter()
            .map(|input| {
                let input_port = input.port_name().to_owned();
                let endpoint_id = input.context().endpoint_id().get();
                let connector_id = input.context().connector_id().map(|value| value.get());
                let route_id = input.context().route_context().route_id().get();
                let (receiver, _) = input.into_parts();
                JavaScriptConnectorWorkerInput {
                    input_port,
                    endpoint_id,
                    connector_id,
                    route_id,
                    receiver,
                }
            })
            .collect();
        Ok(Box::new(JavaScriptConnectorWorker {
            bridge: self.bridge.clone(),
            instance_id,
            inputs,
            maximum_batch_items: self.maximum_batch_items,
            idle_enabled: preparation.idle_enabled.unwrap_or(false),
            closed: false,
        }))
    }
}

struct JavaScriptConnectorWorkerInput {
    input_port: String,
    endpoint_id: u64,
    connector_id: Option<u64>,
    route_id: u64,
    receiver: EndpointReceiver,
}

struct JavaScriptConnectorWorker {
    bridge: ProviderBridge,
    instance_id: u64,
    inputs: Vec<JavaScriptConnectorWorkerInput>,
    maximum_batch_items: usize,
    idle_enabled: bool,
    closed: bool,
}

impl ConnectorWorker for JavaScriptConnectorWorker {
    fn run(mut self: Box<Self>, context: ConnectorContext) -> ConnectorRunOutcome {
        let result = self.run_inner(&context);
        if result.is_err() {
            let _ = cancel_connector_instance(&self.bridge, self.instance_id);
        }
        self.closed = true;
        ConnectorRunOutcome::new(result)
    }

    fn cancel_preparation(mut self: Box<Self>) -> std::result::Result<(), ConnectorError> {
        let result = cancel_connector_instance(&self.bridge, self.instance_id);
        self.closed = true;
        result
    }
}

impl Drop for JavaScriptConnectorWorker {
    fn drop(&mut self) {
        if !self.closed {
            let _ = cancel_connector_instance(&self.bridge, self.instance_id);
            self.closed = true;
        }
    }
}

impl JavaScriptConnectorWorker {
    fn run_inner(&mut self, context: &ConnectorContext) -> std::result::Result<(), ConnectorError> {
        self.bridge
            .call(provider_call(
                "endpoint.start",
                Some(self.instance_id),
                None,
            ))
            .map_err(|message| connector_error(ConnectorErrorStage::Startup, message))?;
        let _ = context.set_ready();
        loop {
            if context.is_abort_requested() {
                break;
            }
            let mut batch = Vec::with_capacity(self.maximum_batch_items);
            while batch.len() < self.maximum_batch_items {
                let mut progressed = false;
                for input in &mut self.inputs {
                    if batch.len() >= self.maximum_batch_items {
                        break;
                    }
                    let mut item = NativeEndpointItem {
                        input_port: input.input_port.clone(),
                        endpoint_id: input.endpoint_id.to_string(),
                        route_id: input.route_id.to_string(),
                        audio: None,
                        signal: None,
                    };
                    let received = match &mut input.receiver {
                        EndpointReceiver::Audio { receiver, .. } => {
                            receiver.try_recv().map(|frame| {
                                item.audio =
                                    Some(native_audio_with_connector(&frame, input.connector_id));
                            })
                        }
                        EndpointReceiver::Signal(receiver) => {
                            if let Some(signal) = receiver.try_recv() {
                                item.signal = Some(
                                    crate::signals::copy_envelope(&signal).map_err(|message| {
                                        connector_error(ConnectorErrorStage::Delivery, message)
                                    })?,
                                );
                                Some(())
                            } else {
                                None
                            }
                        }
                    };
                    if received.is_some() {
                        batch.push(item);
                        progressed = true;
                    }
                }
                if !progressed {
                    break;
                }
            }
            let abandoned = self.inputs.iter().all(|input| match &input.receiver {
                EndpointReceiver::Audio { receiver, .. } => receiver.is_abandoned(),
                EndpointReceiver::Signal(receiver) => receiver.is_abandoned(),
            });
            if batch.is_empty() {
                if context.shutdown_mode() == Some(EndpointShutdownMode::Drain) && abandoned {
                    break;
                }
                if self.idle_enabled {
                    self.bridge
                        .call(provider_call("endpoint.idle", Some(self.instance_id), None))
                        .map_err(|message| {
                            connector_error(ConnectorErrorStage::Delivery, message)
                        })?;
                }
                let _ = context.wait_for_stop(Duration::from_millis(1));
                continue;
            }
            let amount = u64::try_from(batch.len()).unwrap_or(u64::MAX);
            context.record_frame_received(amount);
            let mut request = provider_call("endpoint.receive_batch", Some(self.instance_id), None);
            request.endpoint_items = Some(batch);
            let result = self
                .bridge
                .call(request)
                .map_err(|message| connector_error(ConnectorErrorStage::Delivery, message))?;
            let (delivered, dropped) = delivery_counts(&result, amount)
                .map_err(|message| connector_error(ConnectorErrorStage::Delivery, message))?;
            context.record_frame_delivered(delivered);
            context.record_frame_dropped(dropped);
        }
        let mode = context
            .shutdown_mode()
            .unwrap_or(EndpointShutdownMode::Abort);
        stop_connector_instance(&self.bridge, self.instance_id, mode)
    }
}

fn connector_preparation_group(
    bridge: &ProviderBridge,
    route_id: RouteId,
    configuration: Vec<crate::graph::NativeConfigurationEntry>,
) -> std::result::Result<EndpointPreparationGroup, ConnectorError> {
    let mut request = provider_call("endpoint.preparation_group", None, Some(configuration));
    request.route_id = Some(route_id.get().to_string());
    let result = bridge
        .call(request)
        .map_err(|message| connector_error(ConnectorErrorStage::Prepare, message))?;
    if result.route_preparation.unwrap_or(false) {
        return Ok(EndpointPreparationGroup::Route(route_id));
    }
    match result.preparation_group {
        Some(group) if !group.trim().is_empty() => Ok(EndpointPreparationGroup::Shared(
            EndpointGroupId::new(group),
        )),
        Some(_) => Err(connector_error(
            ConnectorErrorStage::Prepare,
            "JavaScript Connector preparation group cannot be empty".to_owned(),
        )),
        None => Ok(EndpointPreparationGroup::Route(route_id)),
    }
}

fn native_connector_descriptor(input: &ConnectorInputDescriptor) -> NativeEndpointInputDescriptor {
    NativeEndpointInputDescriptor {
        endpoint_id: input.endpoint_id().get().to_string(),
        connector_id: input.connector_id().map(|value| value.get().to_string()),
        route_id: input.route_id().get().to_string(),
        port_name: input.port_name().to_owned(),
    }
}

fn native_connector_item(
    item: ConnectorItem<'_>,
) -> std::result::Result<NativeEndpointItem, ConnectorError> {
    match item {
        ConnectorItem::Audio { input, frame } => Ok(NativeEndpointItem {
            input_port: input.port_name().to_owned(),
            endpoint_id: input.endpoint_id().get().to_string(),
            route_id: input.route_id().get().to_string(),
            audio: Some(native_audio_with_connector(
                &frame,
                input.connector_id().map(|value| value.get()),
            )),
            signal: None,
        }),
        ConnectorItem::Signal { input, signal } => Ok(NativeEndpointItem {
            input_port: input.port_name().to_owned(),
            endpoint_id: input.endpoint_id().get().to_string(),
            route_id: input.route_id().get().to_string(),
            audio: None,
            signal: Some(
                crate::signals::copy_envelope(&signal)
                    .map_err(|message| connector_error(ConnectorErrorStage::Delivery, message))?,
            ),
        }),
    }
}

fn create_connector_instance(
    bridge: &ProviderBridge,
    instance_id: u64,
    configuration: Vec<crate::graph::NativeConfigurationEntry>,
    descriptors: Vec<NativeEndpointInputDescriptor>,
) -> std::result::Result<(), ConnectorError> {
    let mut create = provider_call("endpoint.create", Some(instance_id), Some(configuration));
    create.endpoint_inputs = Some(descriptors);
    bridge
        .call(create)
        .map(|_| ())
        .map_err(|message| connector_error(ConnectorErrorStage::Prepare, message))
}

fn cancel_connector_instance(
    bridge: &ProviderBridge,
    instance_id: u64,
) -> std::result::Result<(), ConnectorError> {
    bridge
        .call(provider_call(
            "endpoint.cancel_preparation",
            Some(instance_id),
            None,
        ))
        .map(|_| ())
        .map_err(|message| connector_error(ConnectorErrorStage::Prepare, message))
}

fn stop_connector_instance(
    bridge: &ProviderBridge,
    instance_id: u64,
    mode: EndpointShutdownMode,
) -> std::result::Result<(), ConnectorError> {
    let mut stop = provider_call("endpoint.stop", Some(instance_id), None);
    stop.shutdown_mode = Some(
        match mode {
            EndpointShutdownMode::Drain => "drain",
            EndpointShutdownMode::Abort => "abort",
        }
        .to_owned(),
    );
    let stop_result = bridge
        .call(stop)
        .map(|_| ())
        .map_err(|message| connector_error(ConnectorErrorStage::Shutdown, message));
    let close_result = bridge
        .call(provider_call("endpoint.close", Some(instance_id), None))
        .map(|_| ())
        .map_err(|message| connector_error(ConnectorErrorStage::Shutdown, message));
    stop_result.and(close_result)
}

struct JavaScriptEndpointDefinition {
    descriptor: NodeDescriptor,
    bridge: ProviderBridge,
}

impl NodeDefinition for JavaScriptEndpointDefinition {
    fn descriptor(&self) -> NodeDescriptor {
        self.descriptor.clone()
    }

    fn validate_config(&self, configuration: &NodeConfig) -> std::result::Result<(), ConfigError> {
        self.bridge
            .call(provider_call(
                "endpoint.validate",
                None,
                Some(node_configuration(configuration)),
            ))
            .map(|_| ())
            .map_err(|reason| ConfigError::Invalid {
                key: "<configuration>".to_owned(),
                reason,
            })
    }
}

struct JavaScriptEndpointFactory {
    bridge: ProviderBridge,
    group: EndpointGroupId,
    maximum_batch_items: usize,
}

impl EndpointDriverFactory for JavaScriptEndpointFactory {
    fn preparation_group(
        &self,
        route_id: RouteId,
        configuration: &NodeConfig,
    ) -> std::result::Result<EndpointPreparationGroup, EndpointFailure> {
        let mut request = provider_call(
            "endpoint.preparation_group",
            None,
            Some(node_configuration(configuration)),
        );
        request.route_id = Some(route_id.get().to_string());
        let result = self
            .bridge
            .call(request)
            .map_err(|message| endpoint_failure(EndpointFailureStage::Prepare, message))?;
        if result.route_preparation.unwrap_or(false) {
            return Ok(EndpointPreparationGroup::Route(route_id));
        }
        match result.preparation_group {
            Some(group) if !group.trim().is_empty() => Ok(EndpointPreparationGroup::Shared(
                EndpointGroupId::new(group),
            )),
            Some(_) => Err(endpoint_failure(
                EndpointFailureStage::Prepare,
                "JavaScript Endpoint preparation group cannot be empty".to_owned(),
            )),
            None => Ok(EndpointPreparationGroup::Shared(self.group.clone())),
        }
    }

    fn prepare(
        &self,
        inputs: Vec<EndpointPortInput>,
    ) -> std::result::Result<Box<dyn PreparedEndpointDriver>, EndpointFailure> {
        if inputs.is_empty() {
            return Err(endpoint_failure(
                EndpointFailureStage::Prepare,
                "JavaScript Endpoint has no connected inputs".to_owned(),
            ));
        }
        let instance_id = next_provider_instance()
            .map_err(|message| endpoint_failure(EndpointFailureStage::Prepare, message))?;
        let configuration = inputs
            .first()
            .map(|input| node_configuration(input.context().node_configuration()))
            .unwrap_or_default();
        let mut create = provider_call("endpoint.create", Some(instance_id), Some(configuration));
        create.endpoint_inputs = Some(
            inputs
                .iter()
                .map(|input| NativeEndpointInputDescriptor {
                    endpoint_id: input.context().endpoint_id().get().to_string(),
                    connector_id: input
                        .context()
                        .connector_id()
                        .map(|value| value.get().to_string()),
                    route_id: input.context().route_context().route_id().get().to_string(),
                    port_name: input.port_name().to_owned(),
                })
                .collect(),
        );
        self.bridge
            .call(create)
            .map_err(|message| endpoint_failure(EndpointFailureStage::Prepare, message))?;
        let preparation =
            match self
                .bridge
                .call(provider_call("endpoint.prepare", Some(instance_id), None))
            {
                Ok(result) => result,
                Err(message) => {
                    let _ = self.bridge.call(provider_call(
                        "endpoint.cancel_preparation",
                        Some(instance_id),
                        None,
                    ));
                    return Err(endpoint_failure(EndpointFailureStage::Prepare, message));
                }
            };
        Ok(Box::new(JavaScriptPreparedEndpoint {
            bridge: self.bridge.clone(),
            instance_id,
            inputs: Some(inputs),
            completed: false,
            maximum_batch_items: self.maximum_batch_items,
            idle_enabled: preparation.idle_enabled.unwrap_or(false),
        }))
    }
}

struct JavaScriptPreparedEndpoint {
    bridge: ProviderBridge,
    instance_id: u64,
    inputs: Option<Vec<EndpointPortInput>>,
    completed: bool,
    maximum_batch_items: usize,
    idle_enabled: bool,
}

impl Drop for JavaScriptPreparedEndpoint {
    fn drop(&mut self) {
        if !self.completed {
            let _ = self.bridge.call(provider_call(
                "endpoint.cancel_preparation",
                Some(self.instance_id),
                None,
            ));
        }
    }
}

impl PreparedEndpointDriver for JavaScriptPreparedEndpoint {
    fn start(
        mut self: Box<Self>,
        start_gate: Arc<EndpointStartGate>,
    ) -> std::result::Result<Box<dyn RunningEndpointDriver>, EndpointFailure> {
        self.bridge
            .call(provider_call(
                "endpoint.start",
                Some(self.instance_id),
                None,
            ))
            .map_err(|message| endpoint_failure(EndpointFailureStage::Start, message))?;
        let inputs = self.inputs.take().ok_or_else(|| {
            endpoint_failure(
                EndpointFailureStage::Start,
                "Endpoint inputs are unavailable".to_owned(),
            )
        })?;
        let inputs = inputs
            .into_iter()
            .map(|input| {
                let port_name = input.port_name().to_owned();
                let (receiver, context) = input.into_parts();
                EndpointWorkerInput {
                    port_name,
                    endpoint_id: context.endpoint_id().get(),
                    route_id: context.route_context().route_id().get(),
                    receiver,
                }
            })
            .collect();
        let control = Arc::new(EndpointWorkerControl::default());
        let worker_control = Arc::clone(&control);
        let bridge = self.bridge.clone();
        let instance_id = self.instance_id;
        let maximum_batch_items = self.maximum_batch_items;
        let idle_enabled = self.idle_enabled;
        let join = std::thread::Builder::new()
            .name("pks-js-endpoint".to_owned())
            .spawn(move || {
                endpoint_worker(
                    bridge,
                    instance_id,
                    inputs,
                    start_gate,
                    worker_control,
                    maximum_batch_items,
                    idle_enabled,
                )
            })
            .map_err(|failure| {
                endpoint_failure(EndpointFailureStage::Start, failure.to_string())
            })?;
        self.completed = true;
        Ok(Box::new(JavaScriptRunningEndpoint {
            bridge: self.bridge.clone(),
            instance_id: self.instance_id,
            control,
            join: Some(join),
            shutdown_mode: None,
        }))
    }

    fn cancel_preparation(mut self: Box<Self>) -> EndpointCancellationOutcome {
        let result = self
            .bridge
            .call(provider_call(
                "endpoint.cancel_preparation",
                Some(self.instance_id),
                None,
            ))
            .map(|_| ())
            .map_err(|message| endpoint_failure(EndpointFailureStage::CancelPreparation, message));
        self.completed = true;
        EndpointCancellationOutcome {
            observations: EndpointDriverObservations::default(),
            result,
        }
    }
}

#[derive(Default)]
struct EndpointWorkerControl {
    shutdown: AtomicU64,
    observations: Mutex<EndpointDriverObservations>,
}

struct JavaScriptRunningEndpoint {
    bridge: ProviderBridge,
    instance_id: u64,
    control: Arc<EndpointWorkerControl>,
    join: Option<JoinHandle<std::result::Result<(), EndpointFailure>>>,
    shutdown_mode: Option<EndpointShutdownMode>,
}

impl RunningEndpointDriver for JavaScriptRunningEndpoint {
    fn observations(&self) -> EndpointDriverObservations {
        self.control
            .observations
            .lock()
            .map(|value| *value)
            .unwrap_or_default()
    }

    fn request_stop(&mut self) -> std::result::Result<(), EndpointFailure> {
        self.request_shutdown(EndpointShutdownMode::Drain)
    }

    fn request_shutdown(
        &mut self,
        mode: EndpointShutdownMode,
    ) -> std::result::Result<(), EndpointFailure> {
        if self.shutdown_mode.is_some() {
            return Ok(());
        }
        self.shutdown_mode = Some(mode);
        let value = match mode {
            EndpointShutdownMode::Drain => 1,
            EndpointShutdownMode::Abort => 2,
        };
        self.control.shutdown.store(value, Ordering::Release);
        Ok(())
    }

    fn join_and_finalize(mut self: Box<Self>) -> EndpointDriverFinalization {
        let mode = self.shutdown_mode.unwrap_or(EndpointShutdownMode::Drain);
        self.control
            .shutdown
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .ok();
        let worker_result = self.join.take().map_or(Ok(()), |join| {
            join.join().unwrap_or_else(|_| {
                Err(endpoint_failure(
                    EndpointFailureStage::JoinFinalize,
                    "JavaScript Endpoint worker panicked".to_owned(),
                ))
            })
        });
        let mut stop_request = provider_call("endpoint.stop", Some(self.instance_id), None);
        stop_request.shutdown_mode = Some(
            match mode {
                EndpointShutdownMode::Drain => "drain",
                EndpointShutdownMode::Abort => "abort",
            }
            .to_owned(),
        );
        let stop_result = self
            .bridge
            .call(stop_request)
            .map(|_| ())
            .map_err(|message| endpoint_failure(EndpointFailureStage::JoinFinalize, message));
        let close_result = self
            .bridge
            .call(provider_call(
                "endpoint.close",
                Some(self.instance_id),
                None,
            ))
            .map(|_| ())
            .map_err(|message| endpoint_failure(EndpointFailureStage::JoinFinalize, message));
        EndpointDriverFinalization {
            observations: self.observations(),
            result: worker_result.and(stop_result).and(close_result),
        }
    }
}

fn endpoint_worker(
    bridge: ProviderBridge,
    instance_id: u64,
    mut inputs: Vec<EndpointWorkerInput>,
    start_gate: Arc<EndpointStartGate>,
    control: Arc<EndpointWorkerControl>,
    maximum_batch_items: usize,
    idle_enabled: bool,
) -> std::result::Result<(), EndpointFailure> {
    while !start_gate.is_open() {
        if control.shutdown.load(Ordering::Acquire) == 2 {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    loop {
        let shutdown = control.shutdown.load(Ordering::Acquire);
        if shutdown == 2 {
            return Ok(());
        }
        let mut batch = Vec::with_capacity(maximum_batch_items);
        while batch.len() < maximum_batch_items {
            let mut round_progressed = false;
            for input in &mut inputs {
                if batch.len() >= maximum_batch_items {
                    break;
                }
                let mut item = NativeEndpointItem {
                    input_port: input.port_name.clone(),
                    endpoint_id: input.endpoint_id.to_string(),
                    route_id: input.route_id.to_string(),
                    audio: None,
                    signal: None,
                };
                let received = match &mut input.receiver {
                    EndpointReceiver::Audio { receiver, .. } => {
                        if let Some(frame) = receiver.try_recv() {
                            item.audio = Some(native_audio(&frame));
                            true
                        } else {
                            false
                        }
                    }
                    EndpointReceiver::Signal(receiver) => {
                        if let Some(signal) = receiver.try_recv() {
                            item.signal = Some(crate::signals::copy_envelope(&signal).map_err(
                                |message| {
                                    endpoint_failure(EndpointFailureStage::JoinFinalize, message)
                                },
                            )?);
                            true
                        } else {
                            false
                        }
                    }
                };
                if received {
                    batch.push(item);
                    round_progressed = true;
                }
            }
            if !round_progressed {
                break;
            }
        }
        let abandoned = inputs.iter().all(|input| match &input.receiver {
            EndpointReceiver::Audio { receiver, .. } => receiver.is_abandoned(),
            EndpointReceiver::Signal(receiver) => receiver.is_abandoned(),
        });
        if shutdown == 1 && abandoned && batch.is_empty() {
            return Ok(());
        }
        if batch.is_empty() {
            if idle_enabled {
                bridge
                    .call(provider_call("endpoint.idle", Some(instance_id), None))
                    .map_err(|message| {
                        update_endpoint_observations(&control, |observations| {
                            observations.failures_total =
                                observations.failures_total.saturating_add(1);
                        });
                        endpoint_failure(EndpointFailureStage::JoinFinalize, message)
                    })?;
            }
            std::thread::sleep(Duration::from_millis(1));
            continue;
        }
        let amount = u64::try_from(batch.len()).unwrap_or(u64::MAX);
        update_endpoint_observations(&control, |observations| {
            observations.frames_received_total =
                observations.frames_received_total.saturating_add(amount);
        });
        let mut request = provider_call(
            if batch.len() == 1 {
                "endpoint.receive"
            } else {
                "endpoint.receive_batch"
            },
            Some(instance_id),
            None,
        );
        if batch.len() == 1 {
            let item = batch.pop().expect("single-item batch is non-empty");
            request.input_port = Some(item.input_port);
            request.endpoint_id = Some(item.endpoint_id);
            request.route_id = Some(item.route_id);
            request.audio = item.audio;
            request.signal = item.signal;
        } else {
            request.endpoint_items = Some(batch);
        }
        let result = match bridge.call(request) {
            Ok(result) => result,
            Err(message) => {
                update_endpoint_observations(&control, |observations| {
                    observations.failures_total = observations.failures_total.saturating_add(1);
                });
                return Err(endpoint_failure(
                    EndpointFailureStage::JoinFinalize,
                    message,
                ));
            }
        };
        let (delivered, dropped) = delivery_counts(&result, amount).map_err(|message| {
            update_endpoint_observations(&control, |observations| {
                observations.failures_total = observations.failures_total.saturating_add(1);
            });
            endpoint_failure(EndpointFailureStage::JoinFinalize, message)
        })?;
        update_endpoint_observations(&control, |observations| {
            observations.frames_delivered_total = observations
                .frames_delivered_total
                .saturating_add(delivered);
            observations.frames_dropped_total =
                observations.frames_dropped_total.saturating_add(dropped);
        });
    }
}

struct EndpointWorkerInput {
    port_name: String,
    endpoint_id: u64,
    route_id: u64,
    receiver: EndpointReceiver,
}

fn update_endpoint_observations(
    control: &EndpointWorkerControl,
    update: impl FnOnce(&mut EndpointDriverObservations),
) {
    if let Ok(mut observations) = control.observations.lock() {
        update(&mut observations);
    }
}

struct JavaScriptOperatorFactory {
    manifest: AsyncOperatorManifest,
    bridge: ProviderBridge,
    audio_output: Option<OperatorAudioOutputSpec>,
    output_ports: Vec<PortSpec>,
}

impl AsyncOperatorFactory for JavaScriptOperatorFactory {
    fn manifest(&self) -> &AsyncOperatorManifest {
        &self.manifest
    }

    fn validate_config(&self, configuration: &NodeConfig) -> std::result::Result<(), ConfigError> {
        self.bridge
            .call(provider_call(
                "operator.validate",
                None,
                Some(node_configuration(configuration)),
            ))
            .map(|_| ())
            .map_err(|reason| ConfigError::Invalid {
                key: "<configuration>".to_owned(),
                reason,
            })
    }

    fn create(
        &self,
        configuration: &NodeConfig,
    ) -> std::result::Result<Box<dyn AsyncNode>, NodeError> {
        let instance_id = next_provider_instance().map_err(NodeError::Prepare)?;
        self.bridge
            .call(provider_call(
                "operator.create",
                Some(instance_id),
                Some(node_configuration(configuration)),
            ))
            .map_err(NodeError::Prepare)?;
        Ok(Box::new(JavaScriptOperatorNode {
            bridge: self.bridge.clone(),
            instance_id,
            operator_id: self.manifest.operator_id().clone(),
            revision: self.manifest.revision(),
            generation: self.manifest.generation(),
            last_input: None,
            audio_output: self.audio_output.clone().map(OperatorAudioOutput::new),
            output_ports: self.output_ports.clone(),
        }))
    }
}

struct JavaScriptOperatorNode {
    bridge: ProviderBridge,
    instance_id: u64,
    operator_id: OperatorId,
    revision: u32,
    generation: u32,
    last_input: Option<(SignalLineage, SignalTiming)>,
    audio_output: Option<OperatorAudioOutput>,
    output_ports: Vec<PortSpec>,
}

impl AsyncNode for JavaScriptOperatorNode {
    fn prepare<'a>(
        &'a mut self,
        _context: &'a AsyncOperatorPrepareContext,
    ) -> AsyncNodeFuture<'a, std::result::Result<(), NodeError>> {
        Box::pin(async move {
            self.bridge
                .call_async(provider_call(
                    "operator.prepare",
                    Some(self.instance_id),
                    None,
                ))
                .await
                .map(|_| ())
                .map_err(NodeError::Prepare)
        })
    }

    fn process<'a>(
        &'a mut self,
        input: SignalEnvelope,
    ) -> AsyncNodeFuture<'a, std::result::Result<Vec<SignalEnvelope>, NodeError>> {
        self.process_port("input", input)
    }

    fn process_port<'a>(
        &'a mut self,
        input_port: &'a str,
        input: SignalEnvelope,
    ) -> AsyncNodeFuture<'a, std::result::Result<Vec<SignalEnvelope>, NodeError>> {
        Box::pin(async move {
            let lineage = input.lineage().ok_or_else(|| {
                NodeError::Process("Operator input has no source lineage".to_owned())
            })?;
            let timing = input.timing();
            self.last_input = Some((lineage, timing));
            let signal = crate::signals::copy_envelope(&input).map_err(NodeError::Process)?;
            let mut request = provider_call("operator.process", Some(self.instance_id), None);
            request.input_port = Some(input_port.to_owned());
            request.signal = Some(signal);
            let result = self
                .bridge
                .call_async(request)
                .await
                .map_err(NodeError::Process)?;
            self.build_outputs(result.emissions.unwrap_or_default(), lineage, timing)
        })
    }

    fn flush<'a>(
        &'a mut self,
    ) -> AsyncNodeFuture<'a, std::result::Result<Vec<SignalEnvelope>, NodeError>> {
        Box::pin(async move {
            let result = self
                .bridge
                .call_async(provider_call(
                    "operator.flush",
                    Some(self.instance_id),
                    None,
                ))
                .await
                .map_err(NodeError::Process)?;
            let emissions = result.emissions.unwrap_or_default();
            if emissions.is_empty() {
                return Ok(Vec::new());
            }
            let (lineage, timing) = self.last_input.ok_or_else(|| {
                NodeError::Process("Operator cannot flush output before receiving input".to_owned())
            })?;
            self.build_outputs(emissions, lineage, timing)
        })
    }

    fn cancel<'a>(&'a mut self) -> AsyncNodeFuture<'a, std::result::Result<(), NodeError>> {
        Box::pin(async move {
            self.bridge
                .call_async(provider_call(
                    "operator.cancel",
                    Some(self.instance_id),
                    None,
                ))
                .await
                .map(|_| ())
                .map_err(NodeError::Process)
        })
    }

    fn close<'a>(&'a mut self) -> AsyncNodeFuture<'a, std::result::Result<(), NodeError>> {
        Box::pin(async move {
            self.bridge
                .call_async(provider_call(
                    "operator.close",
                    Some(self.instance_id),
                    None,
                ))
                .await
                .map(|_| ())
                .map_err(NodeError::Process)
        })
    }
}

impl JavaScriptOperatorNode {
    fn build_outputs(
        &self,
        emissions: Vec<NativeProviderEmission>,
        lineage: SignalLineage,
        timing: SignalTiming,
    ) -> std::result::Result<Vec<SignalEnvelope>, NodeError> {
        emissions
            .into_iter()
            .map(|emission| {
                let port = self.manifest_output(&emission.output).ok_or_else(|| {
                    NodeError::Process(format!(
                        "Operator emitted undeclared output {:?}",
                        emission.output
                    ))
                })?;
                let payload = match emission.payload_kind.as_str() {
                    "text" => SignalPayload::Text(emission.text.ok_or_else(|| {
                        NodeError::Process("text Operator emission has no text".to_owned())
                    })?),
                    "bytes" => SignalPayload::Bytes(
                        emission
                            .bytes
                            .ok_or_else(|| {
                                NodeError::Process(
                                    "bytes Operator emission has no bytes".to_owned(),
                                )
                            })?
                            .to_vec(),
                    ),
                    "audio" => {
                        let bytes = emission.samples_f32_le.ok_or_else(|| {
                            NodeError::Process("audio Operator emission has no samples".to_owned())
                        })?;
                        let samples = decode_f32(&bytes).map_err(NodeError::Process)?;
                        let output = self.audio_output.as_ref().ok_or_else(|| {
                            NodeError::Process(
                                "Operator audio output needs exact PCM media settings".to_owned(),
                            )
                        })?;
                        SignalPayload::Audio(output.frame(&samples, lineage, timing)?)
                    }
                    kind => {
                        return Err(NodeError::Process(format!(
                            "unsupported Operator payload {kind:?}"
                        )))
                    }
                };
                let derivation = SignalDerivation::new(
                    lineage,
                    timing,
                    self.operator_id.clone(),
                    self.revision,
                    self.generation,
                    None,
                )
                .map_err(|failure| NodeError::Process(failure.to_string()))?;
                Ok(SignalEnvelope::untracked(
                    payload,
                    port.signal().clone(),
                    timing.observed_timestamp_ns(),
                )
                .with_lineage(lineage, timing)
                .with_derivation(derivation))
            })
            .collect()
    }

    fn manifest_output(&self, name: &str) -> Option<&PortSpec> {
        self.output_ports.iter().find(|port| port.name() == name)
    }
}

#[derive(Clone)]
struct OperatorAudioOutputSpec {
    sample_spec: SampleSpec,
    frame_samples_per_channel: usize,
    pool_slots: usize,
}

struct OperatorAudioOutput {
    pool: Arc<AudioBufferPool>,
    sample_spec: SampleSpec,
    samples_per_frame: usize,
}

impl OperatorAudioOutput {
    fn new(spec: OperatorAudioOutputSpec) -> Self {
        let samples_per_frame = spec
            .frame_samples_per_channel
            .saturating_mul(usize::from(spec.sample_spec.channels));
        Self {
            pool: AudioBufferPool::new(spec.pool_slots, samples_per_frame),
            sample_spec: spec.sample_spec,
            samples_per_frame,
        }
    }

    fn frame(
        &self,
        samples: &[f32],
        lineage: SignalLineage,
        timing: SignalTiming,
    ) -> std::result::Result<AudioFrame, NodeError> {
        if samples.len() != self.samples_per_frame {
            return Err(NodeError::Process(format!(
                "Operator audio emission has {} samples; expected {}",
                samples.len(),
                self.samples_per_frame
            )));
        }
        let mut buffer = self
            .pool
            .acquire()
            .ok_or_else(|| NodeError::Process("Operator audio buffer pool is full".to_owned()))?;
        buffer
            .try_copy_from_slice(samples)
            .map_err(|failure| NodeError::Process(failure.to_string()))?;
        let timestamp_ns = timing
            .session_timestamp_ns()
            .or(timing.source_timestamp_ns())
            .unwrap_or(timing.observed_timestamp_ns());
        AudioFrame::try_new(
            lineage.stream_id(),
            lineage.source_id(),
            lineage.sequence_number(),
            timestamp_ns,
            self.sample_spec,
            buffer,
        )
        .map_err(|failure| NodeError::Process(failure.to_string()))
    }
}

fn operator_audio_output(
    manifest: &AsyncOperatorManifest,
) -> Result<Option<OperatorAudioOutputSpec>> {
    let Some(MediaCaps::Audio(caps)) =
        manifest.output_ports().find_map(|port| match port.media() {
            MediaCaps::Audio(caps) => Some(MediaCaps::Audio(caps)),
            _ => None,
        })
    else {
        return Ok(None);
    };
    let sample_rate_hz = caps.sample_rate_hz.ok_or_else(|| {
        crate::errors::error(
            "operator.invalid_declaration",
            "Operator PCM output needs an exact sample rate",
        )
    })?;
    let frame_samples = caps.frame_samples.ok_or_else(|| {
        crate::errors::error(
            "operator.invalid_declaration",
            "Operator PCM output needs an exact frame size",
        )
    })?;
    let channels = match caps.channel_layout {
        ChannelLayout::Mono => 1,
        ChannelLayout::Stereo => 2,
        ChannelLayout::Any => {
            return Err(crate::errors::error(
                "operator.invalid_declaration",
                "Operator PCM output needs a concrete channel layout",
            ))
        }
    };
    Ok(Some(OperatorAudioOutputSpec {
        sample_spec: SampleSpec::new(sample_rate_hz, channels, SampleFormat::F32Interleaved),
        frame_samples_per_channel: frame_samples,
        pool_slots: manifest.queue_capacity_frames().min(u64::BITS as usize),
    }))
}

fn decode_f32(bytes: &[u8]) -> std::result::Result<Vec<f32>, String> {
    if !bytes.len().is_multiple_of(std::mem::size_of::<f32>()) {
        return Err("Operator PCM byte length is not divisible by four".to_owned());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

struct JavaScriptSourceFactory {
    manifest: SourceManifest,
    bridge: ProviderBridge,
}

impl SourceFactory for JavaScriptSourceFactory {
    fn manifest(&self) -> &SourceManifest {
        &self.manifest
    }

    fn validate_config(
        &self,
        configuration: &SourceConfiguration,
    ) -> std::result::Result<(), ConfigError> {
        self.bridge
            .call(provider_call(
                "source.validate",
                None,
                Some(source_configuration(configuration)),
            ))
            .map(|_| ())
            .map_err(|reason| ConfigError::Invalid {
                key: "<configuration>".to_owned(),
                reason,
            })
    }

    fn create(
        &self,
        configuration: &SourceConfiguration,
    ) -> std::result::Result<Box<dyn SourceDriver>, SourceDriverError> {
        let instance_id = NEXT_PROVIDER_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
        if instance_id == u64::MAX {
            return Err(SourceDriverError::Failed(
                "JavaScript provider identity space is exhausted".to_owned(),
            ));
        }
        self.bridge
            .call(provider_call(
                "source.create",
                Some(instance_id),
                Some(source_configuration(configuration)),
            ))
            .map_err(SourceDriverError::Failed)?;
        Ok(Box::new(JavaScriptSourceDriver {
            bridge: self.bridge.clone(),
            instance_id,
            manifest: self.manifest.clone(),
            session: None,
            sequences: BTreeMap::new(),
            closed: false,
        }))
    }
}

struct JavaScriptSourceDriver {
    bridge: ProviderBridge,
    instance_id: u64,
    manifest: SourceManifest,
    session: Option<SourceSessionContext>,
    sequences: BTreeMap<String, u64>,
    closed: bool,
}

impl SourceDriver for JavaScriptSourceDriver {
    fn prepare(
        &mut self,
        context: &SourcePrepareContext,
    ) -> std::result::Result<(), SourceDriverError> {
        let source_context = NativeSourceContext {
            source_type_id: context.manifest.source_type_id().as_str().to_owned(),
            session_id: context
                .session
                .as_ref()
                .map(|value| value.session_id.get().to_string()),
            source_id: context
                .session
                .as_ref()
                .map(|value| value.source_id.get().to_string()),
            outputs: context
                .session
                .as_ref()
                .map(|value| {
                    value
                        .outputs
                        .iter()
                        .map(|output| NativeSourceOutput {
                            name: output.output_port.clone(),
                            stream_id: output.stream_id.get().to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default(),
        };
        let mut request = provider_call("source.prepare", Some(self.instance_id), None);
        request.source_context = Some(source_context);
        if let Err(message) = self.bridge.call(request) {
            self.closed = true;
            let _ = self
                .bridge
                .call(provider_call("source.close", Some(self.instance_id), None));
            return Err(SourceDriverError::Failed(message));
        }
        self.session = context.session.clone();
        Ok(())
    }

    fn next(
        &mut self,
        cancellation: &SourceCancellation,
    ) -> std::result::Result<Option<SourceEmission>, SourceDriverError> {
        let mut request = provider_call("source.next", Some(self.instance_id), None);
        request.cancelled = Some(cancellation.is_cancelled());
        let result = self
            .bridge
            .call(request)
            .map_err(SourceDriverError::Failed)?;
        result
            .emission
            .map(|emission| self.build_emission(emission))
            .transpose()
    }

    fn close(&mut self) -> std::result::Result<(), SourceDriverError> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        self.bridge
            .call(provider_call("source.close", Some(self.instance_id), None))
            .map(|_| ())
            .map_err(SourceDriverError::Failed)
    }
}

impl JavaScriptSourceDriver {
    fn build_emission(
        &mut self,
        emission: NativeProviderEmission,
    ) -> std::result::Result<SourceEmission, SourceDriverError> {
        let session = self.session.as_ref().ok_or_else(|| {
            SourceDriverError::Failed("JavaScript Source has no Session context".to_owned())
        })?;
        let output = session.output(&emission.output).ok_or_else(|| {
            SourceDriverError::Failed(format!(
                "JavaScript Source emitted unknown output {:?}",
                emission.output
            ))
        })?;
        let port = self.manifest.output_port(&emission.output).ok_or_else(|| {
            SourceDriverError::Failed(format!(
                "JavaScript Source emitted undeclared output {:?}",
                emission.output
            ))
        })?;
        let payload = match emission.payload_kind.as_str() {
            "text" => SignalPayload::Text(emission.text.ok_or_else(|| {
                SourceDriverError::Failed("text Source emission has no text".to_owned())
            })?),
            "bytes" => SignalPayload::Bytes(
                emission
                    .bytes
                    .ok_or_else(|| {
                        SourceDriverError::Failed("bytes Source emission has no bytes".to_owned())
                    })?
                    .to_vec(),
            ),
            kind => {
                return Err(SourceDriverError::Failed(format!(
                    "unsupported Source payload {kind:?}"
                )))
            }
        };
        let observed_timestamp_ns =
            parse_u64("observedTimestampNs", emission.observed_timestamp_ns)?
                .unwrap_or_else(pocketstation::timing::monotonic_timestamp_ns);
        let source_timestamp_ns = parse_u64("sourceTimestampNs", emission.source_timestamp_ns)?;
        let duration_ns = parse_u64("durationNs", emission.duration_ns)?;
        let sequence = self.sequences.entry(emission.output.clone()).or_default();
        let sequence_number = *sequence;
        *sequence = sequence.saturating_add(1);
        let timing = SignalTiming::try_new(
            source_timestamp_ns,
            observed_timestamp_ns,
            source_timestamp_ns,
            duration_ns,
        )
        .map_err(|failure| SourceDriverError::Failed(failure.to_string()))?;
        let lineage = SignalLineage::try_new(
            session.session_id,
            output.stream_id,
            session.source_id,
            ClockDomainId::new(emission.clock_id.unwrap_or(1)),
            sequence_number,
            emission.source_generation.unwrap_or(1),
            parse_u64("discontinuityEpoch", emission.discontinuity_epoch)?.unwrap_or(0),
            parse_u64("policyEpoch", emission.policy_epoch)?.unwrap_or(0),
        )
        .map_err(|failure| SourceDriverError::Failed(failure.to_string()))?;
        Ok(SourceEmission {
            output_port: emission.output,
            envelope: SignalEnvelope::untracked(
                payload,
                port.signal().clone(),
                observed_timestamp_ns,
            )
            .with_lineage(lineage, timing),
            terminal: emission.terminal.unwrap_or(false),
        })
    }
}

struct JavaScriptAudioConnector {
    bridge: ProviderBridge,
}

impl AudioConnector for JavaScriptAudioConnector {
    fn start(&mut self) -> std::result::Result<(), ConnectorError> {
        self.bridge
            .call(call("start"))
            .map(|_| ())
            .map_err(|message| connector_error(ConnectorErrorStage::Startup, message))
    }

    fn send(&mut self, frame: &EndpointAudioFrame) -> std::result::Result<(), ConnectorError> {
        let mut request = provider_call("send", None, None);
        request.audio = Some(native_audio(frame));
        self.bridge
            .call(request)
            .map(|_| ())
            .map_err(|message| connector_error(ConnectorErrorStage::Delivery, message))
    }

    fn stop(&mut self) -> std::result::Result<(), ConnectorError> {
        let mut request = provider_call("stop", None, None);
        request.shutdown_mode = Some("drain".to_owned());
        self.bridge
            .call(request)
            .map(|_| ())
            .map_err(|message| connector_error(ConnectorErrorStage::Shutdown, message))
    }
}

fn call(operation: &str) -> NativeProviderCall {
    provider_call(operation, None, None)
}

fn provider_call(
    operation: &str,
    instance_id: Option<u64>,
    configuration: Option<Vec<crate::graph::NativeConfigurationEntry>>,
) -> NativeProviderCall {
    NativeProviderCall {
        operation: operation.to_owned(),
        instance_id: instance_id.map(|value| value.to_string()),
        shutdown_mode: None,
        audio: None,
        configuration,
        source_context: None,
        cancelled: None,
        input_port: None,
        signal: None,
        route_id: None,
        endpoint_id: None,
        endpoint_inputs: None,
        endpoint_items: None,
    }
}

fn endpoint_failure(stage: EndpointFailureStage, message: String) -> EndpointFailure {
    if let Some(encoded) = message.find("PKSCE1:").map(|index| &message[index + 7..]) {
        let mut fields = encoded.splitn(4, ':');
        if let (Some(code), Some(_connector_stage), Some(retryability), Some(detail)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        {
            let retryability = match retryability {
                "retryable" => EndpointFailureRetryability::Retryable,
                "retry-after-reconfiguration" => {
                    EndpointFailureRetryability::ReconfigurationRequired
                }
                _ => EndpointFailureRetryability::Never,
            };
            return EndpointFailure::new(stage, bounded_message(format!("{code}: {detail}")))
                .with_external_details(code, retryability);
        }
    }
    EndpointFailure::new(stage, bounded_message(message)).with_external_details(
        "javascript.provider_failed",
        EndpointFailureRetryability::Never,
    )
}

fn delivery_counts(
    result: &NativeProviderResult,
    expected: u64,
) -> std::result::Result<(u64, u64), String> {
    let outcomes = result.outcomes.as_deref();
    if let Some(outcomes) = outcomes {
        if u64::try_from(outcomes.len()).unwrap_or(u64::MAX) != expected {
            return Err("JavaScript Endpoint returned the wrong number of outcomes".to_owned());
        }
        let mut delivered = 0_u64;
        let mut dropped = 0_u64;
        for outcome in outcomes {
            match outcome.as_str() {
                "delivered" => delivered = delivered.saturating_add(1),
                "dropped" => dropped = dropped.saturating_add(1),
                _ => return Err("JavaScript Endpoint returned an invalid outcome".to_owned()),
            }
        }
        return Ok((delivered, dropped));
    }
    match result.outcome.as_deref().unwrap_or("delivered") {
        "delivered" => Ok((expected, 0)),
        "dropped" => Ok((0, expected)),
        _ => Err("JavaScript Endpoint returned an invalid outcome".to_owned()),
    }
}

fn native_audio(frame: &EndpointAudioFrame) -> NativeProviderAudio {
    native_audio_with_connector(frame, None)
}

fn native_audio_with_connector(
    frame: &EndpointAudioFrame,
    connector_id: Option<u64>,
) -> NativeProviderAudio {
    let mut bytes = Vec::with_capacity(frame.samples().len().saturating_mul(4));
    for sample in frame.samples() {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    NativeProviderAudio {
        samples_f32_le: bytes.into(),
        sample_count: u32::try_from(frame.samples().len()).unwrap_or(u32::MAX),
        sample_rate_hz: frame.sample_rate_hz(),
        channel_count: frame.channels(),
        source_id: frame.source_id().get().to_string(),
        stream_id: frame.stream_id().get().to_string(),
        sequence_number: frame.sequence_number().to_string(),
        timestamp_ns: frame.timestamp_ns().to_string(),
        route_enqueued_at_ns: frame.route_enqueued_at_ns().to_string(),
        route_received_at_ns: frame.route_received_at_ns().to_string(),
        output_generation_id: frame
            .output_generation_id()
            .map(|value| value.get().to_string()),
        source_generation: frame.lineage().source_generation(),
        discontinuity_epoch: frame.lineage().discontinuity_epoch().to_string(),
        permission_epoch: frame.lineage().permission_epoch().to_string(),
        clock_id: frame.lineage().clock_id().get(),
        duration_ns: frame.lineage().duration_ns().to_string(),
        connector_id: connector_id.map(|value| value.to_string()),
    }
}

fn node_configuration(configuration: &NodeConfig) -> Vec<crate::graph::NativeConfigurationEntry> {
    configuration
        .iter()
        .map(|(key, value)| crate::graph::NativeConfigurationEntry {
            key: key.to_owned(),
            value: value.to_owned(),
            sensitive: Some(false),
        })
        .collect()
}

fn next_provider_instance() -> std::result::Result<u64, String> {
    NEXT_PROVIDER_INSTANCE_ID
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
            value.checked_add(1)
        })
        .map_err(|_| "JavaScript provider identity space is exhausted".to_owned())
}

fn source_configuration(
    configuration: &SourceConfiguration,
) -> Vec<crate::graph::NativeConfigurationEntry> {
    configuration
        .iter()
        .map(|(key, value)| crate::graph::NativeConfigurationEntry {
            key: key.to_owned(),
            value: value.to_owned(),
            sensitive: Some(false),
        })
        .collect()
}

fn parse_u64(
    name: &str,
    value: Option<String>,
) -> std::result::Result<Option<u64>, SourceDriverError> {
    value
        .map(|value| {
            value.parse::<u64>().map_err(|_| {
                SourceDriverError::Failed(format!("{name} must be an unsigned 64-bit integer"))
            })
        })
        .transpose()
}

fn connector_error(stage: ConnectorErrorStage, message: String) -> ConnectorError {
    if let Some(encoded) = message.find("PKSCE1:").map(|index| &message[index + 7..]) {
        let mut fields = encoded.splitn(4, ':');
        if let (Some(code), Some(encoded_stage), Some(retryability), Some(detail)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        {
            let stage = match encoded_stage {
                "configuration" => ConnectorErrorStage::Configuration,
                "prepare" => ConnectorErrorStage::Prepare,
                "startup" => ConnectorErrorStage::Startup,
                "readiness" => ConnectorErrorStage::Readiness,
                "delivery" => ConnectorErrorStage::Delivery,
                "retry" => ConnectorErrorStage::Retry,
                "shutdown" => ConnectorErrorStage::Shutdown,
                "join" => ConnectorErrorStage::Join,
                _ => stage,
            };
            let retryability = match retryability {
                "retryable" => ConnectorRetryability::Retryable,
                "retry-after-reconfiguration" => ConnectorRetryability::RetryAfterReconfiguration,
                _ => ConnectorRetryability::Never,
            };
            if let Ok(code) = ConnectorErrorCode::new(code) {
                if let Ok(error) = ConnectorError::new(
                    code,
                    stage,
                    retryability,
                    bounded_message(detail.to_owned()),
                ) {
                    return error;
                }
            }
        }
    }
    ConnectorError::new(
        ConnectorErrorCode::new("javascript.provider_failed")
            .expect("static Connector error code must be valid"),
        stage,
        ConnectorRetryability::Never,
        bounded_message(message),
    )
    .expect("bounded Connector error must be valid")
}

fn bounded_message(mut message: String) -> String {
    if message.trim().is_empty() {
        return "JavaScript provider failed without an error message".to_owned();
    }
    if message.len() > MAXIMUM_PROVIDER_ERROR_BYTES {
        let mut end = MAXIMUM_PROVIDER_ERROR_BYTES;
        while !message.is_char_boundary(end) {
            end = end.saturating_sub(1);
        }
        message.truncate(end);
    }
    message
}

#[cfg(test)]
mod tests {
    use super::{bounded_message, MAXIMUM_PROVIDER_ERROR_BYTES};

    #[test]
    fn provider_error_limit_preserves_utf8() {
        let message = "🟠".repeat(MAXIMUM_PROVIDER_ERROR_BYTES);
        let result = bounded_message(message);

        assert!(result.len() <= MAXIMUM_PROVIDER_ERROR_BYTES);
        assert!(result.chars().all(|character| character == '🟠'));
    }

    #[test]
    fn empty_provider_error_has_an_actionable_message() {
        assert_eq!(
            bounded_message("  ".to_owned()),
            "JavaScript provider failed without an error message"
        );
    }
}
