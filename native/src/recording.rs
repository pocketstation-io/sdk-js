//! Thin Node projection; Core owns every file, interval and integrity decision.

use std::sync::Arc;

use napi::bindgen_prelude::{spawn_blocking, Buffer};
use napi::Result;
use napi_derive::napi;
use pocketstation::{
    RecordedAudio, RecordedStem, RecordingClip, RecordingClipWindow, SessionId, StemId,
};

use crate::errors::error;
use crate::observations::NativeRecordingDiscontinuity;

fn clip_error(failure: pocketstation::RecordingClipError) -> napi::Error {
    error(failure.code(), failure.to_string())
}

fn u64_value(value: &str, code: &str) -> Result<u64> {
    value
        .parse()
        .map_err(|_| error(code, "expected an unsigned 64-bit decimal integer"))
}

#[napi(object)]
pub struct NativeClipInterval {
    pub start_ns: String,
    pub end_ns: String,
}

impl From<RecordingClipWindow> for NativeClipInterval {
    fn from(value: RecordingClipWindow) -> Self {
        Self {
            start_ns: value.start_ns().to_string(),
            end_ns: value.end_ns().to_string(),
        }
    }
}

#[napi]
#[cfg_attr(test, allow(dead_code))] // N-API exports are exercised by installed Node tests.
pub fn recording_clip_window(
    start_ns: String,
    end_ns: String,
    before_ns: String,
    after_ns: String,
) -> Result<NativeClipInterval> {
    let code = "recording.clip_invalid_window";
    RecordingClipWindow::around(
        u64_value(&start_ns, code)?,
        u64_value(&end_ns, code)?,
        u64_value(&before_ns, code)?,
        u64_value(&after_ns, code)?,
    )
    .map(Into::into)
    .map_err(clip_error)
}

#[napi(object)]
pub struct NativeRecordedStem {
    pub label: String,
    pub session_id: String,
    pub source_id: String,
    pub stem_id: String,
    pub clock_id: String,
    pub source_generation: u32,
    pub permission_epoch: String,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub first_timestamp_ns: String,
    pub final_timestamp_ns: String,
}

impl From<RecordedStem> for NativeRecordedStem {
    fn from(value: RecordedStem) -> Self {
        Self {
            label: value.label,
            session_id: value.session_id.get().to_string(),
            source_id: value.source_id.get().to_string(),
            stem_id: value.stem_id.get().to_string(),
            clock_id: value.clock_id.get().to_string(),
            source_generation: value.source_generation,
            permission_epoch: value.permission_epoch.to_string(),
            sample_rate_hz: value.sample_rate_hz,
            channels: value.channels,
            first_timestamp_ns: value.first_timestamp_ns.to_string(),
            final_timestamp_ns: value.final_timestamp_ns.to_string(),
        }
    }
}

#[napi(object)]
pub struct NativeRecordingClip {
    pub wav: Buffer,
    pub stem: NativeRecordedStem,
    pub requested: NativeClipInterval,
    pub actual: NativeClipInterval,
    pub first_sample_frame: String,
    pub sample_frames: String,
    pub discontinuities: Vec<NativeRecordingDiscontinuity>,
}

impl From<RecordingClip> for NativeRecordingClip {
    fn from(value: RecordingClip) -> Self {
        use pocketstation::RecordingDiscontinuityKind;
        Self {
            wav: value.wav.into(),
            stem: value.stem.into(),
            requested: value.requested.into(),
            actual: value.actual.into(),
            first_sample_frame: value.first_sample_frame.to_string(),
            sample_frames: value.sample_frames.to_string(),
            discontinuities: value
                .discontinuities
                .into_iter()
                .map(|gap| NativeRecordingDiscontinuity {
                    stem_id: gap.stem_id.to_string(),
                    label: gap.label,
                    kind: match gap.kind {
                        RecordingDiscontinuityKind::TimestampGap => "timestamp-gap",
                        RecordingDiscontinuityKind::SequenceGap => "sequence-gap",
                        RecordingDiscontinuityKind::OverlapRejected => "overlap-rejected",
                    }
                    .to_owned(),
                    timestamp_start_ns: gap.timestamp_start_ns.to_string(),
                    timestamp_end_ns: gap.timestamp_end_ns.to_string(),
                    sequence_start: gap.sequence_start.map(|n| n.to_string()),
                    sequence_end: gap.sequence_end.map(|n| n.to_string()),
                })
                .collect(),
        }
    }
}

#[napi]
pub struct NativeRecordedAudio {
    inner: Arc<RecordedAudio>,
}

#[napi]
#[cfg_attr(test, allow(dead_code))] // N-API exports are exercised by installed Node tests.
pub async fn open_recorded_audio(
    directory: String,
    session_id: String,
) -> Result<NativeRecordedAudio> {
    let session = SessionId::new(u64_value(&session_id, "recording.clip_invalid_recording")?);
    let inner = spawn_blocking(move || RecordedAudio::open(directory, session).map_err(clip_error))
        .await
        .map_err(|failure| error("recording.clip_worker", failure.to_string()))??;
    Ok(NativeRecordedAudio {
        inner: Arc::new(inner),
    })
}

#[napi]
impl NativeRecordedAudio {
    #[napi]
    pub fn stems(&self) -> Vec<NativeRecordedStem> {
        self.inner.stems().iter().cloned().map(Into::into).collect()
    }

    #[napi]
    pub async fn read_clip(
        &self,
        stem_id: String,
        start_ns: String,
        end_ns: String,
    ) -> Result<NativeRecordingClip> {
        let stem = StemId::new(u64_value(&stem_id, "recording.clip_unknown_stem")?);
        let window = RecordingClipWindow::new(
            u64_value(&start_ns, "recording.clip_invalid_window")?,
            u64_value(&end_ns, "recording.clip_invalid_window")?,
        )
        .map_err(clip_error)?;
        let reader = Arc::clone(&self.inner);
        spawn_blocking(move || reader.read_clip(stem, window).map_err(clip_error))
            .await
            .map_err(|failure| error("recording.clip_worker", failure.to_string()))?
            .map(Into::into)
    }
}

#[napi]
pub struct NativeAudioHistory {
    pub(crate) inner: pocketstation::AudioHistory,
}

#[napi(object)]
pub struct NativeAudioHistoryObservations {
    pub state: String,
    pub retained_pcm_bytes: u32,
    pub retained_buffers: u32,
    pub received_buffers_total: String,
    pub evicted_buffers_total: String,
    pub rejected_buffers_total: String,
    pub discontinuities_total: String,
    pub source_resets_total: String,
}

fn history_error(failure: pocketstation::AudioHistoryError) -> napi::Error {
    error(failure.code(), failure.to_string())
}

#[napi]
impl NativeAudioHistory {
    #[napi]
    pub async fn stems(&self) -> Result<Vec<NativeRecordedStem>> {
        let history = self.inner.clone();
        spawn_blocking(move || {
            history
                .stems()
                .map_err(history_error)
                .map(|stems| stems.into_iter().map(Into::into).collect())
        })
        .await
        .map_err(|failure| error("recording.history_worker", failure.to_string()))?
    }

    #[napi]
    pub async fn read_clip(
        &self,
        stem_id: String,
        start_ns: String,
        end_ns: String,
    ) -> Result<NativeRecordingClip> {
        let stem = StemId::new(u64_value(&stem_id, "recording.history_unknown_stem")?);
        let window = RecordingClipWindow::new(
            u64_value(&start_ns, "recording.clip_invalid_window")?,
            u64_value(&end_ns, "recording.clip_invalid_window")?,
        )
        .map_err(clip_error)?;
        let history = self.inner.clone();
        spawn_blocking(move || {
            history
                .read_clip(stem, window)
                .map(Into::into)
                .map_err(history_error)
        })
        .await
        .map_err(|failure| error("recording.history_worker", failure.to_string()))?
    }

    #[napi]
    pub async fn clear(&self) -> Result<()> {
        let history = self.inner.clone();
        spawn_blocking(move || history.clear().map_err(history_error))
            .await
            .map_err(|failure| error("recording.history_worker", failure.to_string()))?
    }

    #[napi]
    pub async fn observations(&self) -> Result<NativeAudioHistoryObservations> {
        let history = self.inner.clone();
        spawn_blocking(move || {
            let value = history.observations().map_err(history_error)?;
            let state = match value.state {
                pocketstation::AudioHistoryState::Preparing => "preparing",
                pocketstation::AudioHistoryState::Running => "running",
                pocketstation::AudioHistoryState::Complete => "complete",
                pocketstation::AudioHistoryState::Cancelled => "cancelled",
                pocketstation::AudioHistoryState::Failed => "failed",
            };
            Ok(NativeAudioHistoryObservations {
                state: state.into(),
                retained_pcm_bytes: value.retained_pcm_bytes as u32,
                retained_buffers: value.retained_buffers as u32,
                received_buffers_total: value.received_buffers_total.to_string(),
                evicted_buffers_total: value.evicted_buffers_total.to_string(),
                rejected_buffers_total: value.rejected_buffers_total.to_string(),
                discontinuities_total: value.discontinuities_total.to_string(),
                source_resets_total: value.source_resets_total.to_string(),
            })
        })
        .await
        .map_err(|failure| error("recording.history_worker", failure.to_string()))?
    }
}
