use napi::bindgen_prelude::{ClassInstance, Either3};
use napi_derive::napi;

use crate::application_audio::NativeSourceOutput;
use crate::graph::NativeDerivedStream;
use crate::session::NativeStem;

pub(crate) type AudioInput<'a> = Either3<
    ClassInstance<'a, NativeStem>,
    ClassInstance<'a, NativeSourceOutput>,
    ClassInstance<'a, NativeDerivedStream>,
>;

pub(crate) fn echo_input(value: AudioInput<'_>) -> pocketstation::EchoAudioInput {
    match value {
        Either3::A(stem) => (&stem.handle).into(),
        Either3::B(output) => (&output.handle).into(),
        Either3::C(stream) => (&stream.handle).into(),
    }
}

#[napi(object)]
pub struct NativeEchoCancellationObservations {
    pub state: String,
    pub processed_microphone_frames_total: String,
    pub output_frames_total: String,
    pub tail_frames_total: String,
    pub tail_padding_samples_total: String,
    pub discarded_tail_generations_total: String,
    pub nominal_delay_samples: u32,
    pub drain_duration_ms: u32,
    pub discarded_microphone_frames_total: String,
    pub discarded_reference_frames_total: String,
    pub resets_total: String,
    pub processing_generation: String,
    pub microphone_queue_depth_frames: String,
    pub reference_queue_depth_frames: String,
    pub queue_capacity_frames: String,
    pub latest_processing_duration_ns: String,
    pub maximum_processing_duration_ns: String,
    pub latest_reference_age_ns: String,
    pub latest_reference_lead_ns: String,
    pub maximum_cadence_error_ns: String,
    pub analyzed_reference_frames_total: String,
    pub interrupted_requests_total: String,
    pub reference_source_id: Option<String>,
    pub microphone_source_id: Option<String>,
    pub qualified_algorithmic_delay_samples: Option<u32>,
    pub last_error: Option<String>,
}

#[napi(js_name = "NativeEchoCancelledAudio")]
pub struct NativeEchoCancelledAudio {
    pub(crate) session_id: u64,
    pub(crate) handle: pocketstation::EchoCancelledAudio,
}

#[napi]
impl NativeEchoCancelledAudio {
    #[napi]
    pub fn audio(&self) -> NativeStem {
        NativeStem {
            session_id: self.session_id,
            handle: self.handle.audio().clone(),
        }
    }

    #[napi(getter)]
    pub fn reference_coverage(&self) -> String {
        self.handle.reference_coverage().to_owned()
    }

    #[napi]
    pub fn observations(&self) -> NativeEchoCancellationObservations {
        use pocketstation::EchoCancellationState;

        let value = self.handle.observations();
        NativeEchoCancellationObservations {
            state: match value.state {
                EchoCancellationState::WaitingForReference => "waiting-for-reference",
                EchoCancellationState::Processing => "processing",
                EchoCancellationState::Reset => "reset",
                EchoCancellationState::Failed => "failed",
                EchoCancellationState::Interrupted => "interrupted",
                EchoCancellationState::Stopped => "stopped",
            }
            .to_owned(),
            processed_microphone_frames_total: value.processed_microphone_frames_total.to_string(),
            output_frames_total: value.output_frames_total.to_string(),
            tail_frames_total: value.tail_frames_total.to_string(),
            tail_padding_samples_total: value.tail_padding_samples_total.to_string(),
            discarded_tail_generations_total: value.discarded_tail_generations_total.to_string(),
            nominal_delay_samples: value.nominal_delay_samples,
            drain_duration_ms: value.drain_duration_ms,
            discarded_microphone_frames_total: value.discarded_microphone_frames_total.to_string(),
            discarded_reference_frames_total: value.discarded_reference_frames_total.to_string(),
            resets_total: value.resets_total.to_string(),
            processing_generation: value.processing_generation.to_string(),
            microphone_queue_depth_frames: value.microphone_queue_depth_frames.to_string(),
            reference_queue_depth_frames: value.reference_queue_depth_frames.to_string(),
            queue_capacity_frames: value.queue_capacity_frames.to_string(),
            latest_processing_duration_ns: value.latest_processing_duration_ns.to_string(),
            maximum_processing_duration_ns: value.maximum_processing_duration_ns.to_string(),
            latest_reference_age_ns: value.latest_reference_age_ns.to_string(),
            latest_reference_lead_ns: value.latest_reference_lead_ns.to_string(),
            maximum_cadence_error_ns: value.maximum_cadence_error_ns.to_string(),
            analyzed_reference_frames_total: value.analyzed_reference_frames_total.to_string(),
            interrupted_requests_total: value.interrupted_requests_total.to_string(),
            reference_source_id: value.reference_source_id.map(|id| id.get().to_string()),
            microphone_source_id: value.microphone_source_id.map(|id| id.get().to_string()),
            qualified_algorithmic_delay_samples: value.qualified_algorithmic_delay_samples,
            last_error: value.last_error,
        }
    }
}
