use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use futures::channel::oneshot;
use napi::bindgen_prelude::{spawn_blocking, AsyncTask, ClassInstance, Function, Promise};
use napi::{Env, Result, Task};
use napi_derive::napi;
use pocketstation::connector::{ConnectorSecret, RegisteredConnector};
use pocketstation_relay::{
    RelayConnector, RelayIceServer, RelayPublishReceiptKey, RelayRouteConfiguration,
};

use crate::application_audio::NativeAudioInput;
use crate::errors::{error, state_unavailable};
use crate::extensions::{
    native_extension_error, require_absolute_library_path, source_configuration, source_type_id,
    NativeExtensionLibrary, NativeSourceInstance,
};
use crate::graph::{
    NativeConfigurationEntry, NativeDeliveryPolicy, NativeEndpointDefinition, NativeOperator,
    NativeOperatorInput, NativeOperatorInstance, NativePortSpec, NativeRouteSettings,
};
use crate::observations::{
    copy_metrics, copy_recording_outcome, copy_trace_outcome, sample_representation_name,
    NativeCaptureFormat, NativeRecordingOutcome, NativeSessionMetrics, NativeTraceRecorderOutcome,
};
use crate::provider::{NativeConnectorManifest, NativeProviderCall, NativeProviderResult};
use crate::sidecar::{
    error_reason as sidecar_error_reason, poll as poll_sidecar, runtime_error as sidecar_error,
    snapshot as sidecar_snapshot, wait as wait_sidecar, NativeSidecarMessage,
    NativeSidecarProcessSpec, NativeSidecarRead, NativeSidecarSnapshot, MAXIMUM_WAIT_MS,
};
use crate::signals::{
    close_signal, close_signals, copy_signal_metrics, new_signal_receipts, read_signal,
    subscribe_derived, subscribe_source_output, validate_subscription, NativeBusSubscription,
    NativeSignalMetrics, NativeSignalRead, SignalReceipts,
};
use crate::sources::{platform_name, source_kind_name, NativeSource};
use crate::streams::{copy_audio, copy_retained_audio, NativeAudioRead};

const COMMAND_CAPACITY_COUNT: usize = 8;
const MAXIMUM_AUDIO_WAIT_MS: u32 = 1_000;
const MAXIMUM_TRACE_CAPACITY_RECORDS: u32 = 1_000_000;

#[napi(object)]
pub struct NativeSourceReplacement {
    pub stem_id: String,
    pub previous_source_id: String,
    pub source_id: String,
    pub source_generation: u32,
    pub discontinuity_epoch: String,
    pub opened_native_format: Option<NativeCaptureFormat>,
}

fn replacement_result(value: pocketstation::SessionSourceReplacement) -> NativeSourceReplacement {
    NativeSourceReplacement {
        stem_id: value.stem_id.get().to_string(),
        previous_source_id: value.previous_source_id.get().to_string(),
        source_id: value.source_id.get().to_string(),
        source_generation: value.source_generation,
        discontinuity_epoch: value.discontinuity_epoch.to_string(),
        opened_native_format: value
            .opened_native_format
            .map(|format| NativeCaptureFormat {
                sample_rate_hz: format.sample_rate_hz,
                channel_count: u32::from(format.channel_count),
                sample_representation: sample_representation_name(format.sample_representation)
                    .to_owned(),
            }),
    }
}

fn replacement_error_code(failure: &pocketstation::SessionSourceReplacementError) -> &'static str {
    use pocketstation::SessionSourceReplacementError::*;
    match failure {
        SessionNotRunning => "source.session_not_running",
        UnknownStem { .. } => "source.unknown_stem",
        NotMicrophone { .. } => "source.not_microphone",
        Prepare { .. } => "source.replacement_prepare_failed",
        Open { .. } => "source.replacement_open_failed",
        Reopen { .. } => "source.reopen_failed",
        ControlQueueFull => "source.replacement_queue_full",
        RuntimeStopped => "source.runtime_stopped",
        ResponseTimedOut { .. } => "source.replacement_response_timed_out",
    }
}

fn replacement_error(failure: pocketstation::SessionSourceReplacementError) -> napi::Error {
    let code = replacement_error_code(&failure);
    error(code, failure.to_string())
}

#[cfg(feature = "conformance-fixtures")]
#[napi]
pub fn conformance_source_replacement_error(case_name: String) -> Result<()> {
    use pocketstation::{CaptureError, SessionSourceReplacementError::*, StemId};
    let stem_id = StemId::new(7);
    let failure = match case_name.as_str() {
        "session-not-running" => SessionNotRunning,
        "unknown-stem" => UnknownStem { stem_id },
        "not-microphone" => NotMicrophone { stem_id },
        "prepare" => Prepare {
            source: CaptureError::NotSupported,
        },
        "open" => Open {
            source: CaptureError::NotSupported,
        },
        "reopen" => Reopen {
            source: CaptureError::NotSupported,
        },
        "control-queue-full" => ControlQueueFull,
        "runtime-stopped" => RuntimeStopped,
        "response-timed-out" => ResponseTimedOut { timeout_ms: 250 },
        _ => {
            return Err(error(
                "source.invalid_conformance_case",
                "unknown source replacement conformance case",
            ));
        }
    };
    Err(replacement_error(failure))
}

#[napi(object)]
pub struct NativeSourceFailure {
    pub source_event_kind: String,
    pub stem_id: String,
    pub source_platform: String,
    pub source_kind: String,
    pub source_stable_key: String,
    pub source_id: String,
    pub source_generation: u32,
    pub source_recovery_requirement: Option<String>,
    pub source_failure_operation: String,
    pub source_failure_class: String,
    pub source_platform_status_code: Option<i32>,
    pub source_backend_class: Option<String>,
}

#[napi(object)]
pub struct NativeEndpointFailure {
    pub route_id: String,
    pub endpoint_id: String,
    pub failure_stage: String,
    pub failure_message: String,
    pub failure_code: Option<String>,
    pub failure_retryability: Option<String>,
}

#[napi(object)]
pub struct NativeControlFailure {
    pub failure_stage: String,
    pub component_kind: String,
    pub component_id: String,
    pub failure_operation: String,
    pub failure_error_class: String,
}

#[napi(object)]
pub struct NativeSessionEvent {
    pub event_type: String,
    pub session_id: String,
    pub session_state: Option<String>,
    pub source_event_kind: Option<String>,
    pub stem_id: Option<String>,
    pub source_platform: Option<String>,
    pub source_kind: Option<String>,
    pub source_stable_key: Option<String>,
    pub source_id: Option<String>,
    pub source_generation: Option<u32>,
    pub source_recovery_requirement: Option<String>,
    pub source_failure_operation: Option<String>,
    pub source_failure_class: Option<String>,
    pub source_platform_status_code: Option<i32>,
    pub source_backend_class: Option<String>,
    pub route_id: Option<String>,
    pub endpoint_id: Option<String>,
    pub failure_stage: Option<String>,
    pub failure_message: Option<String>,
    pub failure_code: Option<String>,
    pub failure_retryability: Option<String>,
    pub component_kind: Option<String>,
    pub component_id: Option<String>,
    pub failure_operation: Option<String>,
    pub failure_error_class: Option<String>,
    pub source_failures_total: Option<String>,
    pub endpoint_failures_total: Option<String>,
    pub rollback_failures_total: Option<String>,
    pub finalization_failures_total: Option<String>,
    pub source_failures: Option<Vec<NativeSourceFailure>>,
    pub endpoint_failures: Option<Vec<NativeEndpointFailure>>,
    pub rollback_failures: Option<Vec<NativeControlFailure>>,
    pub finalization_failures: Option<Vec<NativeControlFailure>>,
}

#[napi(object)]
pub struct NativeEventRead {
    pub event: Option<NativeSessionEvent>,
    pub session_state: String,
}

#[napi(object)]
pub struct NativeSessionOptions {
    pub sample_rate_hz: Option<u32>,
    pub channels: Option<u8>,
    pub frame_duration_ms: Option<u32>,
    pub recording_root: Option<String>,
    pub trace_path: Option<String>,
    pub trace_capacity_records: Option<u32>,
}

#[napi(object)]
pub struct NativeRelayIceServer {
    pub urls: Vec<String>,
}

#[napi(object)]
pub struct NativeRelayDestinationOptions {
    pub url: String,
    pub session_id: String,
    pub source_token: String,
    pub bus_id: String,
    pub low_latency: Option<bool>,
    pub startup_timeout_ms: Option<u32>,
    pub ice_servers: Option<Vec<NativeRelayIceServer>>,
}

#[napi(object)]
pub struct NativeRelayPublishOutcome {
    pub bus_id: String,
    pub endpoint_id: String,
    pub route_id: String,
    pub frames_received_total: String,
    pub rtp_packets_sent_total: String,
    pub rtp_payload_bytes_sent_total: String,
    pub ingress_queue_drops_total: String,
    pub publisher_stale_drops_total: String,
    pub cancelled_output_frames_total: String,
    pub cancelled_output_samples_total: String,
    pub failures_total: String,
    pub error: Option<String>,
}

struct RelayRouteRegistration {
    bus_id: String,
    key: RelayPublishReceiptKey,
}

struct RelayRuntime {
    connector: Arc<RelayConnector>,
    routes: Vec<RelayRouteRegistration>,
}

#[napi(object)]
pub struct NativeStopResult {
    pub success: bool,
    pub already_stopped: bool,
    pub disposition: String,
    pub session_state: String,
    pub runtime_worker_panicked: bool,
    pub capture_finalization_failures_total: String,
    pub operator_finalization_failures_total: String,
    pub endpoint_finalization_failures_total: String,
    pub runtime_failures_total: String,
    pub lineage_failures_total: String,
    pub source_send_rejections_total: String,
    pub runtime_events_total: String,
    pub sidecar_outcomes: Vec<NativeSidecarSnapshot>,
    pub relay_outcomes: Vec<NativeRelayPublishOutcome>,
    pub recording: Option<NativeRecordingOutcome>,
    pub trace: Option<NativeTraceRecorderOutcome>,
    pub trace_error: Option<String>,
    pub metrics: Option<NativeSessionMetrics>,
    pub metrics_unavailable_reason: Option<String>,
    pub remaining_events: Vec<NativeSessionEvent>,
}

#[napi(object)]
#[derive(Clone)]
pub struct NativeCompileDiagnostic {
    pub code: String,
    pub node_index: Option<u32>,
    pub edge_index: Option<u32>,
    pub operator_id: Option<String>,
    pub operator_instance_id: Option<String>,
    pub node_type_id: Option<String>,
    pub source_type_id: Option<String>,
    pub port_name: Option<String>,
    pub direction: Option<String>,
    pub expected: Option<String>,
    pub actual: Option<String>,
}

#[napi(object)]
#[derive(Clone)]
pub struct NativeStartFailure {
    pub code: String,
    pub message: String,
    pub diagnostic: Option<NativeCompileDiagnostic>,
}

#[napi(js_name = "NativeStartResult")]
pub struct NativeStartResult {
    running: Option<NativeRunningSession>,
    failure: Option<NativeStartFailure>,
}

#[napi]
impl NativeStartResult {
    #[napi(getter)]
    pub fn failure(&self) -> Option<NativeStartFailure> {
        self.failure.clone()
    }

    #[napi]
    pub fn take_running(&mut self) -> Option<NativeRunningSession> {
        self.running.take()
    }
}

#[napi(js_name = "NativeEndpoint")]
pub struct NativeEndpoint {
    pub(crate) session_id: u64,
    pub(crate) handle: pocketstation::EndpointHandle,
}

#[napi]
impl NativeEndpoint {
    #[napi(getter)]
    pub fn id(&self) -> String {
        self.handle.id().get().to_string()
    }

    #[napi(getter)]
    pub fn session_id(&self) -> String {
        self.session_id.to_string()
    }

    #[napi(getter)]
    pub fn connector_id(&self) -> Option<String> {
        self.handle
            .connector_id()
            .map(|value| value.get().to_string())
    }
}

#[napi(js_name = "NativeRegisteredConnector")]
pub struct NativeRegisteredConnector {
    registered: pocketstation::connector::RegisteredConnector,
}

#[napi]
impl NativeRegisteredConnector {
    #[napi(getter)]
    pub fn session_id(&self) -> String {
        self.registered.session_id().get().to_string()
    }
}

#[napi(js_name = "NativeStem")]
pub struct NativeStem {
    pub(crate) session_id: u64,
    pub(crate) handle: pocketstation::StemHandle,
}

#[napi]
impl NativeStem {
    #[napi(getter)]
    pub fn id(&self) -> String {
        self.handle.id().get().to_string()
    }

    #[napi]
    pub fn send(&self, endpoint: &NativeEndpoint, input_port: Option<String>) -> Result<String> {
        if endpoint.session_id != self.session_id {
            return Err(error(
                "session.foreign_endpoint",
                "Stem and Endpoint belong to different Sessions",
            ));
        }
        self.handle
            .send_to(endpoint.handle, input_port)
            .map(|route_id| route_id.get().to_string())
            .map_err(|failure| error("session.invalid_route", failure.to_string()))
    }

    #[napi]
    pub fn connect(&self, input: &NativeOperatorInput) -> Result<String> {
        self.connect_input(input)
    }

    #[napi]
    pub fn through(
        &self,
        operator: &NativeOperator,
        input_port: Option<String>,
        output_port: Option<String>,
    ) -> Result<crate::graph::NativeDerivedStream> {
        self.through_operator(operator, input_port, output_port)
    }

    #[napi]
    pub fn record(&self, name: String) -> Result<NativeEndpoint> {
        if name.trim().is_empty() {
            return Err(error(
                "session.invalid_recording_name",
                "recording name cannot be empty",
            ));
        }
        self.handle
            .record(name)
            .map(|handle| NativeEndpoint {
                session_id: self.session_id,
                handle,
            })
            .map_err(|failure| error("session.invalid_recording", failure.to_string()))
    }
    #[napi]
    pub fn retain_audio(&self) -> Result<NativeEndpoint> {
        self.handle
            .retain_audio()
            .map(|handle| NativeEndpoint {
                session_id: self.session_id,
                handle,
            })
            .map_err(|failure| error("session.invalid_endpoint", failure.to_string()))
    }
}

#[napi(js_name = "NativeSession")]
pub struct NativeSession {
    session: Arc<Mutex<Option<pocketstation::Session>>>,
    session_id: u64,
    signal_receipts: SignalReceipts,
    next_signal_subscription_id: AtomicU64,
    relay_connector: Mutex<Option<Arc<RelayConnector>>>,
    relay_registered: Mutex<Option<RegisteredConnector>>,
    relay_routes: Mutex<Vec<RelayRouteRegistration>>,
}

#[napi]
impl NativeSession {
    #[napi]
    pub fn audio_history(
        &self,
        retention_ns: String,
        max_pcm_bytes: u32,
        max_buffers: u32,
    ) -> Result<crate::recording::NativeAudioHistory> {
        let retention_ns = retention_ns.parse().map_err(|_| {
            error(
                "recording.history_invalid_limits",
                "retentionNs must be an unsigned 64-bit integer",
            )
        })?;
        self.with_session(|session| {
            session
                .audio_history(pocketstation::AudioHistoryConfig {
                    retention_ns,
                    max_pcm_bytes: max_pcm_bytes as usize,
                    max_buffers: max_buffers as usize,
                })
                .map(|inner| crate::recording::NativeAudioHistory { inner })
                .map_err(|failure| {
                    error(
                        match &failure {
                            pocketstation::AudioHistoryDeclarationError::History(reason) => {
                                reason.code()
                            }
                            pocketstation::AudioHistoryDeclarationError::Session(_) => {
                                "session.invalid_endpoint"
                            }
                        },
                        failure.to_string(),
                    )
                })
        })
    }
    #[napi(constructor)]
    pub fn new(options: Option<NativeSessionOptions>) -> Result<Self> {
        let options = options.unwrap_or(NativeSessionOptions {
            sample_rate_hz: None,
            channels: None,
            frame_duration_ms: None,
            recording_root: None,
            trace_path: None,
            trace_capacity_records: None,
        });
        let sample_rate_hz = options.sample_rate_hz.unwrap_or(48_000);
        let channels = options.channels.unwrap_or(1);
        if sample_rate_hz == 0 || !matches!(channels, 1 | 2) {
            return Err(error(
                "session.invalid_sample_spec",
                "sampleRateHz must be greater than zero and channels must be 1 or 2",
            ));
        }
        let frame_duration = match options.frame_duration_ms.unwrap_or(20) {
            10 => pocketstation::AudioFrameDuration::Ms10,
            20 => pocketstation::AudioFrameDuration::Ms20,
            _ => {
                return Err(error(
                    "session.invalid_frame_duration",
                    "frameDurationMs must be 10 or 20",
                ))
            }
        };
        let mut builder = pocketstation::Session::builder()
            .sample_spec(pocketstation::SampleSpec::new(
                sample_rate_hz,
                channels,
                pocketstation::SampleFormat::F32Interleaved,
            ))
            .audio_frame_duration(frame_duration);
        if let Some(recording_root) = options.recording_root {
            if recording_root.trim().is_empty() {
                return Err(error(
                    "session.invalid_recording_root",
                    "recordingRoot cannot be empty",
                ));
            }
            builder = builder.recording_root(recording_root);
        }
        match (options.trace_path, options.trace_capacity_records) {
            (None, None) => {}
            (Some(path), capacity) => {
                if path.trim().is_empty() {
                    return Err(error(
                        "session.invalid_trace_configuration",
                        "trace.path cannot be empty",
                    ));
                }
                let capacity = capacity.unwrap_or(256);
                if capacity == 0 || capacity > MAXIMUM_TRACE_CAPACITY_RECORDS {
                    return Err(error(
                        "session.invalid_trace_configuration",
                        "trace.capacityRecords must be an integer between 1 and 1000000",
                    ));
                }
                builder = builder.session_trace(path, capacity as usize);
            }
            (None, Some(_)) => {
                return Err(error(
                    "session.invalid_trace_configuration",
                    "trace.path is required when trace.capacityRecords is set",
                ));
            }
        }
        let session = builder.build();
        let session_id = session.id().get();
        Ok(Self {
            session: Arc::new(Mutex::new(Some(session))),
            session_id,
            signal_receipts: new_signal_receipts(),
            next_signal_subscription_id: AtomicU64::new(0),
            relay_connector: Mutex::new(None),
            relay_registered: Mutex::new(None),
            relay_routes: Mutex::new(Vec::new()),
        })
    }

    #[napi(getter)]
    pub fn id(&self) -> String {
        self.session_id.to_string()
    }

    #[napi]
    pub fn capture(&self, source: &NativeSource) -> Result<NativeStem> {
        self.with_session(|session| {
            session
                .capture(source.declaration.clone())
                .map(|handle| NativeStem {
                    session_id: self.session_id,
                    handle,
                })
                .map_err(|failure| error("session.invalid_source", failure.to_string()))
        })
    }

    #[napi]
    pub fn echo_cancel(
        &self,
        microphone: crate::aec::AudioInput<'_>,
        reference: crate::aec::AudioInput<'_>,
        coverage: String,
    ) -> Result<crate::aec::NativeEchoCancelledAudio> {
        let microphone = crate::aec::echo_input(microphone);
        let reference = crate::aec::echo_input(reference);
        let reference = match coverage.as_str() {
            "selected-application" => {
                pocketstation::PlaybackReference::selected_application(reference)
            }
            "authorized-output-mix" => pocketstation::PlaybackReference::output_mix(reference),
            "caller-rendered-audio" => pocketstation::PlaybackReference::rendered_audio(reference),
            _ => {
                return Err(error(
                    "session.invalid_operator",
                    "unknown playback reference coverage",
                ))
            }
        };
        self.with_session(|session| {
            session
                .echo_cancel(microphone, reference)
                .map(|handle| crate::aec::NativeEchoCancelledAudio {
                    session_id: self.session_id,
                    handle,
                })
                .map_err(|failure| error("session.invalid_operator", failure.to_string()))
        })
    }

    #[napi]
    pub fn native_aec(&self, microphone: &NativeStem, playback_device_id: String) -> Result<()> {
        self.with_session(|session| {
            session
                .native_aec(
                    &microphone.handle,
                    pocketstation::NativePlaybackReference::output(pocketstation::DeviceId::new(
                        playback_device_id,
                    )),
                )
                .map_err(|failure| error("session.invalid_operator", failure.to_string()))
        })
    }

    #[napi]
    pub fn audio_input(
        &self,
        sample_rate_hz: u32,
        channels: u8,
        capacity_frames: u32,
        frame_samples_per_channel: u32,
    ) -> Result<NativeAudioInput> {
        let configuration = pocketstation::AudioInputConfig::new(
            pocketstation::SampleSpec::new(
                sample_rate_hz,
                channels,
                pocketstation::SampleFormat::F32Interleaved,
            ),
            capacity_frames as usize,
            frame_samples_per_channel as usize,
        )
        .map_err(|failure| error("audio_input.invalid_configuration", failure.to_string()))?;
        self.with_session(|session| {
            session
                .audio_input(configuration)
                .map(|input| NativeAudioInput::new(self.session_id, input))
                .map_err(|failure| error("audio_input.invalid_configuration", failure.to_string()))
        })
    }

    #[napi]
    pub fn audio(&self) -> Result<NativeEndpoint> {
        self.with_session(|session| {
            session
                .polled_audio()
                .map(|handle| NativeEndpoint {
                    session_id: self.session_id,
                    handle,
                })
                .map_err(|failure| error("session.invalid_endpoint", failure.to_string()))
        })
    }

    #[napi]
    pub fn browser(&self, receiver_uri: String) -> Result<NativeEndpoint> {
        if receiver_uri.trim().is_empty() {
            return Err(error(
                "session.invalid_endpoint",
                "receiver URI cannot be empty",
            ));
        }
        self.with_session(|session| {
            session
                .browser(receiver_uri)
                .map(|handle| NativeEndpoint {
                    session_id: self.session_id,
                    handle,
                })
                .map_err(|failure| error("session.invalid_endpoint", failure.to_string()))
        })
    }

    #[napi]
    pub fn audio_connector(
        &self,
        dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
        deadline_ms: Option<u32>,
        route: Option<&NativeRouteSettings>,
    ) -> Result<NativeEndpoint> {
        let connector = crate::provider::audio_connector(dispatch, deadline_ms)?;
        self.with_session(|session| {
            let registered = session
                .register_connector(connector)
                .map_err(|failure| error("connector.registration_failed", failure.to_string()))?;
            registered
                .declare_with_route_settings(
                    session,
                    pocketstation::connector::ConnectorConfiguration::new(),
                    route.map_or_else(pocketstation::RouteSettings::realtime_audio, |settings| {
                        settings.value
                    }),
                )
                .map(|handle| NativeEndpoint {
                    session_id: self.session_id,
                    handle,
                })
                .map_err(|failure| error("connector.registration_failed", failure.to_string()))
        })
    }

    #[napi]
    pub fn audio_with_route(&self, route: &NativeRouteSettings) -> Result<NativeEndpoint> {
        self.with_session(|session| {
            session
                .polled_audio_with_route_settings(route.value)
                .map(|handle| NativeEndpoint {
                    session_id: self.session_id,
                    handle,
                })
                .map_err(|failure| error("session.invalid_endpoint", failure.to_string()))
        })
    }

    #[napi]
    pub fn relay_audio(&self, options: NativeRelayDestinationOptions) -> Result<NativeEndpoint> {
        let source_token = ConnectorSecret::new(options.source_token)
            .map_err(|failure| error("relay.invalid_source_token", failure.to_string()))?;
        let mut configuration = RelayRouteConfiguration::new(
            options.url,
            options.session_id,
            source_token,
            options.bus_id,
        )
        .map_err(|failure| error("relay.invalid_configuration", failure.to_string()))?;
        if options.low_latency.unwrap_or(false) {
            configuration = configuration.with_low_latency();
        }
        if let Some(timeout_ms) = options.startup_timeout_ms {
            configuration = configuration
                .with_startup_timeout(Duration::from_millis(u64::from(timeout_ms)))
                .map_err(|failure| error("relay.invalid_configuration", failure.to_string()))?;
        }
        if let Some(servers) = options.ice_servers {
            let servers = servers
                .into_iter()
                .map(|server| RelayIceServer::new(server.urls))
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(|failure| error("relay.invalid_configuration", failure.to_string()))?;
            configuration = configuration
                .with_ice_servers(servers)
                .map_err(|failure| error("relay.invalid_configuration", failure.to_string()))?;
        }
        let configuration = configuration
            .connector_configuration()
            .map_err(|failure| error("relay.invalid_configuration", failure.to_string()))?;

        let session = self
            .session
            .lock()
            .map_err(|_| state_unavailable("Session"))?;
        let session = session
            .as_ref()
            .ok_or_else(|| error("session.draft_frozen", "Session has already started"))?;
        let mut connector = self
            .relay_connector
            .lock()
            .map_err(|_| state_unavailable("Relay connector"))?;
        let mut registered = self
            .relay_registered
            .lock()
            .map_err(|_| state_unavailable("registered Relay connector"))?;
        if registered.is_none() {
            let relay = Arc::new(
                RelayConnector::new()
                    .map_err(|failure| error("relay.registration_failed", failure.to_string()))?,
            );
            let registration = relay
                .register(session)
                .map_err(|failure| error("relay.registration_failed", failure.to_string()))?;
            *connector = Some(relay);
            *registered = Some(registration);
        }
        let registered = registered.as_ref().ok_or_else(|| {
            error(
                "relay.registration_failed",
                "Relay connector registration did not produce a destination",
            )
        })?;
        let handle = registered
            .declare(
                session,
                configuration,
                pocketstation::RouteSettings::realtime_audio(),
            )
            .map_err(|failure| error("relay.destination_failed", failure.to_string()))?;
        Ok(NativeEndpoint {
            session_id: self.session_id,
            handle,
        })
    }

    #[napi]
    pub fn register_relay_route(
        &self,
        bus_id: String,
        endpoint: &NativeEndpoint,
        route_id: String,
    ) -> Result<()> {
        if endpoint.session_id != self.session_id {
            return Err(error(
                "session.foreign_endpoint",
                "Relay Endpoint belongs to a different Session",
            ));
        }
        if bus_id.trim().is_empty() {
            return Err(error(
                "relay.invalid_configuration",
                "AudioBus name cannot be empty",
            ));
        }
        let route_id = route_id.parse::<u64>().map_err(|_| {
            error(
                "session.invalid_route",
                "Relay route ID must be an unsigned 64-bit integer",
            )
        })?;
        if route_id == 0 {
            return Err(error(
                "session.invalid_route",
                "Relay route ID must be non-zero",
            ));
        }
        self.with_session(|_| {
            let connector = self
                .relay_connector
                .lock()
                .map_err(|_| state_unavailable("Relay connector"))?;
            if connector.is_none() {
                return Err(error(
                    "relay.registration_failed",
                    "Relay connector is not registered",
                ));
            }
            drop(connector);
            let mut routes = self
                .relay_routes
                .lock()
                .map_err(|_| state_unavailable("Relay route registrations"))?;
            if routes.iter().any(|route| route.bus_id == bus_id) {
                return Err(error(
                    "session.invalid_endpoint",
                    "AudioBus IDs must be unique within one Relay publisher",
                ));
            }
            routes.push(RelayRouteRegistration {
                bus_id,
                key: RelayPublishReceiptKey {
                    endpoint_id: endpoint.handle.id(),
                    route_id: pocketstation::RouteId::new(route_id),
                },
            });
            Ok(())
        })
    }

    #[napi]
    pub fn operator(&self, operator: &NativeOperator) -> Result<NativeOperatorInstance> {
        self.with_session(|session| {
            session
                .operator(operator.value.clone())
                .map(|handle| NativeOperatorInstance {
                    session_id: self.session_id,
                    handle,
                })
                .map_err(|failure| error("session.invalid_operator", failure.to_string()))
        })
    }

    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub fn register_operator(
        &self,
        operator_id: String,
        revision: u32,
        generation: u32,
        inputs: Vec<ClassInstance<'_, NativePortSpec>>,
        outputs: Vec<ClassInstance<'_, NativePortSpec>>,
        queue_capacity: String,
        process_timeout_ms: u32,
        network_allowed: bool,
        filesystem_allowed: bool,
        drain_queued: bool,
        continue_on_failure: bool,
        terminal_roles: Vec<String>,
        dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
        deadline_ms: Option<u32>,
        input_delivery: Option<&NativeDeliveryPolicy>,
    ) -> Result<()> {
        let inputs = inputs
            .iter()
            .map(|input| input.as_ref().value.clone())
            .collect();
        let outputs = outputs
            .iter()
            .map(|output| output.as_ref().value.clone())
            .collect();
        self.with_session(|session| {
            crate::provider::register_operator(
                session,
                operator_id,
                revision,
                generation,
                inputs,
                outputs,
                queue_capacity,
                process_timeout_ms,
                network_allowed,
                filesystem_allowed,
                drain_queued,
                continue_on_failure,
                terminal_roles,
                dispatch,
                deadline_ms,
                input_delivery.map(|delivery| delivery.value),
            )
        })
    }

    #[napi]
    pub fn register_endpoint(
        &self,
        operator_id: String,
        node_type_id: String,
        inputs: Vec<ClassInstance<'_, NativePortSpec>>,
        dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
        deadline_ms: Option<u32>,
        maximum_batch_items: Option<u32>,
    ) -> Result<()> {
        let inputs = inputs
            .iter()
            .map(|input| input.as_ref().value.clone())
            .collect();
        self.with_session(|session| {
            crate::provider::register_endpoint(
                session,
                operator_id,
                node_type_id,
                inputs,
                dispatch,
                deadline_ms,
                maximum_batch_items,
            )
        })
    }

    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub fn register_connector(
        &self,
        manifest: NativeConnectorManifest,
        inputs: Vec<ClassInstance<'_, NativePortSpec>>,
        dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
        deadline_ms: Option<u32>,
        maximum_batch_items: u32,
        worker: bool,
    ) -> Result<NativeRegisteredConnector> {
        let inputs = inputs
            .iter()
            .map(|input| input.as_ref().value.clone())
            .collect();
        self.with_session(|session| {
            crate::provider::register_connector(
                session,
                manifest,
                inputs,
                dispatch,
                deadline_ms,
                maximum_batch_items,
                worker,
            )
            .map(|registered| NativeRegisteredConnector { registered })
        })
    }

    #[napi]
    pub fn connector_endpoint(
        &self,
        registered: &NativeRegisteredConnector,
        configuration: Vec<NativeConfigurationEntry>,
        route: &NativeRouteSettings,
    ) -> Result<NativeEndpoint> {
        self.with_session(|session| {
            let configuration = crate::provider::connector_configuration(
                configuration,
                registered.registered.manifest(),
            )?;
            registered
                .registered
                .declare_with_route_settings(session, configuration, route.value)
                .map(|handle| NativeEndpoint {
                    session_id: self.session_id,
                    handle,
                })
                .map_err(|failure| error("connector.declaration_failed", failure.to_string()))
        })
    }

    #[napi]
    pub fn endpoint(&self, definition: &NativeEndpointDefinition) -> Result<NativeEndpoint> {
        self.with_session(|session| {
            session
                .endpoint(definition.value.clone())
                .map(|handle| NativeEndpoint {
                    session_id: self.session_id,
                    handle,
                })
                .map_err(|failure| error("session.invalid_endpoint", failure.to_string()))
        })
    }

    #[napi]
    pub fn source(
        &self,
        source_type: String,
        configuration: Vec<NativeConfigurationEntry>,
    ) -> Result<NativeSourceInstance> {
        let source_type = source_type_id(source_type)?;
        let configuration = source_configuration(configuration)?;
        self.with_session(|session| {
            session
                .source(source_type, configuration)
                .map(|handle| NativeSourceInstance {
                    session_id: self.session_id,
                    handle,
                })
                .map_err(|failure| error("session.invalid_source", failure.to_string()))
        })
    }

    #[napi]
    pub fn register_source(
        &self,
        manifest: &crate::provider::NativeSourceManifest,
        dispatch: Function<'_, NativeProviderCall, Promise<NativeProviderResult>>,
        deadline_ms: Option<u32>,
    ) -> Result<()> {
        self.with_session(|session| {
            crate::provider::register_source(session, manifest.value.clone(), dispatch, deadline_ms)
        })
    }

    #[napi]
    pub fn register_sidecar(&self, spec: NativeSidecarProcessSpec) -> Result<String> {
        let spec = spec.to_core()?;
        let id = spec.id;
        self.with_session(|session| {
            session.register_sidecar(spec).map_err(|failure| {
                error("sidecar.registration_unavailable", failure.to_string())
            })?;
            Ok(id.to_string())
        })
    }

    #[napi]
    pub fn load_native_extension_library(
        &self,
        path: String,
    ) -> Result<AsyncTask<LoadNativeExtensionTask>> {
        let path = require_absolute_library_path(&path)?;
        {
            let guard = self
                .session
                .lock()
                .map_err(|_| state_unavailable("Session"))?;
            if guard.is_none() {
                return Err(error("session.draft_frozen", "Session has already started"));
            }
        }
        Ok(AsyncTask::new(LoadNativeExtensionTask {
            session: Arc::clone(&self.session),
            path,
        }))
    }

    #[napi]
    pub fn subscribe_derived(
        &self,
        stream: &crate::graph::NativeDerivedStream,
        signal: &crate::graph::NativeSignalSpec,
        route_settings: &NativeRouteSettings,
    ) -> Result<NativeBusSubscription> {
        let subscription_id = self.allocate_signal_subscription_id()?;
        self.with_session(|session| {
            subscribe_derived(
                session,
                stream,
                signal,
                route_settings,
                subscription_id,
                &self.signal_receipts,
            )
        })
    }

    #[napi]
    pub fn subscribe_source_output(
        &self,
        stream: &crate::application_audio::NativeSourceOutput,
        signal: &crate::graph::NativeSignalSpec,
        route_settings: &NativeRouteSettings,
    ) -> Result<NativeBusSubscription> {
        let subscription_id = self.allocate_signal_subscription_id()?;
        self.with_session(|session| {
            subscribe_source_output(
                session,
                stream,
                signal,
                route_settings,
                subscription_id,
                &self.signal_receipts,
            )
        })
    }

    #[napi]
    pub async fn start(&self) -> Result<NativeStartResult> {
        let relay = self.prepare_relay()?;
        let session = self
            .session
            .lock()
            .map_err(|_| state_unavailable("Session"))?
            .take()
            .ok_or_else(|| error("session.draft_frozen", "Session has already started"))?;
        let session_id = self.session_id;
        let signal_receipts = Arc::clone(&self.signal_receipts);
        spawn_blocking(move || match session.start() {
            Ok(running) => NativeRunningSession::spawn(running, session_id, signal_receipts, relay)
                .map(|running| NativeStartResult {
                    running: Some(running),
                    failure: None,
                }),
            Err(failure) => Ok(NativeStartResult {
                running: None,
                failure: Some(project_start_failure(&failure)),
            }),
        })
        .await
        .map_err(|failure| {
            error(
                "session.start_worker_failed",
                format!("native Session startup worker failed: {failure}"),
            )
        })?
    }
}

pub struct LoadNativeExtensionTask {
    session: Arc<Mutex<Option<pocketstation::Session>>>,
    path: std::path::PathBuf,
}

impl Task for LoadNativeExtensionTask {
    type Output = NativeExtensionLibrary;
    type JsValue = NativeExtensionLibrary;

    fn compute(&mut self) -> Result<Self::Output> {
        let guard = self
            .session
            .lock()
            .map_err(|_| state_unavailable("Session"))?;
        let session = guard
            .as_ref()
            .ok_or_else(|| error("session.draft_frozen", "Session has already started"))?;
        // SAFETY: this API explicitly loads trusted native code from an exact
        // absolute path. Core validates every mechanically checkable ABI rule.
        unsafe { session.load_native_extension_library(&self.path) }
            .map(Into::into)
            .map_err(native_extension_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[cfg(feature = "conformance-fixtures")]
#[napi]
impl NativeSession {
    #[napi(factory)]
    pub fn conformance(saturation: Option<bool>) -> Result<Self> {
        let session = if saturation.unwrap_or(false) {
            pocketstation::conformance::session_for_saturation()
        } else {
            pocketstation::conformance::session()
        }
        .map_err(|failure| error("session.conformance_unavailable", failure.to_string()))?;
        crate::graph::register_conformance_operators(&session)?;
        let session_id = session.id().get();
        Ok(Self {
            session: Arc::new(Mutex::new(Some(session))),
            session_id,
            signal_receipts: new_signal_receipts(),
            next_signal_subscription_id: AtomicU64::new(0),
            relay_connector: Mutex::new(None),
            relay_registered: Mutex::new(None),
            relay_routes: Mutex::new(Vec::new()),
        })
    }
}

impl NativeSession {
    fn prepare_relay(&self) -> Result<Option<RelayRuntime>> {
        let connector = self
            .relay_connector
            .lock()
            .map_err(|_| state_unavailable("Relay connector"))?
            .clone();
        let routes = std::mem::take(
            &mut *self
                .relay_routes
                .lock()
                .map_err(|_| state_unavailable("Relay route registrations"))?,
        );
        let Some(connector) = connector else {
            if routes.is_empty() {
                return Ok(None);
            }
            return Err(state_unavailable("Relay connector"));
        };
        if routes.is_empty() {
            return Err(error(
                "session.invalid_endpoint",
                "Relay publisher requires at least one published AudioBus",
            ));
        }
        Ok(Some(RelayRuntime { connector, routes }))
    }

    fn allocate_signal_subscription_id(&self) -> Result<u64> {
        self.next_signal_subscription_id
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .map(|previous| previous + 1)
            .map_err(|_| {
                error(
                    "session.capacity_exhausted",
                    "signal subscription ID space is exhausted",
                )
            })
    }

    fn with_session<T>(
        &self,
        operation: impl FnOnce(&pocketstation::Session) -> Result<T>,
    ) -> Result<T> {
        let guard = self
            .session
            .lock()
            .map_err(|_| state_unavailable("Session"))?;
        let session = guard
            .as_ref()
            .ok_or_else(|| error("session.draft_frozen", "Session has already started"))?;
        operation(session)
    }
}

fn project_start_failure(failure: &pocketstation::SessionStartError) -> NativeStartFailure {
    NativeStartFailure {
        code: failure.code().as_str().to_owned(),
        message: failure.message().to_owned(),
        diagnostic: failure
            .compile_diagnostic()
            .map(|diagnostic| NativeCompileDiagnostic {
                code: diagnostic.code().to_owned(),
                node_index: diagnostic.node_index(),
                edge_index: diagnostic.edge_index(),
                operator_id: diagnostic.operator_id().map(str::to_owned),
                operator_instance_id: diagnostic
                    .operator_instance_id()
                    .map(|value| value.to_string()),
                node_type_id: diagnostic.node_type_id().map(str::to_owned),
                source_type_id: diagnostic.source_type_id().map(str::to_owned),
                port_name: diagnostic.port_name().map(str::to_owned),
                direction: diagnostic.direction().map(str::to_owned),
                expected: diagnostic.expected().map(str::to_owned),
                actual: diagnostic.actual().map(str::to_owned),
            }),
    }
}

enum SessionCommand {
    ReplaceMicrophone {
        stem_id: pocketstation::StemId,
        selector: pocketstation::DeviceSelector,
        reopen: bool,
        response: oneshot::Sender<Result<NativeSourceReplacement>>,
    },
    ReadAudio {
        timeout: Duration,
        response: oneshot::Sender<Result<NativeAudioRead>>,
    },
    ReadEvent {
        timeout: Duration,
        response: oneshot::Sender<Result<NativeEventRead>>,
    },
    SignalMetrics {
        route_id: u64,
        response: oneshot::Sender<std::result::Result<NativeSignalMetrics, String>>,
    },
    SessionMetrics {
        response: oneshot::Sender<std::result::Result<NativeSessionMetrics, String>>,
    },
    LifecycleState {
        response: oneshot::Sender<String>,
    },
    SendSidecar {
        sidecar_id: u64,
        message: pocketstation::SidecarMessage,
        response: oneshot::Sender<std::result::Result<(), String>>,
    },
    ReadSidecar {
        sidecar_id: u64,
        timeout: Option<Duration>,
        response: oneshot::Sender<std::result::Result<crate::sidecar::SidecarRead, String>>,
    },
    SidecarSnapshot {
        sidecar_id: u64,
        response:
            oneshot::Sender<std::result::Result<pocketstation::SessionSidecarMetrics, String>>,
    },
    Stop {
        response: oneshot::Sender<NativeStopResult>,
    },
    Cancel {
        response: oneshot::Sender<NativeStopResult>,
    },
    Shutdown,
}

fn command_send_error(failure: std::sync::mpsc::TrySendError<SessionCommand>) -> napi::Error {
    match failure {
        std::sync::mpsc::TrySendError::Full(_) => error(
            "session.command_queue_full",
            "native Session command queue is full",
        ),
        std::sync::mpsc::TrySendError::Disconnected(_) => {
            error("session.stopped", "native Session worker has stopped")
        }
    }
}

fn replacement_command_send_error(
    failure: std::sync::mpsc::TrySendError<SessionCommand>,
) -> napi::Error {
    match failure {
        std::sync::mpsc::TrySendError::Full(_) => error(
            "source.replacement_queue_full",
            "Session replacement control queue is full",
        ),
        std::sync::mpsc::TrySendError::Disconnected(_) => error(
            "source.runtime_stopped",
            "Session runtime stopped before source replacement completed",
        ),
    }
}

fn replacement_response_error(_: oneshot::Canceled) -> napi::Error {
    error(
        "source.runtime_stopped",
        "Session runtime stopped before source replacement completed",
    )
}

struct SessionWorker {
    commands: SyncSender<SessionCommand>,
    join: Option<JoinHandle<()>>,
}

struct AudioWorkerEnd(Arc<AtomicBool>);

fn discarded_audio_read() -> NativeAudioRead {
    NativeAudioRead {
        frames: Vec::new(),
        session_state: "stopped".to_owned(),
    }
}

impl Drop for AudioWorkerEnd {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

#[napi(js_name = "NativeRunningSession")]
pub struct NativeRunningSession {
    worker: Mutex<Option<SessionWorker>>,
    audio_receipt: Mutex<Option<pocketstation::PolledAudioReceipt>>,
    audio_terminal: Arc<AtomicBool>,
    session_id: u64,
    signal_receipts: SignalReceipts,
}

#[napi]
impl NativeRunningSession {
    #[napi]
    pub async fn replace_microphone_source(
        &self,
        stem_id: String,
        source: &NativeSource,
    ) -> Result<NativeSourceReplacement> {
        self.change_microphone_source(stem_id, source, false).await
    }

    #[napi]
    pub async fn reopen_microphone_source(
        &self,
        stem_id: String,
        source: &NativeSource,
    ) -> Result<NativeSourceReplacement> {
        self.change_microphone_source(stem_id, source, true).await
    }

    async fn change_microphone_source(
        &self,
        stem_id: String,
        source: &NativeSource,
        reopen: bool,
    ) -> Result<NativeSourceReplacement> {
        let stem_id = stem_id
            .parse::<u64>()
            .map(pocketstation::StemId::new)
            .map_err(|_| error("session.invalid_stem", "stemId must be an unsigned integer"))?;
        let pocketstation::Source::Microphone(selector) = &source.declaration else {
            return Err(error(
                "source.not_microphone",
                "replacement Source must select a microphone",
            ));
        };
        let (response, receiver) = oneshot::channel();
        self.commands()
            .map_err(|_| {
                error(
                    "source.session_not_running",
                    "source replacement requires a running Session",
                )
            })?
            .try_send(SessionCommand::ReplaceMicrophone {
                stem_id,
                selector: selector.clone(),
                reopen,
                response,
            })
            .map_err(replacement_command_send_error)?;
        receiver.await.map_err(replacement_response_error)?
    }

    #[napi(getter)]
    pub fn session_id(&self) -> String {
        self.session_id.to_string()
    }

    #[napi]
    pub fn discard_audio(&self) -> Result<()> {
        self.audio_receipt
            .lock()
            .map_err(|_| state_unavailable("Session audio receipt"))?
            .take();
        Ok(())
    }

    #[napi]
    pub fn discard_signals(&self) -> Result<()> {
        close_signals(&self.signal_receipts)
    }

    #[napi]
    pub async fn read_audio(&self, timeout_ms: u32) -> Result<NativeAudioRead> {
        if timeout_ms > MAXIMUM_AUDIO_WAIT_MS {
            return Err(error(
                "stream.invalid_timeout",
                "timeoutMs must be between 0 and 1000",
            ));
        }
        if self.retained_audio_receipt()?.is_none() {
            return Ok(discarded_audio_read());
        }
        let (response, receiver) = oneshot::channel();
        // Serialize enqueue with take_worker: no read may be queued after Stop.
        let queued = {
            let worker = self
                .worker
                .lock()
                .map_err(|_| state_unavailable("running Session"))?;
            if let Some(worker) = worker.as_ref() {
                worker
                    .commands
                    .try_send(SessionCommand::ReadAudio {
                        timeout: Duration::from_millis(u64::from(timeout_ms)),
                        response,
                    })
                    .map_err(command_send_error)?;
                true
            } else {
                false
            }
        };
        if !queued {
            return self.read_retained_audio(timeout_ms).await;
        }
        let result = receiver.await.map_err(|_| {
            error(
                "session.worker_stopped",
                "native Session worker did not return audio",
            )
        })??;
        if self.retained_audio_receipt()?.is_none() {
            return Ok(discarded_audio_read());
        }
        Ok(result)
    }

    #[napi]
    pub fn monotonic_timestamp_ns(&self) -> String {
        pocketstation::timing::monotonic_timestamp_ns().to_string()
    }

    #[napi]
    pub async fn read_event(&self, timeout_ms: u32) -> Result<NativeEventRead> {
        if timeout_ms > MAXIMUM_AUDIO_WAIT_MS {
            return Err(error(
                "stream.invalid_timeout",
                "timeoutMs must be between 0 and 1000",
            ));
        }
        let (response, receiver) = oneshot::channel();
        self.commands()?
            .try_send(SessionCommand::ReadEvent {
                timeout: Duration::from_millis(u64::from(timeout_ms)),
                response,
            })
            .map_err(command_send_error)?;
        receiver.await.map_err(|_| {
            error(
                "session.worker_stopped",
                "native Session worker did not return an event",
            )
        })?
    }

    #[napi]
    pub async fn read_signal(
        &self,
        subscription: &NativeBusSubscription,
        timeout_ms: u32,
    ) -> Result<NativeSignalRead> {
        read_signal(
            &self.signal_receipts,
            self.session_id,
            subscription,
            timeout_ms,
        )
        .await
    }

    #[napi]
    pub fn close_signal(&self, subscription: &NativeBusSubscription) -> Result<()> {
        close_signal(&self.signal_receipts, self.session_id, subscription)
    }

    #[napi]
    pub async fn signal_metrics(
        &self,
        subscription: &NativeBusSubscription,
    ) -> Result<NativeSignalMetrics> {
        validate_subscription(&self.signal_receipts, self.session_id, subscription)?;
        let (response, receiver) = oneshot::channel();
        self.commands()?
            .try_send(SessionCommand::SignalMetrics {
                route_id: subscription.route_id,
                response,
            })
            .map_err(command_send_error)?;
        receiver
            .await
            .map_err(|_| {
                error(
                    "session.worker_stopped",
                    "native Session worker did not return signal metrics",
                )
            })?
            .map_err(|failure| error("stream.metrics_unavailable", failure))
    }

    #[napi]
    pub async fn metrics(&self) -> Result<NativeSessionMetrics> {
        let (response, receiver) = oneshot::channel();
        self.commands()?
            .try_send(SessionCommand::SessionMetrics { response })
            .map_err(command_send_error)?;
        receiver
            .await
            .map_err(|_| {
                error(
                    "session.worker_stopped",
                    "native Session worker did not return Session metrics",
                )
            })?
            .map_err(|failure| error("session.metrics_unavailable", failure))
    }

    #[napi]
    pub async fn send_sidecar(
        &self,
        sidecar_id: String,
        message: NativeSidecarMessage,
    ) -> Result<()> {
        let (response, receiver) = oneshot::channel();
        self.commands()?
            .try_send(SessionCommand::SendSidecar {
                sidecar_id: parse_sidecar_id(&sidecar_id)?,
                message: message.to_core()?,
                response,
            })
            .map_err(command_send_error)?;
        receiver
            .await
            .map_err(|_| {
                error(
                    "session.worker_stopped",
                    "native Session worker did not send the sidecar message",
                )
            })?
            .map_err(sidecar_error)
    }

    #[napi]
    pub async fn read_sidecar(
        &self,
        sidecar_id: String,
        timeout_ms: u32,
    ) -> Result<NativeSidecarRead> {
        if timeout_ms > MAXIMUM_WAIT_MS {
            return Err(error(
                "sidecar.invalid_timeout",
                "timeoutMs must be between 0 and 1000",
            ));
        }
        let (response, receiver) = oneshot::channel();
        self.commands()?
            .try_send(SessionCommand::ReadSidecar {
                sidecar_id: parse_sidecar_id(&sidecar_id)?,
                timeout: (timeout_ms > 0).then(|| Duration::from_millis(u64::from(timeout_ms))),
                response,
            })
            .map_err(command_send_error)?;
        receiver
            .await
            .map_err(|_| {
                error(
                    "session.worker_stopped",
                    "native Session worker did not return a sidecar message",
                )
            })?
            .map(NativeSidecarRead::from)
            .map_err(sidecar_error)
    }

    #[napi]
    pub async fn sidecar_snapshot(&self, sidecar_id: String) -> Result<NativeSidecarSnapshot> {
        let (response, receiver) = oneshot::channel();
        self.commands()?
            .try_send(SessionCommand::SidecarSnapshot {
                sidecar_id: parse_sidecar_id(&sidecar_id)?,
                response,
            })
            .map_err(command_send_error)?;
        receiver
            .await
            .map_err(|_| {
                error(
                    "session.worker_stopped",
                    "native Session worker did not return sidecar observations",
                )
            })?
            .map(NativeSidecarSnapshot::from)
            .map_err(sidecar_error)
    }

    #[napi]
    pub async fn lifecycle_state(&self) -> Result<String> {
        let (response, receiver) = oneshot::channel();
        self.commands()?
            .try_send(SessionCommand::LifecycleState { response })
            .map_err(command_send_error)?;
        receiver.await.map_err(|_| {
            error(
                "session.worker_stopped",
                "native Session worker did not return its lifecycle state",
            )
        })
    }

    #[napi]
    pub async fn stop(&self) -> Result<NativeStopResult> {
        self.finish(FinishDisposition::Stop).await
    }

    #[napi]
    pub async fn cancel(&self) -> Result<NativeStopResult> {
        self.discard_signals()?;
        self.finish(FinishDisposition::Cancel).await
    }
}

impl NativeRunningSession {
    fn spawn(
        running: pocketstation::RunningSession,
        session_id: u64,
        signal_receipts: SignalReceipts,
        relay: Option<RelayRuntime>,
    ) -> Result<Self> {
        let (commands, receiver) = sync_channel(COMMAND_CAPACITY_COUNT);
        let audio_receipt = running.audio_receipt();
        let audio_terminal = Arc::new(AtomicBool::new(false));
        let worker_terminal = Arc::clone(&audio_terminal);
        let join = thread::Builder::new()
            .name("pocketstation-js-session".to_owned())
            .spawn(move || {
                let _terminal = AudioWorkerEnd(worker_terminal);
                session_worker(running, receiver, relay);
            })
            .map_err(|failure| {
                error(
                    "session.worker_start_failed",
                    format!("failed to start native Session worker: {failure}"),
                )
            })?;
        Ok(Self {
            worker: Mutex::new(Some(SessionWorker {
                commands,
                join: Some(join),
            })),
            audio_receipt: Mutex::new(Some(audio_receipt)),
            audio_terminal,
            session_id,
            signal_receipts,
        })
    }

    fn retained_audio_receipt(&self) -> Result<Option<pocketstation::PolledAudioReceipt>> {
        self.audio_receipt
            .lock()
            .map_err(|_| state_unavailable("Session audio receipt"))
            .map(|receipt| receipt.clone())
    }

    async fn read_retained_audio(&self, timeout_ms: u32) -> Result<NativeAudioRead> {
        let Some(receipt) = self.retained_audio_receipt()? else {
            return Ok(discarded_audio_read());
        };
        let deadline = Instant::now() + Duration::from_millis(u64::from(timeout_ms));
        loop {
            // Observe producer completion before polling. Otherwise final frames
            // could arrive between an empty poll and a terminal load, causing EOF.
            let terminal = self.audio_terminal.load(Ordering::Acquire);
            let frames = copy_retained_audio(&receipt)
                .map_err(|failure| error("stream.read_failed", failure))?;
            if self.retained_audio_receipt()?.is_none() {
                return Ok(discarded_audio_read());
            }
            if !frames.is_empty() || terminal || Instant::now() >= deadline {
                return Ok(NativeAudioRead {
                    frames,
                    session_state: if terminal { "stopped" } else { "stopping" }.to_owned(),
                });
            }
            futures_timer::Delay::new(
                Duration::from_millis(1).min(deadline.saturating_duration_since(Instant::now())),
            )
            .await;
        }
    }

    fn commands(&self) -> Result<SyncSender<SessionCommand>> {
        self.worker
            .lock()
            .map_err(|_| state_unavailable("running Session"))?
            .as_ref()
            .map(|worker| worker.commands.clone())
            .ok_or_else(|| error("session.stopped", "Session has stopped"))
    }

    fn take_worker(&self) -> Result<SessionWorker> {
        self.worker
            .lock()
            .map_err(|_| state_unavailable("running Session"))?
            .take()
            .ok_or_else(|| error("session.stopped", "Session has stopped"))
    }

    fn restore_worker(&self, worker: SessionWorker) -> Result<()> {
        let mut slot = self
            .worker
            .lock()
            .map_err(|_| state_unavailable("running Session"))?;
        if slot.is_some() {
            return Err(state_unavailable("running Session"));
        }
        *slot = Some(worker);
        Ok(())
    }

    async fn finish(&self, disposition: FinishDisposition) -> Result<NativeStopResult> {
        let mut worker = self.take_worker()?;
        let (response, receiver) = oneshot::channel();
        let command = match disposition {
            FinishDisposition::Stop => SessionCommand::Stop { response },
            FinishDisposition::Cancel => SessionCommand::Cancel { response },
        };
        match worker.commands.try_send(command) {
            Ok(()) => {}
            Err(std::sync::mpsc::TrySendError::Full(_)) => {
                self.restore_worker(worker)?;
                return Err(error(
                    "session.command_queue_full",
                    "native Session command queue is full; retry shutdown",
                ));
            }
            Err(std::sync::mpsc::TrySendError::Disconnected(_)) => {
                return Err(error(
                    "session.stopped",
                    "native Session worker has stopped",
                ));
            }
        }
        let result = receiver.await;
        if let Some(join) = worker.join.take() {
            spawn_blocking(move || join.join())
                .await
                .map_err(|failure| {
                    error(
                        "session.worker_join_failed",
                        format!("failed to join native Session worker: {failure}"),
                    )
                })?
                .map_err(|_| {
                    error(
                        "session.worker_panicked",
                        "native Session worker panicked during shutdown",
                    )
                })?;
        }
        result.map_err(|_| {
            error(
                "session.worker_stopped",
                "native Session worker did not return a final result",
            )
        })
    }
}

impl Drop for NativeRunningSession {
    fn drop(&mut self) {
        let Ok(worker) = self.worker.get_mut() else {
            return;
        };
        let Some(worker) = worker.take() else {
            return;
        };
        let _ = worker.commands.try_send(SessionCommand::Shutdown);
        drop(worker);
    }
}

#[derive(Clone, Copy)]
enum FinishDisposition {
    Stop,
    Cancel,
}

fn session_worker(
    mut running: pocketstation::RunningSession,
    receiver: Receiver<SessionCommand>,
    relay: Option<RelayRuntime>,
) {
    while let Ok(command) = receiver.recv() {
        match command {
            SessionCommand::ReplaceMicrophone {
                stem_id,
                selector,
                reopen,
                response,
            } => {
                let result = if reopen {
                    running.reopen_microphone_source(stem_id, selector)
                } else {
                    running.replace_microphone_source(stem_id, selector)
                };
                let _ = response.send(result.map(replacement_result).map_err(replacement_error));
            }
            SessionCommand::ReadAudio { timeout, response } => {
                let frames = copy_audio(&running, timeout)
                    .map(|frames| NativeAudioRead {
                        frames,
                        session_state: lifecycle_state_name(running.state()).to_owned(),
                    })
                    .map_err(|failure| error("stream.read_failed", failure));
                let _ = response.send(frames);
            }
            SessionCommand::ReadEvent { timeout, response } => {
                let event = read_event(&running, timeout).map(|event| NativeEventRead {
                    event,
                    session_state: lifecycle_state_name(running.state()).to_owned(),
                });
                let _ = response.send(event);
            }
            SessionCommand::SignalMetrics { route_id, response } => {
                let _ = response.send(copy_signal_metrics(&running, route_id));
            }
            SessionCommand::SessionMetrics { response } => {
                let _ = response.send(copy_metrics(&running));
            }
            SessionCommand::LifecycleState { response } => {
                let _ = response.send(lifecycle_state_name(running.state()).to_owned());
            }
            SessionCommand::SendSidecar {
                sidecar_id,
                message,
                response,
            } => {
                let _ = response.send(
                    running
                        .try_send_sidecar_signal(sidecar_id, message)
                        .map_err(sidecar_error_reason),
                );
            }
            SessionCommand::ReadSidecar {
                sidecar_id,
                timeout,
                response,
            } => {
                let result = match timeout {
                    Some(timeout) => wait_sidecar(&running, sidecar_id, timeout),
                    None => poll_sidecar(&running, sidecar_id),
                };
                let _ = response.send(result);
            }
            SessionCommand::SidecarSnapshot {
                sidecar_id,
                response,
            } => {
                let _ = response.send(sidecar_snapshot(&running, sidecar_id));
            }
            SessionCommand::Stop { response } => {
                let stop = running.stop();
                let remaining_events = drain_events(&running);
                let _ = response.send(stop_result(
                    &running,
                    relay.as_ref(),
                    stop.is_success(),
                    matches!(
                        stop.disposition(),
                        pocketstation::SessionStopDisposition::AlreadyStopped
                    ),
                    "stopped",
                    &stop.outcome(),
                    remaining_events,
                ));
                return;
            }
            SessionCommand::Cancel { response } => {
                let cancel = running.cancel();
                let remaining_events = drain_events(&running);
                let _ = response.send(stop_result(
                    &running,
                    relay.as_ref(),
                    cancel.is_success(),
                    matches!(
                        cancel.disposition(),
                        pocketstation::SessionCancelDisposition::AlreadyStopped
                    ),
                    "cancelled",
                    &cancel.outcome(),
                    remaining_events,
                ));
                return;
            }
            SessionCommand::Shutdown => {
                let _ = running.stop();
                return;
            }
        }
    }
    let _ = running.stop();
}

fn read_event(
    running: &pocketstation::RunningSession,
    timeout: Duration,
) -> Result<Option<NativeSessionEvent>> {
    let deadline = Instant::now() + timeout;
    loop {
        match running.try_recv_event() {
            pocketstation::SessionEventReceive::Event(event) => {
                return Ok(Some(project_session_event(&event)))
            }
            pocketstation::SessionEventReceive::Closed => return Ok(None),
            pocketstation::SessionEventReceive::Empty if Instant::now() >= deadline => {
                return Ok(None)
            }
            pocketstation::SessionEventReceive::Empty => {
                thread::sleep(Duration::from_millis(1));
            }
        }
    }
}

fn drain_events(running: &pocketstation::RunningSession) -> Vec<NativeSessionEvent> {
    let mut events = Vec::new();
    while let pocketstation::SessionEventReceive::Event(event) = running.try_recv_event() {
        events.push(project_session_event(&event));
    }
    events
}

fn empty_event(event_type: &str, session_id: u64) -> NativeSessionEvent {
    NativeSessionEvent {
        event_type: event_type.to_owned(),
        session_id: session_id.to_string(),
        session_state: None,
        source_event_kind: None,
        stem_id: None,
        source_platform: None,
        source_kind: None,
        source_stable_key: None,
        source_id: None,
        source_generation: None,
        source_recovery_requirement: None,
        source_failure_operation: None,
        source_failure_class: None,
        source_platform_status_code: None,
        source_backend_class: None,
        route_id: None,
        endpoint_id: None,
        failure_stage: None,
        failure_message: None,
        failure_code: None,
        failure_retryability: None,
        component_kind: None,
        component_id: None,
        failure_operation: None,
        failure_error_class: None,
        source_failures_total: None,
        endpoint_failures_total: None,
        rollback_failures_total: None,
        finalization_failures_total: None,
        source_failures: None,
        endpoint_failures: None,
        rollback_failures: None,
        finalization_failures: None,
    }
}

fn project_session_event(event: &pocketstation::SessionEvent) -> NativeSessionEvent {
    let session_id = event.session_id().get();
    match event.kind() {
        pocketstation::SessionEventKind::Lifecycle(state) => {
            let mut result = empty_event("lifecycle", session_id);
            result.session_state = Some(lifecycle_state_name(*state).to_owned());
            result
        }
        pocketstation::SessionEventKind::Source(failure) => {
            let failure = native_source_failure(failure.stem_id().get(), failure.event());
            let mut result = empty_event("source-failure", session_id);
            result.source_event_kind = Some(failure.source_event_kind);
            result.stem_id = Some(failure.stem_id);
            result.source_platform = Some(failure.source_platform);
            result.source_kind = Some(failure.source_kind);
            result.source_stable_key = Some(failure.source_stable_key);
            result.source_id = Some(failure.source_id);
            result.source_generation = Some(failure.source_generation);
            result.source_recovery_requirement = failure.source_recovery_requirement;
            result.source_failure_operation = Some(failure.source_failure_operation);
            result.source_failure_class = Some(failure.source_failure_class);
            result.source_platform_status_code = failure.source_platform_status_code;
            result.source_backend_class = failure.source_backend_class;
            result
        }
        pocketstation::SessionEventKind::Endpoint(failure) => {
            let failure = native_endpoint_failure(
                failure.route_id().get(),
                failure.endpoint_id().get(),
                failure.stage(),
                failure.failure(),
            );
            let mut result = empty_event("endpoint-failure", session_id);
            result.route_id = Some(failure.route_id);
            result.endpoint_id = Some(failure.endpoint_id);
            result.failure_stage = Some(failure.failure_stage);
            result.failure_message = Some(failure.failure_message);
            result.failure_code = failure.failure_code;
            result.failure_retryability = failure.failure_retryability;
            result
        }
        pocketstation::SessionEventKind::Rollback(failure) => {
            let mut result = empty_event("rollback-failure", session_id);
            result.failure_stage = Some(debug_name(failure.stage()));
            project_control_failure(&mut result, failure.failure());
            result
        }
        pocketstation::SessionEventKind::Finalization(failure) => {
            let mut result = empty_event("finalization-failure", session_id);
            result.failure_stage = Some(debug_name(failure.stage()));
            project_control_failure(&mut result, failure.failure());
            result
        }
        pocketstation::SessionEventKind::Terminal(outcome) => {
            let mut result = empty_event("terminal", session_id);
            result.session_state = Some(
                match outcome.state() {
                    pocketstation::SessionTerminalState::Stopped => "stopped",
                    pocketstation::SessionTerminalState::Failed => "failed",
                }
                .to_owned(),
            );
            result.source_failures_total = Some(outcome.source_failures().len().to_string());
            result.endpoint_failures_total = Some(outcome.endpoint_failures().len().to_string());
            result.rollback_failures_total = Some(outcome.rollback_failures().len().to_string());
            result.finalization_failures_total =
                Some(outcome.finalization_failures().len().to_string());
            result.source_failures = Some(
                outcome
                    .source_failures()
                    .iter()
                    .map(|failure| native_source_failure(failure.stem_id().get(), failure.event()))
                    .collect(),
            );
            result.endpoint_failures = Some(
                outcome
                    .endpoint_failures()
                    .iter()
                    .map(|failure| {
                        native_endpoint_failure(
                            failure.route_id().get(),
                            failure.endpoint_id().get(),
                            failure.stage(),
                            failure.failure(),
                        )
                    })
                    .collect(),
            );
            result.rollback_failures = Some(
                outcome
                    .rollback_failures()
                    .iter()
                    .map(|failure| NativeControlFailure {
                        failure_stage: debug_name(failure.stage()),
                        ..native_control_failure(failure.failure())
                    })
                    .collect(),
            );
            result.finalization_failures = Some(
                outcome
                    .finalization_failures()
                    .iter()
                    .map(|failure| NativeControlFailure {
                        failure_stage: debug_name(failure.stage()),
                        ..native_control_failure(failure.failure())
                    })
                    .collect(),
            );
            result
        }
    }
}

fn native_source_failure(
    stem_id: u64,
    event: &pocketstation::SourceRuntimeEvent,
) -> NativeSourceFailure {
    let (event_kind, stable_id, generation, recovery, runtime_failure) = match event {
        pocketstation::SourceRuntimeEvent::SourceUnavailable {
            stable_id,
            generation,
            recovery_requirement,
            failure,
        } => (
            "source-unavailable",
            stable_id,
            generation.0,
            Some(match recovery_requirement {
                pocketstation::SourceRecoveryRequirement::ExplicitRediscoveryAndNewSession => {
                    "explicit-rediscovery-and-new-session"
                }
            }),
            failure,
        ),
        pocketstation::SourceRuntimeEvent::BackendFailure {
            stable_id,
            generation,
            failure,
        } => ("backend-failure", stable_id, generation.0, None, failure),
    };
    let (failure_class, status_code, backend_class) = match &runtime_failure.error_class {
        pocketstation::CaptureRuntimeFailureClass::SourceInstanceExited => {
            ("source-instance-exited", None, None)
        }
        pocketstation::CaptureRuntimeFailureClass::PlatformStatus { status_code } => {
            ("platform-status", Some(*status_code), None)
        }
        pocketstation::CaptureRuntimeFailureClass::BackendClass { class } => {
            ("backend-class", None, Some(class.clone()))
        }
    };
    NativeSourceFailure {
        source_event_kind: event_kind.to_owned(),
        stem_id: stem_id.to_string(),
        source_platform: platform_name(stable_id.platform).to_owned(),
        source_kind: source_kind_name(stable_id.kind).to_owned(),
        source_stable_key: stable_id.stable_key.clone(),
        source_id: stable_id.source_id().get().to_string(),
        source_generation: generation,
        source_recovery_requirement: recovery.map(str::to_owned),
        source_failure_operation: runtime_failure.operation.to_owned(),
        source_failure_class: failure_class.to_owned(),
        source_platform_status_code: status_code,
        source_backend_class: backend_class,
    }
}

fn native_endpoint_failure(
    route_id: u64,
    endpoint_id: u64,
    stage: pocketstation::EndpointFailureStage,
    failure: &pocketstation::EndpointFailure,
) -> NativeEndpointFailure {
    NativeEndpointFailure {
        route_id: route_id.to_string(),
        endpoint_id: endpoint_id.to_string(),
        failure_stage: endpoint_stage_name(stage).to_owned(),
        failure_message: failure.message().to_owned(),
        failure_code: failure.code().map(str::to_owned),
        failure_retryability: failure
            .retryability()
            .map(endpoint_retryability_name)
            .map(str::to_owned),
    }
}

fn native_control_failure(failure: &pocketstation::SessionControlFailure) -> NativeControlFailure {
    let (component_kind, component_id) = control_failure_component(failure.component());
    NativeControlFailure {
        failure_stage: String::new(),
        component_kind: component_kind.to_owned(),
        component_id,
        failure_operation: failure.operation().to_owned(),
        failure_error_class: failure.error_class().to_owned(),
    }
}

fn project_control_failure(
    result: &mut NativeSessionEvent,
    failure: &pocketstation::SessionControlFailure,
) {
    let (kind, id) = control_failure_component(failure.component());
    result.component_kind = Some(kind.to_owned());
    result.component_id = Some(id);
    result.failure_operation = Some(failure.operation().to_owned());
    result.failure_error_class = Some(failure.error_class().to_owned());
}

fn control_failure_component(
    component: pocketstation::SessionComponentId,
) -> (&'static str, String) {
    match component {
        pocketstation::SessionComponentId::Source { stem_id } => {
            ("source", stem_id.get().to_string())
        }
        pocketstation::SessionComponentId::Endpoint {
            route_id,
            endpoint_id,
        } => (
            "endpoint",
            format!("{}:{}", route_id.get(), endpoint_id.get()),
        ),
        pocketstation::SessionComponentId::Operator {
            operator_instance_id,
        } => ("operator", operator_instance_id.value().to_string()),
        pocketstation::SessionComponentId::Sidecar { sidecar_id } => {
            ("sidecar", sidecar_id.to_string())
        }
        pocketstation::SessionComponentId::Runtime => ("runtime", "0".to_owned()),
    }
}

const fn endpoint_stage_name(stage: pocketstation::EndpointFailureStage) -> &'static str {
    match stage {
        pocketstation::EndpointFailureStage::Prepare => "prepare",
        pocketstation::EndpointFailureStage::CancelPreparation => "cancel-preparation",
        pocketstation::EndpointFailureStage::Start => "start",
        pocketstation::EndpointFailureStage::RequestStop => "request-stop",
        pocketstation::EndpointFailureStage::JoinFinalize => "join-finalize",
    }
}

const fn endpoint_retryability_name(
    value: pocketstation::EndpointFailureRetryability,
) -> &'static str {
    match value {
        pocketstation::EndpointFailureRetryability::Never => "never",
        pocketstation::EndpointFailureRetryability::Retryable => "retryable",
        pocketstation::EndpointFailureRetryability::ReconfigurationRequired => {
            "reconfiguration-required"
        }
    }
}

fn debug_name(value: impl std::fmt::Debug) -> String {
    let mut output = String::new();
    for (index, character) in format!("{value:?}").chars().enumerate() {
        if character.is_ascii_uppercase() && index > 0 {
            output.push('-');
        }
        output.push(character.to_ascii_lowercase());
    }
    output
}

fn stop_result(
    running: &pocketstation::RunningSession,
    relay: Option<&RelayRuntime>,
    success: bool,
    already_stopped: bool,
    disposition: &str,
    outcome: &pocketstation::SessionStopOutcome,
    remaining_events: Vec<NativeSessionEvent>,
) -> NativeStopResult {
    let (metrics, metrics_unavailable_reason) = match copy_metrics(running) {
        Ok(metrics) => (Some(metrics), None),
        Err(reason) => (None, Some(reason)),
    };
    let recording = copy_recording_outcome(running);
    let (trace, trace_error) = copy_trace_outcome(running);
    NativeStopResult {
        success,
        already_stopped,
        disposition: if already_stopped {
            "already-stopped".to_owned()
        } else {
            disposition.to_owned()
        },
        session_state: lifecycle_state_name(running.state()).to_owned(),
        runtime_worker_panicked: outcome.runtime_worker_panicked(),
        capture_finalization_failures_total: outcome
            .capture_finalization_failures_total()
            .to_string(),
        operator_finalization_failures_total: outcome
            .operator_finalization_failures_total()
            .to_string(),
        endpoint_finalization_failures_total: outcome
            .endpoint_finalization_failures_total()
            .to_string(),
        runtime_failures_total: outcome.runtime_failures_total().to_string(),
        lineage_failures_total: outcome.lineage_failures_total().to_string(),
        source_send_rejections_total: outcome.source_send_rejections_total().to_string(),
        runtime_events_total: outcome.runtime_events_total().to_string(),
        sidecar_outcomes: running
            .sidecar_metrics()
            .into_vec()
            .into_iter()
            .map(NativeSidecarSnapshot::from)
            .collect(),
        relay_outcomes: relay_outcomes(relay),
        recording,
        trace,
        trace_error,
        metrics,
        metrics_unavailable_reason,
        remaining_events,
    }
}

fn relay_outcomes(relay: Option<&RelayRuntime>) -> Vec<NativeRelayPublishOutcome> {
    let Some(relay) = relay else {
        return Vec::new();
    };
    relay
        .routes
        .iter()
        .map(|route| {
            relay.connector.take_result(route.key).map_or_else(
                || NativeRelayPublishOutcome {
                    bus_id: route.bus_id.clone(),
                    endpoint_id: route.key.endpoint_id.get().to_string(),
                    route_id: route.key.route_id.get().to_string(),
                    frames_received_total: "0".to_owned(),
                    rtp_packets_sent_total: "0".to_owned(),
                    rtp_payload_bytes_sent_total: "0".to_owned(),
                    ingress_queue_drops_total: "0".to_owned(),
                    publisher_stale_drops_total: "0".to_owned(),
                    cancelled_output_frames_total: "0".to_owned(),
                    cancelled_output_samples_total: "0".to_owned(),
                    failures_total: "1".to_owned(),
                    error: Some("Relay publication result is unavailable".to_owned()),
                },
                |result| NativeRelayPublishOutcome {
                    bus_id: route.bus_id.clone(),
                    endpoint_id: route.key.endpoint_id.get().to_string(),
                    route_id: route.key.route_id.get().to_string(),
                    frames_received_total: result
                        .edge_observations
                        .frames_delivered_total
                        .to_string(),
                    rtp_packets_sent_total: result.statistics.rtp_packets_sent_total.to_string(),
                    rtp_payload_bytes_sent_total: result
                        .statistics
                        .rtp_payload_bytes_sent_total
                        .to_string(),
                    ingress_queue_drops_total: result
                        .statistics
                        .ingress_queue_drops_total
                        .to_string(),
                    publisher_stale_drops_total: result
                        .statistics
                        .publisher_stale_drops_total
                        .to_string(),
                    cancelled_output_frames_total: result
                        .statistics
                        .cancelled_output_frames_total
                        .to_string(),
                    cancelled_output_samples_total: result
                        .statistics
                        .cancelled_output_samples_total
                        .to_string(),
                    failures_total: u64::from(result.error.is_some()).to_string(),
                    error: result.error.map(|failure| failure.to_string()),
                },
            )
        })
        .collect()
}

fn parse_sidecar_id(value: &str) -> Result<u64> {
    let id = value.parse::<u64>().map_err(|_| {
        error(
            "sidecar.invalid_configuration",
            "sidecar ID must be an unsigned 64-bit integer",
        )
    })?;
    if id == 0 {
        return Err(error(
            "sidecar.invalid_configuration",
            "sidecar ID must be non-zero",
        ));
    }
    Ok(id)
}

const fn lifecycle_state_name(state: pocketstation::SessionLifecycleState) -> &'static str {
    match state {
        pocketstation::SessionLifecycleState::Starting => "starting",
        pocketstation::SessionLifecycleState::Running => "running",
        pocketstation::SessionLifecycleState::Stopping => "stopping",
        pocketstation::SessionLifecycleState::Stopped => "stopped",
        pocketstation::SessionLifecycleState::Failed => "failed",
    }
}

#[cfg(test)]
mod tests {
    use super::{
        replacement_command_send_error, replacement_error_code, replacement_response_error,
        SessionCommand,
    };
    use futures::channel::oneshot;
    use pocketstation::{CaptureError, SessionSourceReplacementError, StemId};
    use std::sync::mpsc::sync_channel;

    #[test]
    fn replacement_errors_use_the_source_semantic_namespace() {
        #[cfg(feature = "conformance-fixtures")]
        let _ = super::conformance_source_replacement_error("session-not-running".to_owned());
        let stem_id = StemId::new(7);
        let cases = [
            (
                SessionSourceReplacementError::SessionNotRunning,
                "source.session_not_running",
            ),
            (
                SessionSourceReplacementError::UnknownStem { stem_id },
                "source.unknown_stem",
            ),
            (
                SessionSourceReplacementError::NotMicrophone { stem_id },
                "source.not_microphone",
            ),
            (
                SessionSourceReplacementError::Prepare {
                    source: CaptureError::NotSupported,
                },
                "source.replacement_prepare_failed",
            ),
            (
                SessionSourceReplacementError::Open {
                    source: CaptureError::NotSupported,
                },
                "source.replacement_open_failed",
            ),
            (
                SessionSourceReplacementError::Reopen {
                    source: CaptureError::NotSupported,
                },
                "source.reopen_failed",
            ),
            (
                SessionSourceReplacementError::ControlQueueFull,
                "source.replacement_queue_full",
            ),
            (
                SessionSourceReplacementError::RuntimeStopped,
                "source.runtime_stopped",
            ),
            (
                SessionSourceReplacementError::ResponseTimedOut { timeout_ms: 250 },
                "source.replacement_response_timed_out",
            ),
        ];

        for (failure, expected) in cases {
            assert_eq!(replacement_error_code(&failure), expected);
        }
    }

    #[test]
    fn given_full_command_queue_when_replacement_is_submitted_then_source_queue_code_is_returned() {
        let (commands, _receiver) = sync_channel(1);
        commands.try_send(SessionCommand::Shutdown).unwrap();

        let failure = commands.try_send(SessionCommand::Shutdown).unwrap_err();
        let projected = replacement_command_send_error(failure);

        assert!(projected
            .reason
            .starts_with("source.replacement_queue_full|"));
    }

    #[test]
    fn given_disconnected_worker_when_replacement_is_submitted_then_source_runtime_code_is_returned(
    ) {
        let (commands, receiver) = sync_channel(1);
        drop(receiver);

        let failure = commands.try_send(SessionCommand::Shutdown).unwrap_err();
        let projected = replacement_command_send_error(failure);

        assert!(projected.reason.starts_with("source.runtime_stopped|"));
    }

    #[test]
    fn given_dropped_replacement_response_when_waiting_then_source_runtime_code_is_returned() {
        let (response, receiver) = oneshot::channel::<()>();
        drop(response);

        let failure = futures::executor::block_on(receiver).unwrap_err();
        let projected = replacement_response_error(failure);

        assert!(projected.reason.starts_with("source.runtime_stopped|"));
    }
}
