use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Result, Task};
use napi_derive::napi;

use crate::errors::{error, state_unavailable};
use crate::sources::NativeSource;
use crate::streams::{copy_audio, NativeAudioRead};

const COMMAND_CAPACITY_COUNT: usize = 8;
const MAXIMUM_AUDIO_WAIT_MS: u32 = 1_000;

#[napi(object)]
pub struct NativeSessionOptions {
    pub sample_rate_hz: Option<u32>,
    pub channels: Option<u8>,
    pub frame_duration_ms: Option<u32>,
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
}

#[napi(js_name = "NativeEndpoint")]
pub struct NativeEndpoint {
    session_id: u64,
    handle: pocketstation::EndpointHandle,
}

#[napi]
impl NativeEndpoint {
    #[napi(getter)]
    pub fn id(&self) -> String {
        self.handle.id().get().to_string()
    }
}

#[napi(js_name = "NativeStem")]
pub struct NativeStem {
    session_id: u64,
    handle: pocketstation::StemHandle,
}

#[napi]
impl NativeStem {
    #[napi(getter)]
    pub fn id(&self) -> String {
        self.handle.id().get().to_string()
    }

    #[napi]
    pub fn send(&self, endpoint: &NativeEndpoint) -> Result<String> {
        if endpoint.session_id != self.session_id {
            return Err(error(
                "session.mismatched_resource",
                "Stem and Endpoint belong to different Sessions",
            ));
        }
        self.handle
            .send(endpoint.handle)
            .map(|route_id| route_id.get().to_string())
            .map_err(|failure| error("session.invalid_route", failure.to_string()))
    }
}

#[napi(js_name = "NativeSession")]
pub struct NativeSession {
    session: Arc<Mutex<Option<pocketstation::Session>>>,
    session_id: u64,
}

#[napi]
impl NativeSession {
    #[napi(constructor)]
    pub fn new(options: Option<NativeSessionOptions>) -> Result<Self> {
        let options = options.unwrap_or(NativeSessionOptions {
            sample_rate_hz: None,
            channels: None,
            frame_duration_ms: None,
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
        let session = pocketstation::Session::builder()
            .sample_spec(pocketstation::SampleSpec::new(
                sample_rate_hz,
                channels,
                pocketstation::SampleFormat::F32Interleaved,
            ))
            .audio_frame_duration(frame_duration)
            .build();
        let session_id = session.id().get();
        Ok(Self {
            session: Arc::new(Mutex::new(Some(session))),
            session_id,
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
        }))
    }
}

impl NativeSession {
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
}

impl Task for StartTask {
    type Output = NativeRunningSession;
    type JsValue = NativeRunningSession;

    fn compute(&mut self) -> Result<Self::Output> {
        let session = self
            .session
            .lock()
            .map_err(|_| state_unavailable("Session"))?
            .take()
            .ok_or_else(|| error("session.draft_frozen", "Session has already started"))?;
        let running = session
            .start()
            .map_err(|failure| error("session.start_failed", failure.to_string()))?;
        NativeRunningSession::spawn(running, self.session_id)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

enum SessionCommand {
    ReadAudio {
        timeout: Duration,
        response: SyncSender<Result<NativeAudioRead>>,
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
    fn spawn(running: pocketstation::RunningSession, session_id: u64) -> Result<Self> {
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
            SessionCommand::Stop { response } => {
                let stop = running.stop();
                let _ = response.send(stop_result(
                    &running,
                    stop.is_success(),
                    matches!(
                        stop.disposition(),
                        pocketstation::SessionStopDisposition::AlreadyStopped
                    ),
                    "stopped",
                    &stop.outcome(),
                ));
                return;
            }
            SessionCommand::Cancel { response } => {
                let cancel = running.cancel();
                let _ = response.send(stop_result(
                    &running,
                    cancel.is_success(),
                    matches!(
                        cancel.disposition(),
                        pocketstation::SessionCancelDisposition::AlreadyStopped
                    ),
                    "cancelled",
                    &cancel.outcome(),
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

fn stop_result(
    running: &pocketstation::RunningSession,
    success: bool,
    already_stopped: bool,
    disposition: &str,
    outcome: &pocketstation::SessionStopOutcome,
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
