use napi::Result;
use napi_derive::napi;
use pocketstation::{
    AudioCaps, BackpressurePolicy, BinaryFormat, ChannelLayout, Codec, CopyPolicy, DeliveryPolicy,
    DeliverySemantics, EndpointConfiguration, EndpointDescriptor, EventFormat, LossPolicy,
    MediaCaps, Multiplicity, Operator, OperatorConfiguration, OperatorId, OperatorInputHandle,
    OperatorInstanceHandle, PortDirection, PortSpec, RouteObservability, RouteSettings,
    SampleFormat, SignalClass, SignalSpec, TextFormat,
};

use crate::errors::error;
use crate::session::{NativeEndpoint, NativeStem};

fn invalid(reason: impl Into<String>) -> napi::Error {
    let reason = reason.into();
    error("graph.invalid_declaration", reason)
}

fn require_text(name: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(invalid(format!("{name} cannot be empty")))
    } else {
        Ok(())
    }
}

fn parse_codec(value: &str) -> Result<Codec> {
    match value {
        "opus" => Ok(Codec::Opus),
        "aac" => Ok(Codec::Aac),
        "mp3" => Ok(Codec::Mp3),
        "g711-ulaw" => Ok(Codec::G711Ulaw),
        "g711-alaw" => Ok(Codec::G711Alaw),
        "webm-opus" => Ok(Codec::WebmOpus),
        _ => Err(invalid(format!("unsupported codec {value:?}"))),
    }
}

fn codec_name(value: Codec) -> &'static str {
    match value {
        Codec::Opus => "opus",
        Codec::Aac => "aac",
        Codec::Mp3 => "mp3",
        Codec::G711Ulaw => "g711-ulaw",
        Codec::G711Alaw => "g711-alaw",
        Codec::WebmOpus => "webm-opus",
    }
}

fn parse_text_format(value: &str) -> Result<TextFormat> {
    match value {
        "utf8" => Ok(TextFormat::Utf8),
        "json" => Ok(TextFormat::Json),
        "markdown" => Ok(TextFormat::Markdown),
        _ => Err(invalid(format!("unsupported text format {value:?}"))),
    }
}

fn text_format_name(value: TextFormat) -> &'static str {
    match value {
        TextFormat::Utf8 => "utf8",
        TextFormat::Json => "json",
        TextFormat::Markdown => "markdown",
    }
}

fn parse_event_format(value: &str) -> Result<EventFormat> {
    match value {
        "json" => Ok(EventFormat::Json),
        "protobuf" => Ok(EventFormat::Protobuf),
        "flatbuffers" => Ok(EventFormat::Flatbuffers),
        "cbor" => Ok(EventFormat::Cbor),
        _ => Err(invalid(format!("unsupported event format {value:?}"))),
    }
}

fn event_format_name(value: EventFormat) -> &'static str {
    match value {
        EventFormat::Json => "json",
        EventFormat::Protobuf => "protobuf",
        EventFormat::Flatbuffers => "flatbuffers",
        EventFormat::Cbor => "cbor",
    }
}

fn parse_binary_format(value: &str) -> Result<BinaryFormat> {
    match value {
        "raw" => Ok(BinaryFormat::Raw),
        "protobuf" => Ok(BinaryFormat::Protobuf),
        "flatbuffers" => Ok(BinaryFormat::Flatbuffers),
        "cbor" => Ok(BinaryFormat::Cbor),
        _ => Err(invalid(format!("unsupported binary format {value:?}"))),
    }
}

fn binary_format_name(value: BinaryFormat) -> &'static str {
    match value {
        BinaryFormat::Raw => "raw",
        BinaryFormat::Protobuf => "protobuf",
        BinaryFormat::Flatbuffers => "flatbuffers",
        BinaryFormat::Cbor => "cbor",
    }
}

#[napi(object)]
pub struct NativeSignalOptions {
    pub format: Option<String>,
    pub custom_id: Option<String>,
    pub role: Option<String>,
    pub schema: Option<String>,
}

#[napi(js_name = "NativeSignalSpec")]
#[derive(Clone)]
pub struct NativeSignalSpec {
    pub(crate) value: SignalSpec,
}

#[napi]
impl NativeSignalSpec {
    #[napi(constructor)]
    pub fn new(kind: String, options: Option<NativeSignalOptions>) -> Result<Self> {
        let options = options.unwrap_or(NativeSignalOptions {
            format: None,
            custom_id: None,
            role: None,
            schema: None,
        });
        let mut value = match kind.as_str() {
            "any" => SignalSpec::any(),
            "pcm-audio" => SignalSpec::audio(),
            "encoded-audio" => SignalSpec::encoded_audio(parse_codec(
                options
                    .format
                    .as_deref()
                    .ok_or_else(|| invalid("encoded audio requires a codec"))?,
            )?),
            "text" => SignalSpec::text(parse_text_format(
                options.format.as_deref().unwrap_or("utf8"),
            )?),
            "event" => SignalSpec::event(parse_event_format(
                options.format.as_deref().unwrap_or("json"),
            )?),
            "metrics" => SignalSpec::metrics(),
            "control" => SignalSpec::control(),
            "binary" => SignalSpec::binary(parse_binary_format(
                options.format.as_deref().unwrap_or("raw"),
            )?),
            "custom" => SignalSpec::custom(
                options
                    .custom_id
                    .ok_or_else(|| invalid("custom signal requires a stable identifier"))?,
            ),
            _ => return Err(invalid(format!("unsupported signal kind {kind:?}"))),
        };
        if let Some(role) = options.role {
            value = value.with_role(role);
        }
        if let Some(schema) = options.schema {
            value = value.with_schema(schema);
        }
        value
            .validate()
            .map_err(|failure| invalid(failure.to_string()))?;
        Ok(Self { value })
    }

    #[napi(getter)]
    pub fn kind(&self) -> &'static str {
        match self.value.class() {
            SignalClass::Any => "any",
            SignalClass::PcmAudio => "pcm-audio",
            SignalClass::EncodedAudio(_) => "encoded-audio",
            SignalClass::Text(_) => "text",
            SignalClass::Event(_) => "event",
            SignalClass::Metrics => "metrics",
            SignalClass::Control => "control",
            SignalClass::Binary(_) => "binary",
            SignalClass::Custom(_) => "custom",
        }
    }

    #[napi(getter)]
    pub fn format(&self) -> Option<&'static str> {
        match self.value.class() {
            SignalClass::EncodedAudio(value) => Some(codec_name(*value)),
            SignalClass::Text(value) => Some(text_format_name(*value)),
            SignalClass::Event(value) => Some(event_format_name(*value)),
            SignalClass::Binary(value) => Some(binary_format_name(*value)),
            _ => None,
        }
    }

    #[napi(getter)]
    pub fn custom_id(&self) -> Option<String> {
        match self.value.class() {
            SignalClass::Custom(value) => Some(value.as_str().to_owned()),
            _ => None,
        }
    }

    #[napi(getter)]
    pub fn role(&self) -> Option<String> {
        self.value.role().map(|value| value.as_str().to_owned())
    }

    #[napi(getter)]
    pub fn schema(&self) -> Option<String> {
        self.value.schema().map(|value| value.as_str().to_owned())
    }

    #[napi(getter)]
    pub fn wire_id(&self) -> String {
        self.value.wire_id().to_owned()
    }

    #[napi(getter)]
    pub fn is_audio(&self) -> bool {
        self.value.class().is_audio()
    }

    #[napi]
    pub fn is_compatible_with(&self, other: &NativeSignalSpec) -> bool {
        self.value.is_compatible_with(&other.value)
    }
}

#[napi(object)]
pub struct NativeMediaOptions {
    pub format: Option<String>,
    pub sample_rate_hz: Option<u32>,
    pub frame_samples: Option<u32>,
    pub channel_layout: Option<String>,
}

#[napi(js_name = "NativeMediaCaps")]
#[derive(Clone, Copy)]
pub struct NativeMediaCaps {
    pub(crate) value: MediaCaps,
}

#[napi]
impl NativeMediaCaps {
    #[napi(constructor)]
    pub fn new(kind: String, options: Option<NativeMediaOptions>) -> Result<Self> {
        let options = options.unwrap_or(NativeMediaOptions {
            format: None,
            sample_rate_hz: None,
            frame_samples: None,
            channel_layout: None,
        });
        if options.sample_rate_hz == Some(0) {
            return Err(invalid("sampleRateHz must be greater than zero"));
        }
        if options.frame_samples == Some(0) {
            return Err(invalid("frameSamples must be greater than zero"));
        }
        let value = match kind.as_str() {
            "audio-pcm" => MediaCaps::Audio(AudioCaps {
                sample_rate_hz: options.sample_rate_hz,
                frame_samples: options.frame_samples.map(|value| value as usize),
                channel_layout: match options.channel_layout.as_deref().unwrap_or("any") {
                    "mono" => ChannelLayout::Mono,
                    "stereo" => ChannelLayout::Stereo,
                    "any" => ChannelLayout::Any,
                    value => return Err(invalid(format!("unsupported channel layout {value:?}"))),
                },
                format: SampleFormat::F32Interleaved,
            }),
            "audio-encoded" => MediaCaps::EncodedAudio(parse_codec(
                options
                    .format
                    .as_deref()
                    .ok_or_else(|| invalid("encoded audio requires a codec"))?,
            )?),
            "text" => MediaCaps::Text,
            "event" => MediaCaps::Event,
            "metrics" => MediaCaps::Metrics,
            "control" => MediaCaps::Control,
            "binary" => MediaCaps::Binary(parse_binary_format(
                options.format.as_deref().unwrap_or("raw"),
            )?),
            "any" => MediaCaps::Any,
            _ => return Err(invalid(format!("unsupported media kind {kind:?}"))),
        };
        Ok(Self { value })
    }

    #[napi(getter)]
    pub fn kind(&self) -> &'static str {
        match self.value {
            MediaCaps::Audio(_) => "audio-pcm",
            MediaCaps::EncodedAudio(_) => "audio-encoded",
            MediaCaps::Text => "text",
            MediaCaps::Event => "event",
            MediaCaps::Metrics => "metrics",
            MediaCaps::Control => "control",
            MediaCaps::Binary(_) => "binary",
            MediaCaps::Any => "any",
        }
    }

    #[napi(getter)]
    pub fn format(&self) -> Option<&'static str> {
        match self.value {
            MediaCaps::Audio(_) => Some("f32-interleaved"),
            MediaCaps::EncodedAudio(value) => Some(codec_name(value)),
            MediaCaps::Binary(value) => Some(binary_format_name(value)),
            _ => None,
        }
    }

    #[napi(getter)]
    pub fn sample_rate_hz(&self) -> Option<u32> {
        match self.value {
            MediaCaps::Audio(value) => value.sample_rate_hz,
            _ => None,
        }
    }

    #[napi(getter)]
    pub fn frame_samples(&self) -> Option<u32> {
        match self.value {
            MediaCaps::Audio(value) => value.frame_samples.and_then(|value| value.try_into().ok()),
            _ => None,
        }
    }

    #[napi(getter)]
    pub fn channel_layout(&self) -> Option<&'static str> {
        match self.value {
            MediaCaps::Audio(value) => Some(match value.channel_layout {
                ChannelLayout::Mono => "mono",
                ChannelLayout::Stereo => "stereo",
                ChannelLayout::Any => "any",
            }),
            _ => None,
        }
    }

    #[napi]
    pub fn is_compatible_with(&self, other: &NativeMediaCaps) -> bool {
        self.value.is_compatible_with(&other.value)
    }

    #[napi]
    pub fn negotiate(&self, other: &NativeMediaCaps) -> Option<NativeMediaCaps> {
        self.value
            .negotiate(&other.value)
            .map(|value| NativeMediaCaps { value })
    }

    #[napi]
    pub fn supports_signal(&self, signal: &NativeSignalSpec) -> bool {
        self.value.supports_signal(&signal.value)
    }
}

#[napi(js_name = "NativePortSpec")]
#[derive(Clone)]
pub struct NativePortSpec {
    pub(crate) value: PortSpec,
}

#[napi]
impl NativePortSpec {
    #[napi(constructor)]
    pub fn new(
        name: String,
        direction: String,
        signal: &NativeSignalSpec,
        media: &NativeMediaCaps,
        multiplicity: String,
        required: bool,
    ) -> Result<Self> {
        let direction = match direction.as_str() {
            "input" => PortDirection::Input,
            "output" => PortDirection::Output,
            _ => return Err(invalid("port direction must be input or output")),
        };
        let multiplicity = match multiplicity.as_str() {
            "one" => Multiplicity::One,
            "many" => Multiplicity::Many,
            _ => return Err(invalid("port multiplicity must be one or many")),
        };
        let value = PortSpec::new(
            name,
            direction,
            signal.value.clone(),
            media.value,
            multiplicity,
            required,
        )
        .map_err(|failure| invalid(failure.to_string()))?;
        Ok(Self { value })
    }

    #[napi(getter)]
    pub fn name(&self) -> String {
        self.value.name().to_owned()
    }

    #[napi(getter)]
    pub fn direction(&self) -> &'static str {
        match self.value.direction() {
            PortDirection::Input => "input",
            PortDirection::Output => "output",
        }
    }

    #[napi(getter)]
    pub fn signal(&self) -> NativeSignalSpec {
        NativeSignalSpec {
            value: self.value.signal().clone(),
        }
    }

    #[napi(getter)]
    pub fn media(&self) -> NativeMediaCaps {
        NativeMediaCaps {
            value: self.value.media(),
        }
    }

    #[napi(getter)]
    pub fn multiplicity(&self) -> &'static str {
        match self.value.multiplicity() {
            Multiplicity::One => "one",
            Multiplicity::Many => "many",
        }
    }

    #[napi(getter)]
    pub fn required(&self) -> bool {
        self.value.required()
    }
}

#[napi(js_name = "NativeDeliveryPolicy")]
#[derive(Clone, Copy)]
pub struct NativeDeliveryPolicy {
    pub(crate) value: DeliveryPolicy,
}

#[napi]
impl NativeDeliveryPolicy {
    #[napi(factory)]
    pub fn realtime_audio() -> Self {
        Self {
            value: DeliveryPolicy::realtime_audio(),
        }
    }

    #[napi(factory)]
    pub fn buffered() -> Self {
        Self {
            value: DeliveryPolicy::bounded_async(),
        }
    }

    #[napi]
    pub fn with_backpressure(&self, value: String) -> Result<Self> {
        let value = match value.as_str() {
            "drop-newest" => BackpressurePolicy::DropNewest,
            "drop-oldest" => BackpressurePolicy::DropOldest,
            "buffer" => BackpressurePolicy::BoundedQueue,
            "fail" => BackpressurePolicy::BlockForbidden,
            _ => {
                return Err(invalid(format!(
                    "unsupported queue-pressure behavior {value:?}"
                )))
            }
        };
        Ok(Self {
            value: self.value.with_backpressure(value),
        })
    }

    #[napi]
    pub fn with_copy_policy(&self, value: String) -> Result<Self> {
        let value = match value.as_str() {
            "move" => CopyPolicy::MoveExclusive,
            "share" => CopyPolicy::ShareReadOnly,
            "copy" => CopyPolicy::CopyToBranchPool,
            _ => return Err(invalid(format!("unsupported frame ownership {value:?}"))),
        };
        Ok(Self {
            value: self.value.with_copy_policy(value),
        })
    }

    #[napi]
    pub fn with_jitter_budget_ms(&self, value: Option<u32>) -> Self {
        Self {
            value: self.value.with_jitter_budget_ms(value),
        }
    }

    #[napi]
    pub fn with_max_payload_bytes(&self, value: u32) -> Result<Self> {
        if value == 0 || value as usize > pocketstation::graph::MAX_ASYNC_PAYLOAD_BYTES {
            return Err(invalid(format!(
                "maxPayloadBytes must be between 1 and {}",
                pocketstation::graph::MAX_ASYNC_PAYLOAD_BYTES
            )));
        }
        Ok(Self {
            value: self.value.with_max_payload_bytes(value as usize),
        })
    }

    #[napi(getter)]
    pub fn clock(&self) -> &'static str {
        clock_name(self.value.clock())
    }

    #[napi(getter)]
    pub fn latency_budget_ms(&self) -> Option<u32> {
        self.value.latency_budget_ms()
    }

    #[napi(getter)]
    pub fn jitter_budget_ms(&self) -> Option<u32> {
        self.value.jitter_budget_ms()
    }

    #[napi(getter)]
    pub fn backpressure(&self) -> &'static str {
        backpressure_name(self.value.backpressure())
    }

    #[napi(getter)]
    pub fn delivery(&self) -> &'static str {
        delivery_name(self.value.delivery())
    }

    #[napi(getter)]
    pub fn loss(&self) -> &'static str {
        loss_name(self.value.loss())
    }

    #[napi(getter)]
    pub fn copy_policy(&self) -> &'static str {
        copy_name(self.value.copy_policy())
    }

    #[napi(getter)]
    pub fn observability(&self) -> &'static str {
        observability_name(self.value.observability())
    }

    #[napi(getter)]
    pub fn max_payload_bytes(&self) -> Option<u32> {
        self.value
            .max_payload_bytes()
            .and_then(|value| value.try_into().ok())
    }
}

#[napi(js_name = "NativeRouteSettings")]
#[derive(Clone, Copy)]
pub struct NativeRouteSettings {
    pub(crate) value: RouteSettings,
}

#[napi]
impl NativeRouteSettings {
    #[napi(factory)]
    pub fn realtime_audio() -> Self {
        Self {
            value: RouteSettings::realtime_audio(),
        }
    }

    #[napi(factory)]
    pub fn buffered() -> Self {
        Self {
            value: RouteSettings::bounded_async(),
        }
    }

    #[napi(constructor)]
    pub fn new(media: &NativeMediaCaps, delivery: &NativeDeliveryPolicy) -> Self {
        Self {
            value: RouteSettings::new(media.value, delivery.value),
        }
    }

    #[napi]
    pub fn with_media(&self, media: &NativeMediaCaps) -> Self {
        Self {
            value: self.value.with_media(media.value),
        }
    }

    #[napi]
    pub fn with_delivery(&self, delivery: &NativeDeliveryPolicy) -> Self {
        Self {
            value: self.value.with_delivery_policy(delivery.value),
        }
    }

    #[napi(getter)]
    pub fn media(&self) -> NativeMediaCaps {
        NativeMediaCaps {
            value: self.value.media(),
        }
    }

    #[napi(getter)]
    pub fn delivery_policy(&self) -> NativeDeliveryPolicy {
        NativeDeliveryPolicy {
            value: self.value.delivery_policy(),
        }
    }
}

fn clock_name(value: pocketstation::ClockDomain) -> &'static str {
    match value {
        pocketstation::ClockDomain::Capture => "capture",
        pocketstation::ClockDomain::Playback => "playback",
        pocketstation::ClockDomain::Network => "network",
        pocketstation::ClockDomain::Inherited => "inherited",
        pocketstation::ClockDomain::Wallclock => "wallclock",
    }
}

fn backpressure_name(value: BackpressurePolicy) -> &'static str {
    match value {
        BackpressurePolicy::DropNewest => "drop-newest",
        BackpressurePolicy::DropOldest => "drop-oldest",
        BackpressurePolicy::BoundedQueue => "buffer",
        BackpressurePolicy::BlockForbidden => "fail",
    }
}

fn delivery_name(value: DeliverySemantics) -> &'static str {
    match value {
        DeliverySemantics::BestEffortRealtime => "best-effort-realtime",
        DeliverySemantics::Ordered => "ordered",
        DeliverySemantics::ExactlyOnceNotRealtime => "exactly-once-not-realtime",
    }
}

fn loss_name(value: LossPolicy) -> &'static str {
    match value {
        LossPolicy::ConcealForAudio => "conceal-audio",
        LossPolicy::MustDeliverOrFail => "deliver-or-fail",
        LossPolicy::DropAllowed => "drop-allowed",
    }
}

fn copy_name(value: CopyPolicy) -> &'static str {
    match value {
        CopyPolicy::MoveExclusive => "move",
        CopyPolicy::ShareReadOnly => "share",
        CopyPolicy::CopyToBranchPool => "copy",
    }
}

fn observability_name(value: RouteObservability) -> &'static str {
    match value {
        RouteObservability::Off => "off",
        RouteObservability::Counters => "counters",
        RouteObservability::Full => "full",
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct NativeConfigurationEntry {
    pub key: String,
    pub value: String,
    pub sensitive: Option<bool>,
}

fn operator_configuration(entries: Vec<NativeConfigurationEntry>) -> Result<OperatorConfiguration> {
    let mut result = OperatorConfiguration::new();
    for entry in entries {
        require_text("configuration key", &entry.key)?;
        result = if entry.sensitive.unwrap_or(false) {
            result.with_sensitive(&entry.key, &entry.value)
        } else {
            result.with(&entry.key, &entry.value)
        };
    }
    Ok(result)
}

fn endpoint_configuration(entries: Vec<NativeConfigurationEntry>) -> Result<EndpointConfiguration> {
    let mut result = EndpointConfiguration::new();
    for entry in entries {
        require_text("configuration key", &entry.key)?;
        result = if entry.sensitive.unwrap_or(false) {
            result.with_sensitive(entry.key, entry.value)
        } else {
            result.with(entry.key, entry.value)
        };
    }
    Ok(result)
}

#[napi(js_name = "NativeOperator")]
#[derive(Clone)]
pub struct NativeOperator {
    pub(crate) value: Operator,
}

#[napi]
impl NativeOperator {
    #[napi(constructor)]
    pub fn new(
        operator_id: String,
        configuration: Option<Vec<NativeConfigurationEntry>>,
    ) -> Result<Self> {
        require_text("operator identifier", &operator_id)?;
        Ok(Self {
            value: Operator::new(
                OperatorId::new(operator_id),
                operator_configuration(configuration.unwrap_or_default())?,
            ),
        })
    }
}

#[napi(js_name = "NativeEndpointDefinition")]
#[derive(Clone)]
pub struct NativeEndpointDefinition {
    pub(crate) value: EndpointDescriptor,
}

#[napi]
impl NativeEndpointDefinition {
    #[napi(constructor)]
    pub fn new(
        node_type: String,
        operator_id: String,
        configuration: Option<Vec<NativeConfigurationEntry>>,
        route: Option<&NativeRouteSettings>,
    ) -> Result<Self> {
        require_text("Endpoint node type", &node_type)?;
        require_text("Endpoint operator identifier", &operator_id)?;
        let mut value = EndpointDescriptor::new(
            pocketstation::NodeTypeId::from(node_type.as_str()),
            OperatorId::new(operator_id),
        )
        .with_configuration(endpoint_configuration(configuration.unwrap_or_default())?);
        if let Some(route) = route {
            value = value.with_route_settings(route.value);
        }
        Ok(Self { value })
    }
}

#[napi(js_name = "NativeOperatorInput")]
pub struct NativeOperatorInput {
    pub(crate) session_id: u64,
    pub(crate) handle: OperatorInputHandle,
    #[napi(readonly)]
    pub port_name: String,
}

#[napi(js_name = "NativeOperatorInstance")]
pub struct NativeOperatorInstance {
    pub(crate) session_id: u64,
    pub(crate) handle: OperatorInstanceHandle,
}

#[napi]
impl NativeOperatorInstance {
    #[napi(getter)]
    pub fn instance_id(&self) -> String {
        self.handle.instance_id().value().to_string()
    }

    #[napi]
    pub fn input(&self, port_name: String) -> Result<NativeOperatorInput> {
        require_text("operator input port", &port_name)?;
        let handle = self
            .handle
            .input(port_name.clone())
            .map_err(|failure| invalid(failure.to_string()))?;
        Ok(NativeOperatorInput {
            session_id: self.session_id,
            handle,
            port_name,
        })
    }

    #[napi]
    pub fn output(&self, port_name: String) -> Result<NativeDerivedStream> {
        require_text("operator output port", &port_name)?;
        self.handle
            .output(port_name)
            .map(|handle| NativeDerivedStream {
                session_id: self.session_id,
                handle,
            })
            .map_err(|failure| invalid(failure.to_string()))
    }
}

#[napi(js_name = "NativeDerivedStream")]
pub struct NativeDerivedStream {
    pub(crate) session_id: u64,
    pub(crate) handle: pocketstation::DerivedStreamHandle,
}

#[napi]
impl NativeDerivedStream {
    #[napi(getter)]
    pub fn operator_instance_id(&self) -> String {
        self.handle.operator_instance_id().value().to_string()
    }

    #[napi(getter)]
    pub fn output_port(&self) -> Option<String> {
        self.handle.output_port().map(str::to_owned)
    }

    #[napi]
    pub fn output(&self, port_name: String) -> Result<Self> {
        require_text("operator output port", &port_name)?;
        self.handle
            .output(port_name)
            .map(|handle| Self {
                session_id: self.session_id,
                handle,
            })
            .map_err(|failure| invalid(failure.to_string()))
    }

    #[napi]
    pub fn connect(&self, input: &NativeOperatorInput) -> Result<String> {
        require_same_session(self.session_id, input.session_id)?;
        self.handle
            .connect(input.handle.clone())
            .map(|value| value.get().to_string())
            .map_err(|failure| invalid(failure.to_string()))
    }

    #[napi]
    pub fn send(&self, endpoint: &NativeEndpoint, input_port: Option<String>) -> Result<String> {
        require_same_session(self.session_id, endpoint.session_id)?;
        self.handle
            .send_to(endpoint.handle, input_port)
            .map(|value| value.get().to_string())
            .map_err(|failure| invalid(failure.to_string()))
    }

    #[napi]
    pub fn through(
        &self,
        operator: &NativeOperator,
        input_port: Option<String>,
        output_port: Option<String>,
    ) -> Result<Self> {
        self.handle
            .through_ports(operator.value.clone(), input_port, output_port)
            .map(|handle| Self {
                session_id: self.session_id,
                handle,
            })
            .map_err(|failure| invalid(failure.to_string()))
    }

    #[napi]
    pub fn reenter_audio(&self) -> Result<NativeStem> {
        self.handle
            .reenter_audio()
            .map(|handle| NativeStem {
                session_id: self.session_id,
                handle,
            })
            .map_err(|failure| invalid(failure.to_string()))
    }
}

fn require_same_session(left: u64, right: u64) -> Result<()> {
    if left == right {
        Ok(())
    } else {
        Err(error(
            "session.mismatched_resource",
            "resources belong to different Sessions",
        ))
    }
}

impl NativeStem {
    pub(crate) fn connect_input(&self, input: &NativeOperatorInput) -> Result<String> {
        require_same_session(self.session_id, input.session_id)?;
        self.handle
            .connect(input.handle.clone())
            .map(|value| value.get().to_string())
            .map_err(|failure| invalid(failure.to_string()))
    }

    pub(crate) fn through_operator(
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
            .map_err(|failure| invalid(failure.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signal_validation_and_media_negotiation_use_core() {
        let signal = NativeSignalSpec::new(
            "text".to_owned(),
            Some(NativeSignalOptions {
                format: Some("json".to_owned()),
                custom_id: None,
                role: Some("transcript.final".to_owned()),
                schema: None,
            }),
        )
        .expect("signal");
        let media = NativeMediaCaps::new("text".to_owned(), None).expect("media");
        assert_eq!(signal.wire_id(), "pks.signal.text.json.v1");
        assert!(media.supports_signal(&signal));
    }

    #[test]
    fn invalid_port_is_rejected_by_core() {
        let signal = NativeSignalSpec::new("pcm-audio".to_owned(), None).expect("signal");
        let media = NativeMediaCaps::new("text".to_owned(), None).expect("media");
        assert!(NativePortSpec::new(
            "audio".to_owned(),
            "input".to_owned(),
            &signal,
            &media,
            "one".to_owned(),
            true,
        )
        .is_err());
    }

    #[test]
    fn zero_audio_requirements_are_rejected_before_compilation() {
        let invalid_rate = NativeMediaCaps::new(
            "audio-pcm".to_owned(),
            Some(NativeMediaOptions {
                format: None,
                sample_rate_hz: Some(0),
                frame_samples: None,
                channel_layout: None,
            }),
        );
        let invalid_frame = NativeMediaCaps::new(
            "audio-pcm".to_owned(),
            Some(NativeMediaOptions {
                format: None,
                sample_rate_hz: None,
                frame_samples: Some(0),
                channel_layout: None,
            }),
        );
        assert!(invalid_rate.is_err());
        assert!(invalid_frame.is_err());
    }
}
