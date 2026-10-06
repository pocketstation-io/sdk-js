use std::sync::Mutex;

use napi::bindgen_prelude::Buffer;
use napi::Result;
use napi_derive::napi;
use pocketstation::{
    AudioInput, AudioInputBufferAcquireError, AudioInputObservations, AudioInputWriteError,
    AudioInputWriteErrorKind, AudioOutputWriteError, AudioOutputWriteErrorKind, OutputCancelResult,
    OutputGeneration, SourceOutputHandle,
};

use crate::errors::{error, state_unavailable};
use crate::graph::{NativeDerivedStream, NativeOperator, NativeOperatorInput};
use crate::session::NativeEndpoint;

#[napi(object)]
pub struct NativeAudioInputObservations {
    pub capacity_frames: String,
    pub buffer_slots: String,
    pub available_buffers: String,
    pub accepted_total: String,
    pub full_total: String,
    pub invalid_total: String,
    pub discarded_output_frames_total: String,
    pub cancelled_output_writes_total: String,
    pub cancelled: bool,
    pub closed: bool,
}

impl NativeAudioInputObservations {
    fn new(
        value: AudioInputObservations,
        discarded_output_frames_total: u64,
        cancelled_output_writes_total: u64,
    ) -> Self {
        Self {
            capacity_frames: value.capacity_frames.to_string(),
            buffer_slots: value.buffer_slots.to_string(),
            available_buffers: value.available_buffers.to_string(),
            accepted_total: value.accepted_total.to_string(),
            full_total: value.full_total.to_string(),
            invalid_total: value.invalid_total.to_string(),
            discarded_output_frames_total: discarded_output_frames_total.to_string(),
            cancelled_output_writes_total: cancelled_output_writes_total.to_string(),
            cancelled: value.cancelled,
            closed: value.closed,
        }
    }
}

#[napi(js_name = "NativeOutputGeneration")]
pub struct NativeOutputGeneration {
    generation: OutputGeneration,
}

#[napi]
impl NativeOutputGeneration {
    #[napi(getter)]
    pub fn id(&self) -> String {
        self.generation.id().get().to_string()
    }

    #[napi(getter)]
    pub fn active(&self) -> bool {
        self.generation.is_active()
    }

    #[napi]
    pub fn cancel(&self) -> bool {
        matches!(self.generation.cancel(), OutputCancelResult::Cancelled)
    }
}

#[napi(js_name = "NativeSourceOutput")]
pub struct NativeSourceOutput {
    pub(crate) session_id: u64,
    pub(crate) handle: SourceOutputHandle,
}

#[napi]
impl NativeSourceOutput {
    #[napi(getter)]
    pub fn session_id(&self) -> String {
        self.session_id.to_string()
    }

    #[napi(getter)]
    pub fn source_instance_id(&self) -> String {
        self.handle.source_instance_id().value().to_string()
    }

    #[napi(getter)]
    pub fn source_id(&self) -> String {
        self.handle.source_id().get().to_string()
    }

    #[napi(getter)]
    pub fn stream_id(&self) -> String {
        self.handle.stream_id().get().to_string()
    }

    #[napi(getter)]
    pub fn output_port(&self) -> String {
        self.handle.output_port().to_owned()
    }

    #[napi]
    pub fn connect(&self, input: &NativeOperatorInput) -> Result<String> {
        require_same_session(self.session_id, input.session_id)?;
        self.handle
            .connect(input.handle.clone())
            .map(|route| route.get().to_string())
            .map_err(|failure| error("session.invalid_route", failure.to_string()))
    }

    #[napi]
    pub fn send(&self, endpoint: &NativeEndpoint, input_port: Option<String>) -> Result<String> {
        require_same_session(self.session_id, endpoint.session_id)?;
        self.handle
            .send_to(endpoint.handle, input_port)
            .map(|route| route.get().to_string())
            .map_err(|failure| error("session.invalid_route", failure.to_string()))
    }

    #[napi]
    pub fn through(
        &self,
        operator: &NativeOperator,
        input_port: Option<String>,
        output_port: Option<String>,
    ) -> Result<NativeDerivedStream> {
        self.handle
            .through_ports(operator.value.clone(), input_port, output_port)
            .map(|handle| NativeDerivedStream {
                session_id: self.session_id,
                handle,
            })
            .map_err(|failure| error("session.invalid_route", failure.to_string()))
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

#[napi(js_name = "NativeAudioInput")]
pub struct NativeAudioInput {
    session_id: u64,
    input: Mutex<AudioInput>,
}

impl NativeAudioInput {
    pub(crate) const fn new(session_id: u64, input: AudioInput) -> Self {
        Self {
            session_id,
            input: Mutex::new(input),
        }
    }

    fn with_input<T>(&self, operation: impl FnOnce(&mut AudioInput) -> Result<T>) -> Result<T> {
        let mut input = self
            .input
            .lock()
            .map_err(|_| state_unavailable("audio input"))?;
        operation(&mut input)
    }

    fn write_samples(
        &self,
        sample_count: usize,
        discontinuity: bool,
        generation: Option<&NativeOutputGeneration>,
        copy: impl FnOnce(&mut [f32]),
    ) -> Result<()> {
        self.with_input(|input| {
            let mut buffer = input.try_acquire().map_err(acquire_error)?;
            buffer
                .try_set_sample_count(sample_count)
                .map_err(|failure| invalid_buffer(failure.to_string()))?;
            copy(buffer.samples_mut());
            if discontinuity {
                buffer.mark_discontinuity();
            }
            if let Some(generation) = generation {
                input
                    .try_send_for_output(&generation.generation, buffer)
                    .map_err(output_write_error)
            } else {
                input.try_send(buffer).map_err(write_error)
            }
        })
    }
}

#[napi]
impl NativeAudioInput {
    #[napi(getter)]
    pub fn source_id(&self) -> Result<String> {
        self.with_input(|input| Ok(input.source().source_id().get().to_string()))
    }

    #[napi(getter)]
    pub fn stream_id(&self) -> Result<String> {
        self.with_input(|input| Ok(input.output().stream_id().get().to_string()))
    }

    #[napi(getter)]
    pub fn output(&self) -> Result<NativeSourceOutput> {
        self.with_input(|input| {
            Ok(NativeSourceOutput {
                session_id: self.session_id,
                handle: input.output().clone(),
            })
        })
    }

    #[napi]
    pub fn begin_output(&self) -> Result<NativeOutputGeneration> {
        self.with_input(|input| {
            input
                .begin_output_generation()
                .map(|generation| NativeOutputGeneration { generation })
                .map_err(|failure| {
                    error("audio_input.output_generation_limit", failure.to_string())
                })
        })
    }

    #[napi]
    pub fn try_write_f32(
        &self,
        samples: &[f32],
        discontinuity: bool,
        generation: Option<&NativeOutputGeneration>,
    ) -> Result<()> {
        self.write_samples(samples.len(), discontinuity, generation, |destination| {
            destination.copy_from_slice(samples);
        })
    }

    #[napi]
    pub fn try_write_f32_le(
        &self,
        samples: Buffer,
        discontinuity: bool,
        generation: Option<&NativeOutputGeneration>,
    ) -> Result<()> {
        let bytes = samples.as_ref();
        if !bytes.len().is_multiple_of(std::mem::size_of::<f32>()) {
            return Err(invalid_buffer(
                "Buffer byte length must be divisible by four",
            ));
        }
        self.write_samples(
            bytes.len() / std::mem::size_of::<f32>(),
            discontinuity,
            generation,
            |output| {
                for (sample, encoded) in output.iter_mut().zip(bytes.chunks_exact(4)) {
                    *sample = f32::from_le_bytes([encoded[0], encoded[1], encoded[2], encoded[3]]);
                }
            },
        )
    }

    #[napi]
    pub fn close(&self) -> Result<()> {
        self.with_input(|input| {
            input.close();
            Ok(())
        })
    }

    #[napi]
    pub fn observations(&self) -> Result<NativeAudioInputObservations> {
        self.with_input(|input| {
            Ok(NativeAudioInputObservations::new(
                input.observations(),
                input.discarded_output_frames_total(),
                input.cancelled_output_writes_total(),
            ))
        })
    }
}

fn require_same_session(left: u64, right: u64) -> Result<()> {
    if left == right {
        Ok(())
    } else {
        Err(error(
            "session.foreign_endpoint",
            "resources belong to different Sessions",
        ))
    }
}

fn acquire_error(failure: AudioInputBufferAcquireError) -> napi::Error {
    let code = match failure {
        AudioInputBufferAcquireError::Full => "audio_input.full",
        AudioInputBufferAcquireError::Closed => "audio_input.closed",
        AudioInputBufferAcquireError::Cancelled => "audio_input.cancelled",
    };
    error(code, failure.to_string())
}

fn write_error(failure: AudioInputWriteError) -> napi::Error {
    let code = match failure.kind() {
        AudioInputWriteErrorKind::Full => "audio_input.full",
        AudioInputWriteErrorKind::Closed => "audio_input.closed",
        AudioInputWriteErrorKind::Cancelled => "audio_input.cancelled",
        AudioInputWriteErrorKind::InvalidBuffer(_) => "audio_input.invalid_buffer",
    };
    error(code, failure.to_string())
}

fn output_write_error(failure: AudioOutputWriteError) -> napi::Error {
    let code = match failure.kind() {
        AudioOutputWriteErrorKind::Full => "audio_input.full",
        AudioOutputWriteErrorKind::Closed => "audio_input.closed",
        AudioOutputWriteErrorKind::SessionCancelled => "audio_input.cancelled",
        AudioOutputWriteErrorKind::OutputCancelled(_) => "audio_input.output_cancelled",
        AudioOutputWriteErrorKind::WrongInput => "audio_input.wrong_output_input",
        AudioOutputWriteErrorKind::InvalidBuffer(_) => "audio_input.invalid_buffer",
    };
    error(code, failure.to_string())
}

fn invalid_buffer(message: impl AsRef<str>) -> napi::Error {
    error("audio_input.invalid_buffer", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(capacity_frames: usize) -> (pocketstation::Session, NativeAudioInput) {
        let session = pocketstation::Session::builder().build();
        let session_id = session.id().get();
        let config = pocketstation::AudioInputConfig::new(
            pocketstation::SampleSpec::new(48_000, 1, pocketstation::SampleFormat::F32Interleaved),
            capacity_frames,
            480,
        )
        .expect("configuration");
        let input = NativeAudioInput::new(
            session_id,
            session.audio_input(config).expect("audio input"),
        );
        (session, input)
    }

    #[test]
    fn accepted_samples_are_copied_and_capacity_is_explicit() {
        let (_session, input) = input(1);
        let mut samples = vec![0.25; 480];
        input
            .try_write_f32(&samples, false, None)
            .expect("first write");
        samples.fill(0.75);
        let failure = input
            .try_write_f32(&samples, false, None)
            .expect_err("second write must report capacity");
        assert!(failure.reason.contains("audio_input.full"));
        let observations = input.observations().expect("observations");
        assert_eq!(observations.accepted_total, "1");
        assert_eq!(observations.full_total, "1");
    }

    #[test]
    fn close_is_idempotent_and_rejects_new_samples() {
        let (_session, input) = input(1);
        input.close().expect("first close");
        input.close().expect("second close");
        let failure = input
            .try_write_f32(&vec![0.0; 480], false, None)
            .expect_err("closed input must reject writes");
        assert!(failure.reason.contains("audio_input.closed"));
    }

    #[test]
    fn byte_input_requires_complete_little_endian_float32_samples() {
        let (_session, input) = input(1);
        let failure = input
            .try_write_f32_le(Buffer::from(vec![0_u8; 3]), false, None)
            .expect_err("partial sample must fail");
        assert!(failure.reason.contains("audio_input.invalid_buffer"));
    }

    #[test]
    fn newer_output_deactivates_older_output_without_closing_input() {
        let (_session, input) = input(2);
        let samples = vec![0.25; 480];
        let first = input.begin_output().expect("first output");
        input
            .try_write_f32(&samples, false, Some(&first))
            .expect("first output write");

        let second = input.begin_output().expect("second output");
        assert!(!first.active());
        assert!(second.active());
        let failure = input
            .try_write_f32(&samples, false, Some(&first))
            .expect_err("inactive output must reject writes");
        assert!(failure.reason.contains("audio_input.output_cancelled"));
        input
            .try_write_f32(&samples, false, Some(&second))
            .expect("current output write");

        let observations = input.observations().expect("observations");
        assert_eq!(observations.discarded_output_frames_total, "0");
        assert_eq!(observations.cancelled_output_writes_total, "1");
        assert!(!observations.closed);
    }
}
