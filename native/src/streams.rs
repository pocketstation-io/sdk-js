use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

#[napi(object)]
pub struct NativeAudioProcessing {
    pub input_source_id: String,
    pub input_stream_id: String,
    pub input_sequence_number: String,
    pub input_timestamp_ns: String,
    pub input_duration_ns: String,
    pub input_source_generation: u32,
    pub input_discontinuity_epoch: String,
    pub generation: String,
    pub nominal_delay_samples: u32,
    pub padding_samples: u32,
    pub tail_offset_samples: u32,
    pub is_tail: bool,
}

impl From<pocketstation::AudioProcessing> for NativeAudioProcessing {
    fn from(value: pocketstation::AudioProcessing) -> Self {
        Self {
            input_source_id: value.input_source_id.get().to_string(),
            input_stream_id: value.input_stream_id.get().to_string(),
            input_sequence_number: value.input_sequence_number.to_string(),
            input_timestamp_ns: value.input_timestamp_ns.to_string(),
            input_duration_ns: value.input_duration_ns.to_string(),
            input_source_generation: value.input_source_generation,
            input_discontinuity_epoch: value.input_discontinuity_epoch.to_string(),
            generation: value.generation.to_string(),
            nominal_delay_samples: value.nominal_delay_samples,
            padding_samples: value.padding_samples,
            tail_offset_samples: value.tail_offset_samples,
            is_tail: value.is_tail(),
        }
    }
}

#[napi(object)]
pub struct NativeAudioFrame {
    pub samples_f32le: Buffer,
    pub sample_count: u32,
    pub sample_rate_hz: u32,
    pub channel_count: u8,
    pub session_id: String,
    pub stream_id: String,
    pub source_id: String,
    pub stem_id: String,
    pub clock_id: u32,
    pub clock_kind: String,
    pub clock_origin: String,
    pub clock_tick_rate_hz: Option<String>,
    pub sequence_number: String,
    pub timestamp_start_ns: String,
    pub duration_ns: String,
    pub source_generation: u32,
    pub discontinuity_epoch: String,
    pub permission_epoch: String,
    pub output_generation_id: Option<String>,
    pub processing: Option<NativeAudioProcessing>,
    pub endpoint_id: String,
    pub connector_id: String,
    pub route_id: String,
    pub route_enqueued_at_ns: String,
    pub route_received_at_ns: String,
    pub endpoint_enqueued_at_ns: String,
    pub polled_at_ns: String,
    pub native_read_resolved_at_ns: String,
}

#[napi(object)]
pub struct NativeAudioRead {
    pub frames: Vec<NativeAudioFrame>,
    pub session_state: String,
}

pub(crate) fn copy_audio(
    running: &pocketstation::RunningSession,
    timeout: std::time::Duration,
) -> Result<Vec<NativeAudioFrame>, String> {
    copy_batch(
        running
            .wait_audio(timeout)
            .map_err(|error| error.to_string())?,
    )
}

pub(crate) fn copy_retained_audio(
    receipt: &pocketstation::PolledAudioReceipt,
) -> Result<Vec<NativeAudioFrame>, String> {
    match receipt.try_poll() {
        Ok(batch) => copy_batch(Some(batch)),
        Err(pocketstation::PolledAudioPollError::Empty) => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn copy_batch(
    batch: Option<pocketstation::PolledAudioBatchLease>,
) -> Result<Vec<NativeAudioFrame>, String> {
    let Some(batch) = batch else {
        return Ok(Vec::new());
    };
    let mut frames = Vec::with_capacity(batch.len());
    for index in 0..batch.len() {
        let frame = batch
            .frame(index)
            .ok_or_else(|| "native audio batch changed during copy".to_owned())?;
        let lineage = frame.lineage();
        let clock = pocketstation::timing::describe_clock_domain(lineage.clock_id());
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
        let mut bytes = Vec::with_capacity(std::mem::size_of_val(frame.samples()));
        for sample in frame.samples() {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        frames.push(NativeAudioFrame {
            samples_f32le: bytes.into(),
            sample_count: u32::try_from(frame.samples().len())
                .map_err(|_| "audio frame sample count exceeds u32".to_owned())?,
            sample_rate_hz: frame.sample_rate_hz(),
            channel_count: frame.channels(),
            session_id: lineage.session_id().get().to_string(),
            stream_id: frame.stream_id().get().to_string(),
            source_id: lineage.source_id().get().to_string(),
            stem_id: lineage.stem_id().get().to_string(),
            clock_id: lineage.clock_id().get(),
            clock_kind: clock_kind.to_owned(),
            clock_origin: clock_origin.to_owned(),
            clock_tick_rate_hz: clock.tick_rate_hz().map(|value| value.to_string()),
            sequence_number: lineage.sequence_number().to_string(),
            timestamp_start_ns: lineage.timestamp_start_ns().to_string(),
            duration_ns: lineage.duration_ns().to_string(),
            source_generation: lineage.source_generation(),
            discontinuity_epoch: lineage.discontinuity_epoch().to_string(),
            permission_epoch: lineage.permission_epoch().to_string(),
            output_generation_id: frame
                .output_generation_id()
                .map(|value| value.get().to_string()),
            processing: frame.processing().map(NativeAudioProcessing::from),
            endpoint_id: frame.endpoint_id().get().to_string(),
            connector_id: frame.connector_id().get().to_string(),
            route_id: frame.route_id().get().to_string(),
            route_enqueued_at_ns: frame.route_enqueued_at_ns().to_string(),
            route_received_at_ns: frame.route_received_at_ns().to_string(),
            endpoint_enqueued_at_ns: frame.endpoint_enqueued_at_ns().to_string(),
            polled_at_ns: frame.polled_at_ns().to_string(),
            native_read_resolved_at_ns: "0".to_owned(),
        });
    }
    Ok(frames)
}
