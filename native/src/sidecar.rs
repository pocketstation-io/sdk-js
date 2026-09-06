use std::path::PathBuf;
use std::time::{Duration, Instant};

use napi::bindgen_prelude::Buffer;
use napi::Result;
use napi_derive::napi;

use crate::errors::error;

pub(crate) const MAXIMUM_WAIT_MS: u32 = 1_000;

#[napi(object)]
pub struct NativeSidecarProcessSpec {
    pub id: String,
    pub program: String,
    pub arguments: Vec<String>,
    pub configuration: Buffer,
    pub data_capacity_messages: u32,
    pub max_signal_id_bytes: u32,
    pub max_role_bytes: u32,
    pub max_schema_bytes: u32,
    pub max_payload_bytes: u32,
    pub ready_timeout_ms: u32,
    pub processing_timeout_ms: u32,
    pub shutdown_timeout_ms: u32,
}

impl NativeSidecarProcessSpec {
    pub(crate) fn to_core(&self) -> Result<pocketstation::SidecarProcessSpec> {
        let id = parse_u64("sidecar ID", &self.id)?;
        if id == 0 {
            return Err(invalid_configuration("sidecar ID must be non-zero"));
        }
        if self.program.is_empty() {
            return Err(invalid_configuration("program must not be empty"));
        }
        if self.data_capacity_messages == 0 {
            return Err(invalid_configuration(
                "dataCapacityMessages must be greater than zero",
            ));
        }
        if self.max_signal_id_bytes == 0
            || self.max_role_bytes == 0
            || self.max_schema_bytes == 0
            || self.max_payload_bytes == 0
        {
            return Err(invalid_configuration(
                "protocol limits must be greater than zero",
            ));
        }
        if self.ready_timeout_ms == 0
            || self.processing_timeout_ms == 0
            || self.shutdown_timeout_ms == 0
        {
            return Err(invalid_configuration(
                "sidecar deadlines must be greater than zero",
            ));
        }
        let mut spec = pocketstation::SidecarProcessSpec::new(id, PathBuf::from(&self.program));
        spec.arguments = self.arguments.iter().map(Into::into).collect();
        spec.configuration = self.configuration.to_vec();
        spec.data_capacity_messages = self.data_capacity_messages as usize;
        spec.protocol_limits = pocketstation::SidecarProtocolLimits {
            max_signal_id_bytes: self.max_signal_id_bytes as usize,
            max_role_bytes: self.max_role_bytes as usize,
            max_schema_bytes: self.max_schema_bytes as usize,
            max_payload_bytes: self.max_payload_bytes as usize,
        };
        spec.deadlines = pocketstation::SidecarDeadlines {
            ready: Duration::from_millis(u64::from(self.ready_timeout_ms)),
            processing: Duration::from_millis(u64::from(self.processing_timeout_ms)),
            shutdown: Duration::from_millis(u64::from(self.shutdown_timeout_ms)),
        };
        Ok(spec)
    }
}

#[napi(object)]
pub struct NativeSidecarMessage {
    pub kind: String,
    pub stream_id: String,
    pub sequence_number: String,
    pub timestamp_ns: String,
    pub signal_id: String,
    pub payload: Buffer,
    pub terminal: bool,
    pub role: Option<String>,
    pub schema: Option<String>,
}

impl NativeSidecarMessage {
    pub(crate) fn to_core(&self) -> Result<pocketstation::SidecarMessage> {
        if self.signal_id.is_empty() {
            return Err(error(
                "sidecar.invalid_message",
                "signalId must not be empty",
            ));
        }
        Ok(pocketstation::SidecarMessage {
            kind: parse_kind(&self.kind)?,
            terminal: self.terminal,
            stream_id: parse_u64("streamId", &self.stream_id)?,
            sequence_number: parse_u64("sequenceNumber", &self.sequence_number)?,
            timestamp_ns: parse_u64("timestampNs", &self.timestamp_ns)?,
            signal_id: self.signal_id.clone(),
            role: self.role.clone(),
            schema: self.schema.clone(),
            payload: self.payload.to_vec(),
        })
    }
}

impl From<pocketstation::SidecarMessage> for NativeSidecarMessage {
    fn from(value: pocketstation::SidecarMessage) -> Self {
        Self {
            kind: kind_name(value.kind).to_owned(),
            terminal: value.terminal,
            stream_id: value.stream_id.to_string(),
            sequence_number: value.sequence_number.to_string(),
            timestamp_ns: value.timestamp_ns.to_string(),
            signal_id: value.signal_id,
            role: value.role,
            schema: value.schema,
            payload: value.payload.into(),
        }
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct NativeSidecarSnapshot {
    pub sidecar_id: String,
    pub state: String,
    pub state_transitions: String,
    pub data_enqueued_total: String,
    pub data_received_total: String,
    pub data_dropped_total: String,
    pub protocol_failures_total: String,
    pub timeouts_total: String,
    pub forced_kills_total: String,
    pub reaps_total: String,
}

impl From<pocketstation::SessionSidecarMetrics> for NativeSidecarSnapshot {
    fn from(value: pocketstation::SessionSidecarMetrics) -> Self {
        Self {
            sidecar_id: value.sidecar_id.to_string(),
            state: state_name(value.host.state).to_owned(),
            state_transitions: value.host.state_transitions.to_string(),
            data_enqueued_total: value.host.data_enqueued_total.to_string(),
            data_received_total: value.host.data_received_total.to_string(),
            data_dropped_total: value.host.data_dropped_total.to_string(),
            protocol_failures_total: value.host.protocol_failures_total.to_string(),
            timeouts_total: value.host.timeouts_total.to_string(),
            forced_kills_total: value.host.forced_kills_total.to_string(),
            reaps_total: value.host.reaps_total.to_string(),
        }
    }
}

pub(crate) enum SidecarRead {
    Item(pocketstation::SidecarMessage),
    Empty,
    Closed,
}

#[napi(object)]
pub struct NativeSidecarRead {
    pub status: String,
    pub message: Option<NativeSidecarMessage>,
}

impl From<SidecarRead> for NativeSidecarRead {
    fn from(value: SidecarRead) -> Self {
        match value {
            SidecarRead::Item(message) => Self {
                status: "item".to_owned(),
                message: Some(message.into()),
            },
            SidecarRead::Empty => Self {
                status: "empty".to_owned(),
                message: None,
            },
            SidecarRead::Closed => Self {
                status: "closed".to_owned(),
                message: None,
            },
        }
    }
}

pub(crate) fn poll(
    running: &pocketstation::RunningSession,
    sidecar_id: u64,
) -> std::result::Result<SidecarRead, String> {
    match running.try_receive_sidecar_signal(sidecar_id) {
        Ok(Some(message)) => Ok(SidecarRead::Item(message)),
        Ok(None) => Ok(SidecarRead::Empty),
        Err(pocketstation::SidecarHostError::Closed) => Ok(SidecarRead::Closed),
        Err(failure) => Err(error_reason(failure)),
    }
}

pub(crate) fn wait(
    running: &pocketstation::RunningSession,
    sidecar_id: u64,
    timeout: Duration,
) -> std::result::Result<SidecarRead, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match poll(running, sidecar_id)? {
            SidecarRead::Empty if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(1));
            }
            value => return Ok(value),
        }
    }
}

pub(crate) fn snapshot(
    running: &pocketstation::RunningSession,
    sidecar_id: u64,
) -> std::result::Result<pocketstation::SessionSidecarMetrics, String> {
    running
        .sidecar_metrics()
        .into_vec()
        .into_iter()
        .find(|metrics| metrics.sidecar_id == sidecar_id)
        .ok_or_else(|| {
            format!("sidecar.unknown|sidecar process ID {sidecar_id} is not owned by this Session")
        })
}

pub(crate) fn error_reason(failure: pocketstation::SidecarHostError) -> String {
    let code = match failure {
        pocketstation::SidecarHostError::InvalidConfiguration(_) => "sidecar.invalid_configuration",
        pocketstation::SidecarHostError::Spawn(_) => "sidecar.spawn_failed",
        pocketstation::SidecarHostError::ThreadSpawn(_) => "sidecar.thread_spawn_failed",
        pocketstation::SidecarHostError::MissingPipe(_) => "sidecar.missing_pipe",
        pocketstation::SidecarHostError::Io(_) => "sidecar.io",
        pocketstation::SidecarHostError::Protocol(_) => "sidecar.protocol",
        pocketstation::SidecarHostError::FrameTooLarge => "sidecar.frame_too_large",
        pocketstation::SidecarHostError::DataQueueFull => "sidecar.queue_full",
        pocketstation::SidecarHostError::ControlQueueFull => "sidecar.control_queue_full",
        pocketstation::SidecarHostError::Closed => "sidecar.closed",
        pocketstation::SidecarHostError::UnexpectedEof => "sidecar.unexpected_eof",
        pocketstation::SidecarHostError::UnexpectedMessage { .. } => "sidecar.unexpected_message",
        pocketstation::SidecarHostError::Timeout(_) => "sidecar.timeout",
        pocketstation::SidecarHostError::ProcessingTimeout => "sidecar.processing_timeout",
        pocketstation::SidecarHostError::InvalidState { .. } => "sidecar.invalid_state",
        pocketstation::SidecarHostError::InvalidDataKind(_) => "sidecar.invalid_message_kind",
        pocketstation::SidecarHostError::Wait(_) => "sidecar.wait_failed",
        pocketstation::SidecarHostError::Kill(_) => "sidecar.kill_failed",
        pocketstation::SidecarHostError::AlreadyReaped => "sidecar.already_reaped",
        pocketstation::SidecarHostError::UnknownSidecar(_) => "sidecar.unknown",
    };
    format!("{code}|{failure}")
}

pub(crate) fn runtime_error(reason: String) -> napi::Error {
    match reason.split_once('|') {
        Some((code, message)) => error(code, message),
        None => error("sidecar.failure", reason),
    }
}

fn parse_u64(name: &str, value: &str) -> Result<u64> {
    value.parse::<u64>().map_err(|_| {
        error(
            "sidecar.invalid_configuration",
            format!("{name} must be an unsigned 64-bit integer"),
        )
    })
}

fn invalid_configuration(message: &str) -> napi::Error {
    error("sidecar.invalid_configuration", message)
}

fn parse_kind(value: &str) -> Result<pocketstation::SidecarMessageKind> {
    match value {
        "signal" => Ok(pocketstation::SidecarMessageKind::Signal),
        "ready" => Ok(pocketstation::SidecarMessageKind::Ready),
        "error" => Ok(pocketstation::SidecarMessageKind::Error),
        "cancel" => Ok(pocketstation::SidecarMessageKind::Cancel),
        "close" => Ok(pocketstation::SidecarMessageKind::Close),
        "hello" => Ok(pocketstation::SidecarMessageKind::Hello),
        "manifest" => Ok(pocketstation::SidecarMessageKind::Manifest),
        "configure" => Ok(pocketstation::SidecarMessageKind::Configure),
        "observation" => Ok(pocketstation::SidecarMessageKind::Observation),
        "closed" => Ok(pocketstation::SidecarMessageKind::Closed),
        _ => Err(error(
            "sidecar.invalid_message_kind",
            "kind must be signal, ready, error, cancel, close, hello, manifest, configure, observation, or closed",
        )),
    }
}

const fn kind_name(value: pocketstation::SidecarMessageKind) -> &'static str {
    match value {
        pocketstation::SidecarMessageKind::Signal => "signal",
        pocketstation::SidecarMessageKind::Ready => "ready",
        pocketstation::SidecarMessageKind::Error => "error",
        pocketstation::SidecarMessageKind::Cancel => "cancel",
        pocketstation::SidecarMessageKind::Close => "close",
        pocketstation::SidecarMessageKind::Hello => "hello",
        pocketstation::SidecarMessageKind::Manifest => "manifest",
        pocketstation::SidecarMessageKind::Configure => "configure",
        pocketstation::SidecarMessageKind::Observation => "observation",
        pocketstation::SidecarMessageKind::Closed => "closed",
    }
}

const fn state_name(value: pocketstation::SidecarState) -> &'static str {
    match value {
        pocketstation::SidecarState::Spawned => "spawned",
        pocketstation::SidecarState::Hello => "hello",
        pocketstation::SidecarState::Manifest => "manifest",
        pocketstation::SidecarState::Configure => "configure",
        pocketstation::SidecarState::Ready => "ready",
        pocketstation::SidecarState::Running => "running",
        pocketstation::SidecarState::Cancelling => "cancelling",
        pocketstation::SidecarState::Closing => "closing",
        pocketstation::SidecarState::Closed => "closed",
        pocketstation::SidecarState::Reaped => "reaped",
        pocketstation::SidecarState::Failed => "failed",
    }
}
