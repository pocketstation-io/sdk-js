use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Result, Task};
use napi_derive::napi;

use crate::application_audio::NativeAudioInput;
use crate::errors::{error, state_unavailable};
use crate::graph::{
    NativeEndpointDefinition, NativeOperator, NativeOperatorInput, NativeOperatorInstance,
    NativeRouteSettings,
};
use crate::signals::{
    close_signal, copy_signal_metrics, new_signal_receipts, read_signal_task, subscribe_derived,
    subscribe_source_output, validate_subscription, NativeBusSubscription, NativeSignalMetrics,
    ReadSignalTask, SignalReceipts,
};
use crate::sources::{platform_name, source_kind_name, NativeSource};
use crate::streams::{copy_audio, NativeAudioRead};

const COMMAND_CAPACITY_COUNT: usize = 8;
const MAXIMUM_AUDIO_WAIT_MS: u32 = 1_000;

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
                "session.mismatched_resource",
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
}

#[napi(js_name = "NativeSession")]
pub struct NativeSession {
    session: Arc<Mutex<Option<pocketstation::Session>>>,
    session_id: u64,
    signal_receipts: SignalReceipts,
    next_signal_subscription_id: AtomicU64,
}

#[napi]
impl NativeSession {
    #[napi(constructor)]
    pub fn new(options: Option<NativeSessionOptions>) -> Result<Self> {
        let options = options.unwrap_or(NativeSessionOptions {
            sample_rate_hz: None,
            channels: None,
            frame_duration_ms: None,
            recording_root: None,
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
        let session = builder.build();
        let session_id = session.id().get();
        Ok(Self {
            session: Arc::new(Mutex::new(Some(session))),
            session_id,
            signal_receipts: new_signal_receipts(),
            next_signal_subscription_id: AtomicU64::new(0),
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
    pub fn start(&self) -> Result<AsyncTask<StartTask>> {
        {
            let guard = self
                .session
                .lock()
                .map_err(|_| state_unavailable("Session"))?;
            if guard.is_none() {
                return Err(error("session.draft_frozen", "Session has already started"));
            }
        }
        Ok(AsyncTask::new(StartTask {
            session: Arc::clone(&self.session),
            session_id: self.session_id,
            signal_receipts: Arc::clone(&self.signal_receipts),
        }))
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
        })
    }
}

impl NativeSession {
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

pub struct StartTask {
    session: Arc<Mutex<Option<pocketstation::Session>>>,
    session_id: u64,
    signal_receipts: SignalReceipts,
}

impl Task for StartTask {
    type Output = NativeStartResult;
    type JsValue = NativeStartResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let session = self
            .session
            .lock()
            .map_err(|_| state_unavailable("Session"))?
            .take()
            .ok_or_else(|| error("session.draft_frozen", "Session has already started"))?;
        match session.start() {
            Ok(running) => NativeRunningSession::spawn(
                running,
                self.session_id,
                Arc::clone(&self.signal_receipts),
            )
            .map(|running| NativeStartResult {
                running: Some(running),
                failure: None,
            }),
            Err(failure) => Ok(NativeStartResult {
                running: None,
                failure: Some(project_start_failure(&failure)),
            }),
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
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
    ReadAudio {
        timeout: Duration,
        response: SyncSender<Result<NativeAudioRead>>,
    },
    ReadEvent {
        timeout: Duration,
        response: SyncSender<Result<NativeEventRead>>,
    },
    SignalMetrics {
        route_id: u64,
        response: SyncSender<std::result::Result<NativeSignalMetrics, String>>,
    },
    Stop {
        response: SyncSender<NativeStopResult>,
    },
    Cancel {
        response: SyncSender<NativeStopResult>,
    },
    Shutdown,
}

struct SessionWorker {
    commands: SyncSender<SessionCommand>,
    join: Option<JoinHandle<()>>,
}

#[napi(js_name = "NativeRunningSession")]
pub struct NativeRunningSession {
    worker: Mutex<Option<SessionWorker>>,
    session_id: u64,
    signal_receipts: SignalReceipts,
}

#[napi]
impl NativeRunningSession {
    #[napi(getter)]
    pub fn session_id(&self) -> String {
        self.session_id.to_string()
    }

    #[napi]
    pub fn read_audio(&self, timeout_ms: u32) -> Result<AsyncTask<ReadAudioTask>> {
        if timeout_ms > MAXIMUM_AUDIO_WAIT_MS {
            return Err(error(
                "stream.invalid_timeout",
                "timeoutMs must be between 0 and 1000",
            ));
        }
        let commands = self.commands()?;
        Ok(AsyncTask::new(ReadAudioTask {
            commands,
            timeout: Duration::from_millis(u64::from(timeout_ms)),
        }))
    }

    #[napi]
    pub fn read_event(&self, timeout_ms: u32) -> Result<AsyncTask<ReadEventTask>> {
        if timeout_ms > MAXIMUM_AUDIO_WAIT_MS {
            return Err(error(
                "stream.invalid_timeout",
                "timeoutMs must be between 0 and 1000",
            ));
        }
        Ok(AsyncTask::new(ReadEventTask {
            commands: self.commands()?,
            timeout: Duration::from_millis(u64::from(timeout_ms)),
        }))
    }

    #[napi]
    pub fn read_signal(
        &self,
        subscription: &NativeBusSubscription,
        timeout_ms: u32,
    ) -> Result<AsyncTask<ReadSignalTask>> {
        read_signal_task(
            &self.signal_receipts,
            self.session_id,
            subscription,
            timeout_ms,
        )
    }

    #[napi]
    pub fn close_signal(&self, subscription: &NativeBusSubscription) -> Result<()> {
        close_signal(&self.signal_receipts, self.session_id, subscription)
    }

    #[napi]
    pub fn signal_metrics(
        &self,
        subscription: &NativeBusSubscription,
    ) -> Result<AsyncTask<SignalMetricsTask>> {
        validate_subscription(&self.signal_receipts, self.session_id, subscription)?;
        Ok(AsyncTask::new(SignalMetricsTask {
            commands: self.commands()?,
            route_id: subscription.route_id,
        }))
    }

    #[napi]
    pub fn stop(&self) -> Result<AsyncTask<FinishTask>> {
        Ok(AsyncTask::new(FinishTask {
            worker: Some(self.take_worker()?),
            disposition: FinishDisposition::Stop,
        }))
    }

    #[napi]
    pub fn cancel(&self) -> Result<AsyncTask<FinishTask>> {
        Ok(AsyncTask::new(FinishTask {
            worker: Some(self.take_worker()?),
            disposition: FinishDisposition::Cancel,
        }))
    }
}

impl NativeRunningSession {
    fn spawn(
        running: pocketstation::RunningSession,
        session_id: u64,
        signal_receipts: SignalReceipts,
    ) -> Result<Self> {
        let (commands, receiver) = sync_channel(COMMAND_CAPACITY_COUNT);
        let join = thread::Builder::new()
            .name("pocketstation-js-session".to_owned())
            .spawn(move || session_worker(running, receiver))
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
            session_id,
            signal_receipts,
        })
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
}

pub struct ReadEventTask {
    commands: SyncSender<SessionCommand>,
    timeout: Duration,
}

impl Task for ReadEventTask {
    type Output = NativeEventRead;
    type JsValue = NativeEventRead;

    fn compute(&mut self) -> Result<Self::Output> {
        let (response, receiver) = sync_channel(1);
        self.commands
            .send(SessionCommand::ReadEvent {
                timeout: self.timeout,
                response,
            })
            .map_err(|_| error("session.stopped", "native Session worker has stopped"))?;
        receiver.recv().map_err(|_| {
            error(
                "session.worker_stopped",
                "native Session worker did not return an event",
            )
        })?
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
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

pub struct ReadAudioTask {
    commands: SyncSender<SessionCommand>,
    timeout: Duration,
}

pub struct SignalMetricsTask {
    commands: SyncSender<SessionCommand>,
    route_id: u64,
}

impl Task for SignalMetricsTask {
    type Output = NativeSignalMetrics;
    type JsValue = NativeSignalMetrics;

    fn compute(&mut self) -> Result<Self::Output> {
        let (response, receiver) = sync_channel(1);
        self.commands
            .send(SessionCommand::SignalMetrics {
                route_id: self.route_id,
                response,
            })
            .map_err(|_| error("session.stopped", "native Session worker has stopped"))?;
        receiver
            .recv()
            .map_err(|_| {
                error(
                    "session.worker_stopped",
                    "native Session worker did not return signal metrics",
                )
            })?
            .map_err(|failure| error("stream.metrics_unavailable", failure))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

impl Task for ReadAudioTask {
    type Output = NativeAudioRead;
    type JsValue = NativeAudioRead;

    fn compute(&mut self) -> Result<Self::Output> {
        let (response, receiver) = sync_channel(1);
        self.commands
            .send(SessionCommand::ReadAudio {
                timeout: self.timeout,
                response,
            })
            .map_err(|_| error("session.stopped", "native Session worker has stopped"))?;
        receiver.recv().map_err(|_| {
            error(
                "session.worker_stopped",
                "native Session worker did not return audio",
            )
        })?
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[derive(Clone, Copy)]
enum FinishDisposition {
    Stop,
    Cancel,
}

pub struct FinishTask {
    worker: Option<SessionWorker>,
    disposition: FinishDisposition,
}

impl Task for FinishTask {
    type Output = NativeStopResult;
    type JsValue = NativeStopResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let mut worker = self
            .worker
            .take()
            .ok_or_else(|| error("session.stopped", "Session has stopped"))?;
        let (response, receiver) = sync_channel(1);
        let command = match self.disposition {
            FinishDisposition::Stop => SessionCommand::Stop { response },
            FinishDisposition::Cancel => SessionCommand::Cancel { response },
        };
        worker
            .commands
            .send(command)
            .map_err(|_| error("session.stopped", "native Session worker has stopped"))?;
        let result = receiver.recv().map_err(|_| {
            error(
                "session.worker_stopped",
                "native Session worker did not return a final result",
            )
        })?;
        if let Some(join) = worker.join.take() {
            join.join().map_err(|_| {
                error(
                    "session.worker_panicked",
                    "native Session worker panicked during shutdown",
                )
            })?;
        }
        Ok(result)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

fn session_worker(mut running: pocketstation::RunningSession, receiver: Receiver<SessionCommand>) {
    while let Ok(command) = receiver.recv() {
        match command {
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
            SessionCommand::Stop { response } => {
                let stop = running.stop();
                let remaining_events = drain_events(&running);
                let _ = response.send(stop_result(
                    &running,
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
            let (event_kind, stable_id, generation, recovery, runtime_failure) =
                match failure.event() {
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
            let mut result = empty_event("source-failure", session_id);
            result.source_event_kind = Some(event_kind.to_owned());
            result.stem_id = Some(failure.stem_id().get().to_string());
            result.source_platform = Some(platform_name(stable_id.platform).to_owned());
            result.source_kind = Some(source_kind_name(stable_id.kind).to_owned());
            result.source_stable_key = Some(stable_id.stable_key.clone());
            result.source_id = Some(stable_id.source_id().get().to_string());
            result.source_generation = Some(generation);
            result.source_recovery_requirement = recovery.map(str::to_owned);
            result.source_failure_operation = Some(runtime_failure.operation.to_owned());
            match &runtime_failure.error_class {
                pocketstation::CaptureRuntimeFailureClass::SourceInstanceExited => {
                    result.source_failure_class = Some("source-instance-exited".to_owned());
                }
                pocketstation::CaptureRuntimeFailureClass::PlatformStatus { status_code } => {
                    result.source_failure_class = Some("platform-status".to_owned());
                    result.source_platform_status_code = Some(*status_code);
                }
                pocketstation::CaptureRuntimeFailureClass::BackendClass { class } => {
                    result.source_failure_class = Some("backend-class".to_owned());
                    result.source_backend_class = Some(class.clone());
                }
            }
            result
        }
        pocketstation::SessionEventKind::Endpoint(failure) => {
            let mut result = empty_event("endpoint-failure", session_id);
            result.route_id = Some(failure.route_id().get().to_string());
            result.endpoint_id = Some(failure.endpoint_id().get().to_string());
            result.failure_stage = Some(endpoint_stage_name(failure.stage()).to_owned());
            result.failure_message = Some(failure.failure().message().to_owned());
            result.failure_code = failure.failure().code().map(str::to_owned);
            result.failure_retryability = failure
                .failure()
                .retryability()
                .map(endpoint_retryability_name)
                .map(str::to_owned);
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
            result
        }
    }
}

fn project_control_failure(
    result: &mut NativeSessionEvent,
    failure: &pocketstation::SessionControlFailure,
) {
    let (kind, id) = match failure.component() {
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
    };
    result.component_kind = Some(kind.to_owned());
    result.component_id = Some(id);
    result.failure_operation = Some(failure.operation().to_owned());
    result.failure_error_class = Some(failure.error_class().to_owned());
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
    success: bool,
    already_stopped: bool,
    disposition: &str,
    outcome: &pocketstation::SessionStopOutcome,
    remaining_events: Vec<NativeSessionEvent>,
) -> NativeStopResult {
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
        remaining_events,
    }
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
