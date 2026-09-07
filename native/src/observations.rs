use napi_derive::napi;

use crate::errors::error;

#[napi(object)]
pub struct NativeEventQueueMetrics {
    pub capacity_count: String,
    pub maximum_event_owned_bytes: String,
    pub maximum_buffered_owned_bytes: String,
    pub depth_count: String,
    pub depth_owned_bytes: String,
    pub peak_depth_count: String,
    pub peak_depth_owned_bytes: String,
    pub enqueued_total: String,
    pub dropped_total: String,
    pub dropped_oversized_total: String,
    pub receiver_closed_total: String,
}

#[napi(object)]
pub struct NativePolledAudioMetrics {
    pub registered_endpoints: String,
    pub queue_capacity_frames: String,
    pub queue_depth_frames: String,
    pub queue_peak_frames: String,
    pub queue_depth_invariant_failures_total: String,
    pub frames_received_total: String,
    pub frames_delivered_total: String,
    pub queue_full_drops_total: String,
    pub invalid_ownership_drops_total: String,
    pub discarded_output_frames_total: String,
    pub lease_capacity_count: String,
    pub outstanding_leases: String,
    pub lease_exhausted_total: String,
    pub batches_polled_total: String,
    pub frames_polled_total: String,
}

#[napi(object)]
pub struct NativeLatencyHistogram {
    pub samples_total: String,
    pub invalid_order_total: String,
    pub missing_total: String,
    pub future_total: String,
    pub p50_ns: String,
    pub p95_ns: String,
    pub p99_ns: String,
    pub max_ns: String,
}

#[napi(object)]
pub struct NativeRouteDeliveryMetrics {
    pub queue_capacity_frames: String,
    pub queue_depth_frames: String,
    pub queue_peak_frames: String,
    pub frames_enqueued_total: String,
    pub frames_delivered_total: String,
    pub frames_dropped_total: String,
    pub overruns_total: String,
    pub receiver_unavailable_drops_total: String,
    pub queue_full_drops_total: String,
    pub shared_reference_exhausted_drops_total: String,
    pub branch_pool_exhausted_drops_total: String,
    pub invalid_copy_policy_drops_total: String,
    pub freeze_failed_drops_total: String,
    pub discontinuities_total: String,
    pub source_identity_discontinuities_total: String,
    pub sequence_discontinuities_total: String,
    pub timestamp_discontinuities_total: String,
    pub lineage_epoch_discontinuities_total: String,
    pub manually_reported_discontinuities_total: String,
    pub enqueue_to_receive: NativeLatencyHistogram,
    pub source_timestamp_to_receive: NativeLatencyHistogram,
    pub worker_failures_total: String,
    pub shutdown_discarded_total: String,
    pub discarded_output_frames_total: Option<String>,
}

#[napi(object)]
pub struct NativeEndpointMetrics {
    pub observation_stage: String,
    pub frames_received_total: String,
    pub frames_delivered_total: String,
    pub frames_dropped_total: String,
    pub discontinuities_total: String,
    pub failures_total: String,
    pub finalization_failures_total: String,
}

#[napi(object)]
pub struct NativeRouteMetrics {
    pub route_id: String,
    pub endpoint_id: String,
    pub delivery: NativeRouteDeliveryMetrics,
    pub endpoint: NativeEndpointMetrics,
    pub frames_attempted_total: String,
    pub observation_interval: String,
    pub drop_rate_pct: f64,
    pub source_latency_measurement: String,
    pub source_latency_unit: String,
}

#[napi(object)]
pub struct NativeSourceMetrics {
    pub stem_id: String,
    pub callback_buffers_total: String,
    pub capture_frames_enqueued_total: String,
    pub capture_pool_exhausted_total: String,
    pub capture_dispatch_queue_full_total: String,
    pub capture_invalid_buffer_total: String,
    pub capture_oversized_buffer_total: String,
    pub capture_stream_errors_total: String,
    pub capture_timestamp_epoch_clamps_total: String,
    pub frame_stream_delivered_frames_total: String,
    pub frame_stream_dropped_newest_frames_total: String,
    pub frames_discarded_before_start_total: String,
    pub runtime_event_queue: NativeEventQueueMetrics,
    pub ingress_queue_capacity_frames: String,
    pub ingress_queue_depth_frames: String,
    pub ingress_queue_peak_frames: String,
    pub ingress_frames_enqueued_total: String,
    pub ingress_frames_delivered_total: String,
    pub ingress_frames_rejected_full_total: String,
    pub ingress_frames_rejected_cancelled_total: String,
    pub ingress_frames_discarded_total: String,
}

#[napi(object)]
pub struct NativeExternalSourceMetrics {
    pub source_instance_id: String,
    pub source_id: String,
    pub emitted_total: String,
    pub dropped_total: String,
    pub failure_total: String,
    pub cancellation_total: String,
    pub discontinuity_total: String,
    pub recovery_total: String,
    pub policy_change_total: String,
    pub ready: bool,
    pub joined: bool,
}

#[napi(object)]
pub struct NativeSignalQueueMetrics {
    pub capacity_signals: String,
    pub max_payload_bytes: String,
    pub maximum_buffered_payload_bytes: String,
    pub depth_signals: String,
    pub peak_depth_signals: String,
    pub enqueued_total: String,
    pub received_total: String,
    pub dropped_total: String,
}

#[napi(object)]
pub struct NativeOperatorWorkerMetrics {
    pub input_attempted_total: String,
    pub input_dropped_total: String,
    pub processed_total: String,
    pub output_emitted_total: String,
    pub output_dropped_total: String,
    pub output_nonterminal_total: String,
    pub output_terminal_total: String,
    pub process_failure_total: String,
    pub timeout_total: String,
    pub cancellation_total: String,
    pub graceful_finish_total: String,
    pub idle_poll_total: String,
    pub ready: bool,
    pub joined: bool,
}

#[napi(object)]
pub struct NativeOperatorInputMetrics {
    pub port_name: String,
    pub delivery: NativeRouteDeliveryMetrics,
}

#[napi(object)]
pub struct NativeOperatorMetrics {
    pub operator_instance_id: String,
    pub input_delivery: NativeRouteDeliveryMetrics,
    pub input_ports: Vec<NativeOperatorInputMetrics>,
    pub worker: NativeOperatorWorkerMetrics,
    pub finalization_failures_total: String,
}

#[napi(object)]
pub struct NativeDerivedRouteMetrics {
    pub route_id: String,
    pub endpoint_id: String,
    pub output: NativeSignalQueueMetrics,
    pub endpoint: NativeEndpointMetrics,
}

#[napi(object)]
pub struct NativeAudioReentryMetrics {
    pub operator_instance_id: String,
    pub stem_id: String,
    pub queue_capacity_signals: String,
    pub queue_depth_signals: String,
    pub queue_peak_signals: String,
    pub signals_enqueued_total: String,
    pub signals_received_total: String,
    pub signals_dropped_total: String,
    pub pool_slots: String,
    pub frame_capacity_samples: String,
    pub maximum_buffered_audio_bytes: String,
    pub normalized_total: String,
    pub invalid_total: String,
    pub shared_audio_rejected_total: String,
    pub pool_exhausted_total: String,
    pub ingress_rejected_total: String,
    pub audio_frames_enqueued_total: String,
    pub cancellation_total: String,
    pub joined: bool,
}

#[napi(object)]
pub struct NativeSessionMetrics {
    pub event_queue: NativeEventQueueMetrics,
    pub polled_audio: NativePolledAudioMetrics,
    pub sources: Vec<NativeSourceMetrics>,
    pub external_sources: Vec<NativeExternalSourceMetrics>,
    pub routes: Vec<NativeRouteMetrics>,
    pub operators: Vec<NativeOperatorMetrics>,
    pub derived_routes: Vec<NativeDerivedRouteMetrics>,
    pub audio_reentries: Vec<NativeAudioReentryMetrics>,
    pub source_count: String,
    pub external_source_count: String,
    pub route_count: String,
    pub operator_count: String,
    pub derived_route_count: String,
    pub audio_reentry_count: String,
}

#[napi(object)]
pub struct NativeRecordingDiscontinuity {
    pub stem_id: String,
    pub label: String,
    pub kind: String,
    pub timestamp_start_ns: String,
    pub timestamp_end_ns: String,
    pub sequence_start: Option<String>,
    pub sequence_end: Option<String>,
}

#[napi(object)]
pub struct NativeRecordingStemOutcome {
    pub stem_name: String,
    pub frames_written_total: String,
    pub stale_frames_total: String,
    pub error: Option<String>,
    pub queue_capacity_frames: String,
    pub queue_peak_frames: String,
    pub frames_delivered_total: String,
    pub frames_dropped_total: String,
    pub queue_full_drops_total: String,
    pub discontinuities_total: String,
    pub discontinuities: Vec<NativeRecordingDiscontinuity>,
}

#[napi(object)]
pub struct NativeRecordingOutcome {
    pub session_id: String,
    pub group_id: String,
    pub complete: bool,
    pub state: String,
    pub completed_stems: String,
    pub failed_stems: String,
    pub session_directory: String,
    pub manifest_path: String,
    pub manifest_schema_version: u32,
    pub error_code: Option<String>,
    pub stems: Vec<NativeRecordingStemOutcome>,
}

#[napi(object)]
pub struct NativeTraceRecorderOutcome {
    pub path: String,
    pub records_attempted_total: String,
    pub records_enqueued_total: String,
    pub records_dropped_total: String,
    pub records_written_total: String,
    pub rolling_hash: String,
    pub complete: bool,
}

#[napi(object)]
pub struct NativeSessionTraceRecord {
    pub sequence_index: String,
    pub observed_at_ns: String,
    pub session_id: String,
    pub kind: String,
    pub lifecycle_state: Option<String>,
    pub terminal_state: Option<String>,
    pub stem_id: Option<String>,
    pub route_id: Option<String>,
    pub endpoint_id: Option<String>,
    pub endpoint_stage: Option<String>,
    pub rollback_stage: Option<String>,
    pub finalization_stage: Option<String>,
    pub source_failures_total: Option<String>,
    pub endpoint_failures_total: Option<String>,
    pub rollback_failures_total: Option<String>,
    pub finalization_failures_total: Option<String>,
}

#[napi(object)]
pub struct NativeSessionTraceValidation {
    pub session_id: String,
    pub lifecycle: Vec<String>,
    pub terminal_state: String,
    pub source_failures_total: String,
    pub endpoint_failures_total: String,
    pub rollback_failures_total: String,
    pub finalization_failures_total: String,
    pub records_validated_total: String,
}

#[napi(js_name = "NativeSessionTrace")]
pub struct NativeSessionTrace {
    trace: pocketstation::SessionTrace,
}

#[napi]
impl NativeSessionTrace {
    #[napi(factory)]
    pub fn read(path: String) -> napi::Result<Self> {
        pocketstation::SessionTrace::read(path)
            .map(|trace| Self { trace })
            .map_err(trace_error)
    }

    #[napi(getter)]
    pub fn session_id(&self) -> String {
        self.trace.session_id().get().to_string()
    }

    #[napi(getter)]
    pub fn records_total(&self) -> String {
        self.trace.records().len().to_string()
    }

    #[napi(getter)]
    pub fn outcome(&self) -> NativeTraceRecorderOutcome {
        trace_outcome(self.trace.outcome())
    }

    #[napi]
    pub fn records(&self) -> Vec<NativeSessionTraceRecord> {
        self.trace
            .records()
            .iter()
            .copied()
            .map(trace_record)
            .collect()
    }

    #[napi]
    pub fn validate(&self) -> napi::Result<NativeSessionTraceValidation> {
        self.trace
            .validate()
            .map(|validation| NativeSessionTraceValidation {
                session_id: validation.session_id.get().to_string(),
                lifecycle: validation
                    .lifecycle
                    .iter()
                    .copied()
                    .map(debug_name)
                    .collect(),
                terminal_state: debug_name(validation.terminal.state),
                source_failures_total: count(validation.terminal.source_failures_total),
                endpoint_failures_total: count(validation.terminal.endpoint_failures_total),
                rollback_failures_total: count(validation.terminal.rollback_failures_total),
                finalization_failures_total: count(validation.terminal.finalization_failures_total),
                records_validated_total: count(validation.records_validated_total),
            })
            .map_err(trace_error)
    }
}

pub(crate) fn copy_metrics(
    running: &pocketstation::RunningSession,
) -> Result<NativeSessionMetrics, String> {
    let snapshot = running
        .metrics_snapshot()
        .map_err(|failure| failure.to_string())?;
    let event_queue = snapshot.event_queue();
    let audio = snapshot.polled_audio();
    let sources: Vec<NativeSourceMetrics> = (0..snapshot.source_count())
        .filter_map(|index| snapshot.source(index).copied())
        .map(source_metrics)
        .collect();
    let routes: Vec<NativeRouteMetrics> = (0..snapshot.route_count())
        .filter_map(|index| snapshot.route(index).copied())
        .map(|route| route_metrics(running, route))
        .collect();
    let external_sources: Vec<NativeExternalSourceMetrics> = running
        .external_source_metrics()
        .into_vec()
        .into_iter()
        .map(external_source_metrics)
        .collect();
    let operators: Vec<NativeOperatorMetrics> = running
        .operator_metrics()
        .into_vec()
        .into_iter()
        .map(operator_metrics)
        .collect();
    let derived_routes: Vec<NativeDerivedRouteMetrics> = running
        .derived_route_metrics()
        .into_vec()
        .into_iter()
        .map(derived_route_metrics)
        .collect();
    let audio_reentries: Vec<NativeAudioReentryMetrics> = running
        .audio_reentry_metrics()
        .into_vec()
        .into_iter()
        .map(audio_reentry_metrics)
        .collect();
    let source_count = snapshot.source_count().to_string();
    let route_count = snapshot.route_count().to_string();
    let external_source_count = external_sources.len().to_string();
    let operator_count = operators.len().to_string();
    let derived_route_count = derived_routes.len().to_string();
    let audio_reentry_count = audio_reentries.len().to_string();
    Ok(NativeSessionMetrics {
        event_queue: NativeEventQueueMetrics {
            capacity_count: count(event_queue.capacity_event_count),
            maximum_event_owned_bytes: count(event_queue.maximum_event_owned_bytes),
            maximum_buffered_owned_bytes: count(event_queue.maximum_buffered_owned_bytes),
            depth_count: count(event_queue.depth_events),
            depth_owned_bytes: count(event_queue.depth_owned_bytes),
            peak_depth_count: count(event_queue.peak_depth_event_count),
            peak_depth_owned_bytes: count(event_queue.peak_depth_owned_bytes),
            enqueued_total: count(event_queue.events_enqueued_total),
            dropped_total: count(event_queue.events_dropped_total),
            dropped_oversized_total: count(event_queue.events_dropped_oversized_total),
            receiver_closed_total: count(event_queue.receiver_closed_total),
        },
        polled_audio: NativePolledAudioMetrics {
            registered_endpoints: count(audio.registered_endpoints),
            queue_capacity_frames: count(audio.queue_capacity_frames),
            queue_depth_frames: count(audio.queue_depth_frames),
            queue_peak_frames: count(audio.queue_peak_frames),
            queue_depth_invariant_failures_total: count(audio.queue_depth_invariant_failures_total),
            frames_received_total: count(audio.frames_received_total),
            frames_delivered_total: count(audio.frames_delivered_total),
            queue_full_drops_total: count(audio.queue_full_drops_total),
            invalid_ownership_drops_total: count(audio.invalid_ownership_drops_total),
            discarded_output_frames_total: count(running.audio_discarded_output_frames_total()),
            lease_capacity_count: count(audio.lease_capacity_count),
            outstanding_leases: count(audio.outstanding_leases),
            lease_exhausted_total: count(audio.lease_exhausted_total),
            batches_polled_total: count(audio.batches_polled_total),
            frames_polled_total: count(audio.frames_polled_total),
        },
        sources,
        external_sources,
        routes,
        operators,
        derived_routes,
        audio_reentries,
        source_count,
        external_source_count,
        route_count,
        operator_count,
        derived_route_count,
        audio_reentry_count,
    })
}

pub(crate) fn copy_recording_outcome(
    running: &pocketstation::RunningSession,
) -> Option<NativeRecordingOutcome> {
    let outcome = running.recording_outcome()?;
    Some(NativeRecordingOutcome {
        session_id: running.session_id().get().to_string(),
        group_id: pocketstation::DEFAULT_MULTISTEM_RECORDING_GROUP_ID.to_owned(),
        complete: outcome.state == pocketstation::SessionRecordingState::Complete,
        state: debug_name(outcome.state),
        completed_stems: outcome.completed_stems.to_string(),
        failed_stems: outcome.failed_stems.to_string(),
        session_directory: outcome.session_dir.display().to_string(),
        manifest_path: outcome
            .session_dir
            .join(pocketstation::SESSION_RECORDING_MANIFEST_FILE_NAME)
            .display()
            .to_string(),
        manifest_schema_version: pocketstation::SESSION_RECORDING_MANIFEST_SCHEMA_VERSION,
        error_code: pocketstation::session_recording_outcome_error_code(outcome)
            .map(|code| code.as_str().to_owned()),
        stems: outcome
            .stems
            .iter()
            .map(|stem| NativeRecordingStemOutcome {
                stem_name: stem.label.clone(),
                frames_written_total: count(stem.written_frames),
                stale_frames_total: count(stem.stale_frames),
                error: stem.error.clone(),
                queue_capacity_frames: count(stem.edge_observations.queue_capacity_frames),
                queue_peak_frames: count(stem.edge_observations.queue_peak_frames),
                frames_delivered_total: count(stem.edge_observations.frames_delivered_total),
                frames_dropped_total: count(stem.edge_observations.frames_dropped_total),
                queue_full_drops_total: count(stem.edge_observations.queue_full_drops_total),
                discontinuities_total: count(stem.edge_observations.discontinuities_total),
                discontinuities: stem
                    .gap_ranges
                    .iter()
                    .map(|record| NativeRecordingDiscontinuity {
                        stem_id: count(record.stem_id),
                        label: record.label.clone(),
                        kind: debug_name(record.kind),
                        timestamp_start_ns: count(record.timestamp_start_ns),
                        timestamp_end_ns: count(record.timestamp_end_ns),
                        sequence_start: record.sequence_start.map(count),
                        sequence_end: record.sequence_end.map(count),
                    })
                    .collect(),
            })
            .collect(),
    })
}

pub(crate) fn copy_trace_outcome(
    running: &pocketstation::RunningSession,
) -> (Option<NativeTraceRecorderOutcome>, Option<String>) {
    match running.session_trace_outcome() {
        None => (None, None),
        Some(Ok(outcome)) => (Some(trace_outcome(outcome)), None),
        Some(Err(failure)) => (None, Some(failure.to_string())),
    }
}

fn trace_outcome(
    outcome: &pocketstation::SessionTraceRecorderOutcome,
) -> NativeTraceRecorderOutcome {
    NativeTraceRecorderOutcome {
        path: outcome.path.display().to_string(),
        records_attempted_total: count(outcome.records_attempted_total),
        records_enqueued_total: count(outcome.records_enqueued_total),
        records_dropped_total: count(outcome.records_dropped_total),
        records_written_total: count(outcome.records_written_total),
        rolling_hash: count(outcome.rolling_hash),
        complete: outcome.is_complete(),
    }
}

fn trace_record(record: pocketstation::SessionTraceRecord) -> NativeSessionTraceRecord {
    let mut output = NativeSessionTraceRecord {
        sequence_index: count(record.sequence_index),
        observed_at_ns: count(record.observed_at_ns),
        session_id: record.session_id.get().to_string(),
        kind: String::new(),
        lifecycle_state: None,
        terminal_state: None,
        stem_id: None,
        route_id: None,
        endpoint_id: None,
        endpoint_stage: None,
        rollback_stage: None,
        finalization_stage: None,
        source_failures_total: None,
        endpoint_failures_total: None,
        rollback_failures_total: None,
        finalization_failures_total: None,
    };
    match record.kind {
        pocketstation::SessionTraceRecordKind::Lifecycle { state } => {
            output.kind = "lifecycle".to_owned();
            output.lifecycle_state = Some(debug_name(state));
        }
        pocketstation::SessionTraceRecordKind::SourceFailure { stem_id } => {
            output.kind = "source-failure".to_owned();
            output.stem_id = Some(stem_id.get().to_string());
        }
        pocketstation::SessionTraceRecordKind::EndpointFailure {
            route_id,
            endpoint_id,
            stage_code,
        } => {
            output.kind = "endpoint-failure".to_owned();
            output.route_id = Some(route_id.get().to_string());
            output.endpoint_id = Some(endpoint_id.get().to_string());
            output.endpoint_stage = endpoint_trace_stage_name(stage_code).map(str::to_owned);
        }
        pocketstation::SessionTraceRecordKind::RollbackFailure { stage } => {
            output.kind = "rollback-failure".to_owned();
            output.rollback_stage = Some(debug_name(stage));
        }
        pocketstation::SessionTraceRecordKind::FinalizationFailure { stage } => {
            output.kind = "finalization-failure".to_owned();
            output.finalization_stage = Some(debug_name(stage));
        }
        pocketstation::SessionTraceRecordKind::Terminal {
            state,
            source_failures_total,
            endpoint_failures_total,
            rollback_failures_total,
            finalization_failures_total,
        } => {
            output.kind = "terminal".to_owned();
            output.terminal_state = Some(debug_name(state));
            output.source_failures_total = Some(count(source_failures_total));
            output.endpoint_failures_total = Some(count(endpoint_failures_total));
            output.rollback_failures_total = Some(count(rollback_failures_total));
            output.finalization_failures_total = Some(count(finalization_failures_total));
        }
    }
    output
}

const fn endpoint_trace_stage_name(stage_code: u8) -> Option<&'static str> {
    match stage_code {
        1 => Some("prepare"),
        2 => Some("cancel-preparation"),
        3 => Some("start"),
        4 => Some("request-stop"),
        5 => Some("join-finalize"),
        _ => None,
    }
}

fn trace_error(failure: pocketstation::SessionTraceValidationError) -> napi::Error {
    let code = match failure {
        pocketstation::SessionTraceValidationError::Io(_) => "trace.io",
        pocketstation::SessionTraceValidationError::InvalidMagic => "trace.invalid_magic",
        pocketstation::SessionTraceValidationError::UnsupportedVersion => {
            "trace.unsupported_version"
        }
        pocketstation::SessionTraceValidationError::InvalidLayout => "trace.invalid_layout",
        pocketstation::SessionTraceValidationError::Truncated => "trace.truncated",
        pocketstation::SessionTraceValidationError::InvalidChecksum => "trace.invalid_checksum",
        pocketstation::SessionTraceValidationError::IncompleteTrace => "trace.incomplete",
        pocketstation::SessionTraceValidationError::SequenceGap => "trace.sequence_gap",
        pocketstation::SessionTraceValidationError::SessionMismatch => "trace.session_mismatch",
        pocketstation::SessionTraceValidationError::TimestampRegression => {
            "trace.timestamp_regression"
        }
        pocketstation::SessionTraceValidationError::InvalidLifecycleTransition => {
            "trace.invalid_lifecycle_transition"
        }
        pocketstation::SessionTraceValidationError::MissingTerminal => "trace.missing_terminal",
        pocketstation::SessionTraceValidationError::TerminalMismatch => "trace.terminal_mismatch",
        pocketstation::SessionTraceValidationError::RecordAfterTerminal => {
            "trace.record_after_terminal"
        }
        pocketstation::SessionTraceValidationError::UnknownRecordType => {
            "trace.unknown_record_type"
        }
    };
    error(code, failure.to_string())
}

fn source_metrics(value: pocketstation::SessionSourceMetrics) -> NativeSourceMetrics {
    let backend = value.capture.backend;
    let frame_stream = value.capture.frame_stream;
    let events = value.capture.runtime_events;
    let ingress = value.ingress;
    NativeSourceMetrics {
        stem_id: count(value.stem_id.get()),
        callback_buffers_total: count(backend.callback_buffers_total),
        capture_frames_enqueued_total: count(backend.frames_enqueued_total),
        capture_pool_exhausted_total: count(backend.pool_exhausted_total),
        capture_dispatch_queue_full_total: count(backend.dispatch_queue_full_total),
        capture_invalid_buffer_total: count(backend.invalid_buffer_total),
        capture_oversized_buffer_total: count(backend.oversized_buffer_total),
        capture_stream_errors_total: count(backend.stream_errors_total),
        capture_timestamp_epoch_clamps_total: count(backend.timestamp_epoch_clamps_total),
        frame_stream_delivered_frames_total: count(frame_stream.delivered_frames),
        frame_stream_dropped_newest_frames_total: count(frame_stream.dropped_newest_frames),
        frames_discarded_before_start_total: count(
            frame_stream.frames_discarded_before_start_total,
        ),
        runtime_event_queue: NativeEventQueueMetrics {
            capacity_count: count(events.capacity_event_count),
            maximum_event_owned_bytes: count(events.maximum_event_owned_bytes),
            maximum_buffered_owned_bytes: count(events.maximum_buffered_owned_bytes),
            depth_count: count(events.depth_events),
            depth_owned_bytes: count(events.depth_owned_bytes),
            peak_depth_count: count(0),
            peak_depth_owned_bytes: count(events.peak_depth_owned_bytes),
            enqueued_total: count(events.events_enqueued_total),
            dropped_total: count(events.events_dropped_total),
            dropped_oversized_total: count(events.events_dropped_oversized_total),
            receiver_closed_total: count(0),
        },
        ingress_queue_capacity_frames: count(ingress.queue_capacity_frames),
        ingress_queue_depth_frames: count(ingress.queue_depth_frames),
        ingress_queue_peak_frames: count(ingress.queue_peak_frames),
        ingress_frames_enqueued_total: count(ingress.frames_enqueued_total),
        ingress_frames_delivered_total: count(ingress.frames_delivered_total),
        ingress_frames_rejected_full_total: count(ingress.frames_rejected_full_total),
        ingress_frames_rejected_cancelled_total: count(ingress.frames_rejected_cancelled_total),
        ingress_frames_discarded_total: count(ingress.frames_discarded_total),
    }
}

fn external_source_metrics(
    value: pocketstation::SessionExternalSourceMetrics,
) -> NativeExternalSourceMetrics {
    let runtime = value.runtime;
    NativeExternalSourceMetrics {
        source_instance_id: count(value.source_instance_id.value()),
        source_id: count(value.source_id.get()),
        emitted_total: count(runtime.emitted_total),
        dropped_total: count(runtime.dropped_total),
        failure_total: count(runtime.failure_total),
        cancellation_total: count(runtime.cancellation_total),
        discontinuity_total: count(runtime.discontinuity_total),
        recovery_total: count(runtime.recovery_total),
        policy_change_total: count(runtime.policy_change_total),
        ready: runtime.ready,
        joined: runtime.joined,
    }
}

fn route_metrics(
    running: &pocketstation::RunningSession,
    value: pocketstation::SessionRouteMetrics,
) -> NativeRouteMetrics {
    NativeRouteMetrics {
        route_id: count(value.route_id.get()),
        endpoint_id: count(value.endpoint_id.get()),
        frames_attempted_total: count(value.edge.frames_attempted_total()),
        observation_interval: "route-lifetime-to-snapshot".to_owned(),
        drop_rate_pct: value.drop_observations().drop_rate_pct(),
        source_latency_measurement: "source-monotonic-timestamp-to-route-receive".to_owned(),
        source_latency_unit: "nanoseconds".to_owned(),
        delivery: delivery_metrics(
            value.edge,
            running.route_discarded_output_frames_total(value.route_id),
        ),
        endpoint: endpoint_metrics(
            value.endpoint_observation_stage,
            value.endpoint.unwrap_or_default(),
            value.endpoint_finalization_failures_total,
        ),
    }
}

fn delivery_metrics(
    edge: pocketstation::EdgeObservations,
    discarded_output_frames_total: Option<u64>,
) -> NativeRouteDeliveryMetrics {
    NativeRouteDeliveryMetrics {
        queue_capacity_frames: count(edge.queue_capacity_frames),
        queue_depth_frames: count(edge.queue_depth_frames),
        queue_peak_frames: count(edge.queue_peak_frames),
        frames_enqueued_total: count(edge.frames_enqueued_total),
        frames_delivered_total: count(edge.frames_delivered_total),
        frames_dropped_total: count(edge.frames_dropped_total),
        overruns_total: count(edge.overruns_total),
        receiver_unavailable_drops_total: count(edge.receiver_unavailable_drops_total),
        queue_full_drops_total: count(edge.queue_full_drops_total),
        shared_reference_exhausted_drops_total: count(edge.shared_reference_exhausted_drops_total),
        branch_pool_exhausted_drops_total: count(edge.branch_pool_exhausted_drops_total),
        invalid_copy_policy_drops_total: count(edge.invalid_copy_policy_drops_total),
        freeze_failed_drops_total: count(edge.freeze_failed_drops_total),
        discontinuities_total: count(edge.discontinuities_total),
        source_identity_discontinuities_total: count(edge.source_identity_discontinuities_total),
        sequence_discontinuities_total: count(edge.sequence_discontinuities_total),
        timestamp_discontinuities_total: count(edge.timestamp_discontinuities_total),
        lineage_epoch_discontinuities_total: count(edge.lineage_epoch_discontinuities_total),
        manually_reported_discontinuities_total: count(
            edge.manually_reported_discontinuities_total,
        ),
        enqueue_to_receive: NativeLatencyHistogram {
            samples_total: count(edge.enqueue_to_receive_samples_total),
            invalid_order_total: count(edge.enqueue_to_receive_invalid_order_total),
            missing_total: count(0),
            future_total: count(0),
            p50_ns: count(edge.enqueue_to_receive_p50_ns),
            p95_ns: count(edge.enqueue_to_receive_p95_ns),
            p99_ns: count(edge.enqueue_to_receive_p99_ns),
            max_ns: count(edge.enqueue_to_receive_max_ns),
        },
        source_timestamp_to_receive: NativeLatencyHistogram {
            samples_total: count(edge.source_timestamp_to_receive_samples_total),
            invalid_order_total: count(0),
            missing_total: count(edge.source_timestamp_to_receive_missing_total),
            future_total: count(edge.source_timestamp_to_receive_future_total),
            p50_ns: count(edge.source_timestamp_to_receive_p50_ns),
            p95_ns: count(edge.source_timestamp_to_receive_p95_ns),
            p99_ns: count(edge.source_timestamp_to_receive_p99_ns),
            max_ns: count(edge.source_timestamp_to_receive_max_ns),
        },
        worker_failures_total: count(edge.worker_failures_total),
        shutdown_discarded_total: count(edge.shutdown_discarded_total),
        discarded_output_frames_total: discarded_output_frames_total.map(count),
    }
}

fn endpoint_metrics(
    stage: impl std::fmt::Debug,
    value: pocketstation::EndpointDriverObservations,
    finalization_failures_total: u64,
) -> NativeEndpointMetrics {
    NativeEndpointMetrics {
        observation_stage: format!("{stage:?}").to_ascii_lowercase(),
        frames_received_total: count(value.frames_received_total),
        frames_delivered_total: count(value.frames_delivered_total),
        frames_dropped_total: count(value.frames_dropped_total),
        discontinuities_total: count(value.discontinuities_total),
        failures_total: count(value.failures_total),
        finalization_failures_total: count(finalization_failures_total),
    }
}

fn operator_metrics(value: pocketstation::SessionOperatorMetrics) -> NativeOperatorMetrics {
    NativeOperatorMetrics {
        operator_instance_id: count(value.operator_instance_id.value()),
        input_delivery: delivery_metrics(value.input_delivery, None),
        input_ports: value
            .input_ports
            .into_vec()
            .into_iter()
            .map(|port| NativeOperatorInputMetrics {
                port_name: port.port_name,
                delivery: delivery_metrics(port.edge, None),
            })
            .collect(),
        worker: NativeOperatorWorkerMetrics {
            input_attempted_total: count(value.worker.input_attempted_total),
            input_dropped_total: count(value.worker.input_dropped_total),
            processed_total: count(value.worker.processed_total),
            output_emitted_total: count(value.worker.output_emitted_total),
            output_dropped_total: count(value.worker.output_dropped_total),
            output_nonterminal_total: count(value.worker.output_nonterminal_total),
            output_terminal_total: count(value.worker.output_terminal_total),
            process_failure_total: count(value.worker.process_failure_total),
            timeout_total: count(value.worker.timeout_total),
            cancellation_total: count(value.worker.cancellation_total),
            graceful_finish_total: count(value.worker.graceful_finish_total),
            idle_poll_total: count(value.worker.idle_poll_total),
            ready: value.worker.ready,
            joined: value.worker.joined,
        },
        finalization_failures_total: count(value.finalization_failures_total),
    }
}

fn signal_queue_metrics(
    value: pocketstation::AsyncOperatorOutputObservations,
) -> NativeSignalQueueMetrics {
    NativeSignalQueueMetrics {
        capacity_signals: count(value.capacity_signals),
        max_payload_bytes: count(value.max_payload_bytes),
        maximum_buffered_payload_bytes: count(value.maximum_buffered_payload_bytes),
        depth_signals: count(value.depth_signals),
        peak_depth_signals: count(value.peak_depth_signals),
        enqueued_total: count(value.enqueued_total),
        received_total: count(value.received_total),
        dropped_total: count(value.dropped_total),
    }
}

fn derived_route_metrics(
    value: pocketstation::SessionDerivedRouteMetrics,
) -> NativeDerivedRouteMetrics {
    NativeDerivedRouteMetrics {
        route_id: count(value.route_id.get()),
        endpoint_id: count(value.endpoint_id.get()),
        output: signal_queue_metrics(value.output),
        endpoint: endpoint_metrics(
            value.endpoint_observation_stage,
            value.endpoint.unwrap_or_default(),
            value.endpoint_finalization_failures_total,
        ),
    }
}

fn audio_reentry_metrics(
    value: pocketstation::SessionAudioReentryMetrics,
) -> NativeAudioReentryMetrics {
    NativeAudioReentryMetrics {
        operator_instance_id: count(value.operator_instance_id().value()),
        stem_id: count(value.stem_id().get()),
        queue_capacity_signals: count(value.queue_capacity_signals()),
        queue_depth_signals: count(value.queue_depth_signals()),
        queue_peak_signals: count(value.queue_peak_signals()),
        signals_enqueued_total: count(value.signals_enqueued_total()),
        signals_received_total: count(value.signals_received_total()),
        signals_dropped_total: count(value.signals_dropped_total()),
        pool_slots: count(value.pool_slots()),
        frame_capacity_samples: count(value.frame_capacity_samples()),
        maximum_buffered_audio_bytes: count(value.maximum_buffered_audio_bytes()),
        normalized_total: count(value.normalized_total()),
        invalid_total: count(value.invalid_total()),
        shared_audio_rejected_total: count(value.shared_audio_rejected_total()),
        pool_exhausted_total: count(value.pool_exhausted_total()),
        ingress_rejected_total: count(value.ingress_rejected_total()),
        audio_frames_enqueued_total: count(value.audio_frames_enqueued_total()),
        cancellation_total: count(value.cancellation_total()),
        joined: value.joined(),
    }
}

fn count(value: u64) -> String {
    value.to_string()
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
