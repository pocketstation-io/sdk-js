use std::sync::Mutex;

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Result, Task};
use napi_derive::napi;
use pocketstation::{
    ApplicationPolicyObservation, ApplicationSelector, CaptureAuthorizationSnapshot,
    CaptureOpenOutcome, CapturePermissionLifecycle, CaptureScope, CaptureSessionGrant,
    CaptureSource, DeviceId, DeviceSelector, PermissionEpoch, PermissionObservation, Platform,
    ProcessId, ProcessTreeScope, SelectorPersistenceScope, SourceIdentityStrength, SourceKind,
    SourceLifecycleEventKind, SourceQuery, SourceState, StableSourceId,
};

use crate::errors::{error, state_unavailable};

#[napi(js_name = "NativeSource")]
pub struct NativeSource {
    pub(crate) declaration: pocketstation::Source,
}

#[napi]
impl NativeSource {
    #[napi(factory)]
    pub fn application(value: String) -> Result<Self> {
        require_nonempty("application name or identifier", &value)?;
        Ok(Self {
            declaration: pocketstation::Source::application(value),
        })
    }

    #[napi(factory)]
    pub fn application_name(value: String) -> Result<Self> {
        require_nonempty("application name", &value)?;
        Ok(Self {
            declaration: pocketstation::Source::application(ApplicationSelector::name(value)),
        })
    }

    #[napi(factory)]
    pub fn application_id(value: String) -> Result<Self> {
        require_nonempty("application identifier", &value)?;
        Ok(Self {
            declaration: pocketstation::Source::application(ApplicationSelector::bundle_id(value)),
        })
    }

    #[napi(factory)]
    pub fn application_process_id(process_id: u32) -> Result<Self> {
        require_process_id(process_id)?;
        Ok(Self {
            declaration: pocketstation::Source::application(ProcessId::new(process_id)),
        })
    }

    #[napi(factory)]
    pub fn application_stable_id(platform: String, stable_key: String) -> Result<Self> {
        require_nonempty("application stable identifier", &stable_key)?;
        let stable_id = StableSourceId::new(
            parse_platform(&platform)?,
            SourceKind::Application,
            stable_key,
        );
        Ok(Self {
            declaration: pocketstation::Source::application(stable_id),
        })
    }

    #[napi(factory)]
    pub fn application_process_instance(
        process_id: u32,
        platform: String,
        stable_key: String,
    ) -> Result<Self> {
        require_process_id(process_id)?;
        require_nonempty("application stable identifier", &stable_key)?;
        let stable_id = StableSourceId::new(
            parse_platform(&platform)?,
            SourceKind::Application,
            stable_key,
        );
        Ok(Self {
            declaration: pocketstation::Source::application(ApplicationSelector::process_instance(
                ProcessId::new(process_id),
                stable_id,
            )),
        })
    }

    #[napi(factory)]
    pub fn system_audio() -> Self {
        Self {
            declaration: pocketstation::Source::system_audio(),
        }
    }

    #[napi(factory)]
    pub fn default_microphone() -> Self {
        Self {
            declaration: pocketstation::Source::microphone_default(),
        }
    }

    #[napi(factory)]
    pub fn microphone_id(device_id: String) -> Result<Self> {
        require_nonempty("microphone device identifier", &device_id)?;
        Ok(Self {
            declaration: pocketstation::Source::microphone(DeviceSelector::id(DeviceId::new(
                device_id,
            ))),
        })
    }
}

#[napi(object)]
pub struct NativeAuthorizationOptions {
    pub os_permission: Option<String>,
    pub application_policy: Option<String>,
    pub session_grant: Option<String>,
    pub permission_epoch: Option<String>,
}

#[napi(object)]
pub struct NativeCaptureAuthorizationSnapshot {
    pub capability: String,
    pub os_permission: String,
    pub application_policy: String,
    pub session_grant: String,
    pub capture_scope: String,
    pub scope_stable_id: Option<String>,
    pub identity_strength: String,
    pub permission_epoch: String,
    pub observed_at_ns: String,
    pub open_outcome: String,
}

#[napi(js_name = "NativeDiscoveredSource")]
pub struct NativeDiscoveredSource {
    source: CaptureSource,
    #[napi(readonly)]
    pub platform: String,
    #[napi(readonly)]
    pub kind: String,
    #[napi(readonly)]
    pub stable_key: String,
    #[napi(readonly)]
    pub source_id: String,
    #[napi(readonly)]
    pub name: String,
    #[napi(readonly)]
    pub process_id: Option<u32>,
    #[napi(readonly)]
    pub application_id: Option<String>,
    #[napi(readonly)]
    pub device_uid: Option<String>,
    #[napi(readonly)]
    pub state: String,
    #[napi(readonly)]
    pub sample_rate_hz: u32,
    #[napi(readonly)]
    pub channel_count: u32,
    #[napi(readonly)]
    pub identity_strength: String,
    #[napi(readonly)]
    pub selector_persistence_scope: Option<String>,
    #[napi(readonly)]
    pub process_tree_scope: Option<String>,
}

#[napi]
impl NativeDiscoveredSource {
    #[napi]
    pub fn authorization_before_open(
        &self,
        options: Option<NativeAuthorizationOptions>,
    ) -> Result<NativeCaptureAuthorizationSnapshot> {
        let options = options.unwrap_or(NativeAuthorizationOptions {
            os_permission: None,
            application_policy: None,
            session_grant: None,
            permission_epoch: None,
        });
        let epoch = parse_u64(
            "permission epoch",
            options.permission_epoch.as_deref().unwrap_or("1"),
        )?;
        if epoch == 0 {
            return Err(error(
                "capture.invalid_permission_epoch",
                "permission epoch must be greater than zero",
            ));
        }
        let snapshot = CaptureAuthorizationSnapshot::from_open_observations(
            &self.source,
            parse_session_grant(options.session_grant.as_deref().unwrap_or("not-evaluated"))?,
            PermissionEpoch(epoch),
            parse_permission(options.os_permission.as_deref().unwrap_or("not-observable"))?,
            parse_application_policy(
                options
                    .application_policy
                    .as_deref()
                    .unwrap_or("not-observable"),
            )?,
            CaptureOpenOutcome::NotAttempted,
        );
        Ok(project_authorization(snapshot))
    }
}

#[napi(object)]
pub struct NativeCapturePermissionTransition {
    pub kind: String,
    pub previous: String,
    pub current: String,
    pub permission_epoch: String,
}

#[napi(js_name = "NativeCapturePermissionLifecycle")]
pub struct NativeCapturePermissionLifecycle {
    lifecycle: Mutex<CapturePermissionLifecycle>,
}

#[napi]
impl NativeCapturePermissionLifecycle {
    #[napi(constructor)]
    pub fn new(current: String) -> Result<Self> {
        Ok(Self {
            lifecycle: Mutex::new(CapturePermissionLifecycle::new(parse_permission(&current)?)),
        })
    }

    #[napi(getter)]
    pub fn current(&self) -> Result<String> {
        let lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| state_unavailable("capture permission state"))?;
        Ok(permission_name(lifecycle.current()).to_owned())
    }

    #[napi(getter)]
    pub fn permission_epoch(&self) -> Result<String> {
        let lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| state_unavailable("capture permission state"))?;
        Ok(lifecycle.permission_epoch().0.to_string())
    }

    #[napi]
    pub fn observe(&self, current: String) -> Result<Option<NativeCapturePermissionTransition>> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| state_unavailable("capture permission state"))?;
        Ok(lifecycle
            .observe(parse_permission(&current)?)
            .map(|transition| NativeCapturePermissionTransition {
                kind: match transition.kind {
                    SourceLifecycleEventKind::PermissionChanged => "permission-changed",
                    SourceLifecycleEventKind::PermissionRevoked => "permission-revoked",
                    _ => "unrecognized-permission-transition",
                }
                .to_owned(),
                previous: permission_name(transition.previous).to_owned(),
                current: permission_name(transition.current).to_owned(),
                permission_epoch: transition.permission_epoch.0.to_string(),
            }))
    }
}

#[allow(dead_code)]
pub struct DiscoverSourcesTask {
    query: Option<SourceQuery>,
}

impl Task for DiscoverSourcesTask {
    type Output = Vec<NativeDiscoveredSource>;
    type JsValue = Vec<NativeDiscoveredSource>;

    fn compute(&mut self) -> Result<Self::Output> {
        let sources = pocketstation::discover_sources();
        let selected = match &self.query {
            Some(query) => pocketstation::resolve_query(query, &sources),
            None => sources,
        };
        Ok(selected
            .into_iter()
            .map(project_discovered_source)
            .collect())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
#[allow(dead_code)]
pub fn discover_sources(
    query_kind: Option<String>,
    value: Option<String>,
) -> Result<AsyncTask<DiscoverSourcesTask>> {
    let query = match query_kind {
        None if value.is_none() => None,
        None => {
            return Err(error(
                "source.invalid_query",
                "a source query value requires a query type",
            ))
        }
        Some(kind) => Some(parse_source_query(&kind, value)?),
    };
    Ok(AsyncTask::new(DiscoverSourcesTask { query }))
}

#[napi]
#[allow(dead_code)]
pub fn application_capture_available() -> bool {
    pocketstation::application_capture_available()
}

#[allow(dead_code)]
pub struct MicrophonePermissionTask;

impl Task for MicrophonePermissionTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<Self::Output> {
        Ok(permission_name(pocketstation::microphone_permission_observation()).to_owned())
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
#[allow(dead_code)]
pub fn microphone_permission_observation() -> AsyncTask<MicrophonePermissionTask> {
    AsyncTask::new(MicrophonePermissionTask)
}

pub(crate) fn platform_name(platform: Platform) -> &'static str {
    match platform {
        Platform::Macos => "macos",
        Platform::Windows => "windows",
        Platform::Linux => "linux",
        Platform::Ios => "ios",
        Platform::Android => "android",
        Platform::Web => "web",
        Platform::Unknown => "unknown",
    }
}

pub(crate) fn source_kind_name(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::Application => "application",
        SourceKind::OutputDevice => "output-device",
        SourceKind::InputDevice => "input-device",
        SourceKind::SystemMix => "system-mix",
    }
}

pub(crate) fn permission_name(value: PermissionObservation) -> &'static str {
    match value {
        PermissionObservation::Allowed => "allowed",
        PermissionObservation::Denied => "denied",
        PermissionObservation::Restricted => "restricted",
        PermissionObservation::NotDetermined => "not-determined",
        PermissionObservation::Revoked => "revoked",
        PermissionObservation::NotObservable => "not-observable",
        PermissionObservation::NotApplicable => "not-applicable",
    }
}

fn parse_platform(value: &str) -> Result<Platform> {
    match value {
        "macos" => Ok(Platform::Macos),
        "windows" => Ok(Platform::Windows),
        "linux" => Ok(Platform::Linux),
        "ios" => Ok(Platform::Ios),
        "android" => Ok(Platform::Android),
        "web" => Ok(Platform::Web),
        "unknown" => Ok(Platform::Unknown),
        _ => Err(error(
            "source.invalid_platform",
            "platform is not recognized",
        )),
    }
}

fn parse_permission(value: &str) -> Result<PermissionObservation> {
    match value {
        "allowed" => Ok(PermissionObservation::Allowed),
        "denied" => Ok(PermissionObservation::Denied),
        "restricted" => Ok(PermissionObservation::Restricted),
        "not-determined" => Ok(PermissionObservation::NotDetermined),
        "revoked" => Ok(PermissionObservation::Revoked),
        "not-observable" => Ok(PermissionObservation::NotObservable),
        "not-applicable" => Ok(PermissionObservation::NotApplicable),
        _ => Err(error(
            "capture.invalid_permission_observation",
            "permission observation is not recognized",
        )),
    }
}

fn parse_application_policy(value: &str) -> Result<ApplicationPolicyObservation> {
    match value {
        "allowed" => Ok(ApplicationPolicyObservation::Allowed),
        "denied" => Ok(ApplicationPolicyObservation::Denied),
        "not-observable" => Ok(ApplicationPolicyObservation::NotObservable),
        "not-applicable" => Ok(ApplicationPolicyObservation::NotApplicable),
        _ => Err(error(
            "capture.invalid_application_policy",
            "application policy observation is not recognized",
        )),
    }
}

fn parse_session_grant(value: &str) -> Result<CaptureSessionGrant> {
    match value {
        "granted-by-explicit-selection" => Ok(CaptureSessionGrant::GrantedByExplicitSelection),
        "denied" => Ok(CaptureSessionGrant::Denied),
        "not-evaluated" => Ok(CaptureSessionGrant::NotEvaluated),
        _ => Err(error(
            "capture.invalid_session_grant",
            "capture Session grant is not recognized",
        )),
    }
}

fn parse_source_kind(value: &str) -> Result<SourceKind> {
    match value {
        "application" => Ok(SourceKind::Application),
        "output-device" => Ok(SourceKind::OutputDevice),
        "input-device" => Ok(SourceKind::InputDevice),
        "system-mix" => Ok(SourceKind::SystemMix),
        _ => Err(error(
            "source.invalid_query",
            "source kind is not recognized",
        )),
    }
}

fn parse_source_query(kind: &str, value: Option<String>) -> Result<SourceQuery> {
    match (kind, value) {
        ("any", None) => Ok(SourceQuery::Any),
        ("application", Some(value)) => {
            require_nonempty("application query", &value)?;
            Ok(SourceQuery::App(value))
        }
        ("kind", Some(value)) => Ok(SourceQuery::ByKind(parse_source_kind(&value)?)),
        ("stable-key", Some(value)) => {
            require_nonempty("stable source key", &value)?;
            Ok(SourceQuery::ByStableKey(value))
        }
        ("playing", None) => Ok(SourceQuery::Playing),
        ("any" | "playing", Some(_)) => Err(error(
            "source.invalid_query",
            "this source query does not accept a value",
        )),
        ("application" | "kind" | "stable-key", None) => Err(error(
            "source.invalid_query",
            "this source query requires a value",
        )),
        _ => Err(error(
            "source.invalid_query",
            "query type is not recognized",
        )),
    }
}

fn project_discovered_source(source: CaptureSource) -> NativeDiscoveredSource {
    let platform = platform_name(source.stable_id.platform).to_owned();
    let kind = source_kind_name(source.stable_id.kind).to_owned();
    let stable_key = source.stable_id.stable_key.clone();
    let source_id = source.stable_id.source_id().get().to_string();
    let identity_strength = identity_strength_name(source.identity_strength()).to_owned();
    let selector_persistence_scope = source
        .selector_persistence_scope()
        .map(selector_persistence_scope_name)
        .map(str::to_owned);
    let process_tree_scope = source
        .process_tree_scope()
        .map(process_tree_scope_name)
        .map(str::to_owned);
    NativeDiscoveredSource {
        platform,
        kind,
        stable_key,
        source_id,
        name: source.name.clone(),
        process_id: source.process_id,
        application_id: source.app_id.clone(),
        device_uid: source.device_uid.clone(),
        state: source_state_name(source.state).to_owned(),
        sample_rate_hz: source.sample_rate_hz,
        channel_count: u32::from(source.channels),
        identity_strength,
        selector_persistence_scope,
        process_tree_scope,
        source,
    }
}

fn project_authorization(
    snapshot: CaptureAuthorizationSnapshot,
) -> NativeCaptureAuthorizationSnapshot {
    let (capture_scope, scope_stable_id) = match snapshot.capture_scope {
        CaptureScope::ExactApplication { stable_id } => ("exact-application", Some(stable_id)),
        CaptureScope::ExactInputDevice { stable_id } => ("exact-input-device", Some(stable_id)),
        CaptureScope::ExactOutputDevice { stable_id } => ("exact-output-device", Some(stable_id)),
        CaptureScope::SystemMix => ("system-mix", None),
    };
    NativeCaptureAuthorizationSnapshot {
        capability: match snapshot.capability {
            pocketstation::CaptureCapabilityState::Available => "available",
            pocketstation::CaptureCapabilityState::Unavailable => "unavailable",
            pocketstation::CaptureCapabilityState::Unsupported => "unsupported",
        }
        .to_owned(),
        os_permission: permission_name(snapshot.os_permission).to_owned(),
        application_policy: match snapshot.application_policy {
            ApplicationPolicyObservation::Allowed => "allowed",
            ApplicationPolicyObservation::Denied => "denied",
            ApplicationPolicyObservation::NotObservable => "not-observable",
            ApplicationPolicyObservation::NotApplicable => "not-applicable",
        }
        .to_owned(),
        session_grant: match snapshot.session_grant {
            CaptureSessionGrant::GrantedByExplicitSelection => "granted-by-explicit-selection",
            CaptureSessionGrant::Denied => "denied",
            CaptureSessionGrant::NotEvaluated => "not-evaluated",
        }
        .to_owned(),
        capture_scope: capture_scope.to_owned(),
        scope_stable_id,
        identity_strength: identity_strength_name(snapshot.identity_strength).to_owned(),
        permission_epoch: snapshot.permission_epoch.0.to_string(),
        observed_at_ns: snapshot.observed_at_ns.to_string(),
        open_outcome: match snapshot.open_outcome {
            CaptureOpenOutcome::NotAttempted => "not-attempted",
            CaptureOpenOutcome::Succeeded => "succeeded",
            CaptureOpenOutcome::PermissionDenied => "permission-denied",
            CaptureOpenOutcome::SourceUnavailable => "source-unavailable",
            CaptureOpenOutcome::BackendFailed => "backend-failed",
        }
        .to_owned(),
    }
}

fn source_state_name(value: SourceState) -> &'static str {
    match value {
        SourceState::Available => "available",
        SourceState::Playing => "playing",
        SourceState::Silent => "silent",
        SourceState::Unavailable => "unavailable",
        SourceState::PermissionBlocked => "permission-blocked",
    }
}

fn identity_strength_name(value: SourceIdentityStrength) -> &'static str {
    match value {
        SourceIdentityStrength::ApplicationIdAndProcessId => "application-id-and-process-id",
        SourceIdentityStrength::StableApplicationId => "stable-application-id",
        SourceIdentityStrength::ProcessId => "process-id",
        SourceIdentityStrength::StableDeviceUid => "stable-device-uid",
        SourceIdentityStrength::PlatformStableId => "platform-stable-id",
    }
}

fn selector_persistence_scope_name(value: SelectorPersistenceScope) -> &'static str {
    match value {
        SelectorPersistenceScope::ProcessLifetime => "process-lifetime",
        SelectorPersistenceScope::ApplicationIdentity => "application-identity",
        SelectorPersistenceScope::DeviceIdentity => "device-identity",
        SelectorPersistenceScope::SessionDefaultDevice => "session-default-device",
        SelectorPersistenceScope::PlatformIdentity => "platform-identity",
    }
}

fn process_tree_scope_name(value: ProcessTreeScope) -> &'static str {
    match value {
        ProcessTreeScope::SelectedProcessOnly => "selected-process-only",
        ProcessTreeScope::SelectedProcessAndDescendants => "selected-process-and-descendants",
        ProcessTreeScope::ApplicationIdentity => "application-identity",
        ProcessTreeScope::NotApplicable => "not-applicable",
    }
}

fn require_nonempty(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(error(
            "session.invalid_selector",
            format!("{label} cannot be empty"),
        ))
    } else {
        Ok(())
    }
}

fn require_process_id(process_id: u32) -> Result<()> {
    if process_id == 0 {
        Err(error(
            "session.invalid_selector",
            "application process identifier must be greater than zero",
        ))
    } else {
        Ok(())
    }
}

fn parse_u64(label: &str, value: &str) -> Result<u64> {
    value.parse::<u64>().map_err(|_| {
        error(
            "capture.invalid_integer",
            format!("{label} must be an unsigned 64-bit integer"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_source() -> CaptureSource {
        CaptureSource {
            stable_id: StableSourceId::new(Platform::Linux, SourceKind::Application, "pw-app:42"),
            name: "Fixture".to_owned(),
            process_id: Some(42),
            app_id: Some("io.pocketstation.fixture".to_owned()),
            device_uid: None,
            state: SourceState::Playing,
            sample_rate_hz: 48_000,
            channels: 2,
        }
    }

    #[test]
    fn discovered_projection_preserves_identity_and_selection_details() {
        let source = fixture_source();
        let expected_id = source.stable_id.source_id().get().to_string();
        let projected = project_discovered_source(source);
        assert_eq!(projected.platform, "linux");
        assert_eq!(projected.kind, "application");
        assert_eq!(projected.stable_key, "pw-app:42");
        assert_eq!(projected.source_id, expected_id);
        assert_eq!(projected.process_id, Some(42));
        assert_eq!(projected.identity_strength, "application-id-and-process-id");
        assert_eq!(
            projected.selector_persistence_scope.as_deref(),
            Some("application-identity")
        );
        assert_eq!(
            projected.process_tree_scope.as_deref(),
            Some("application-identity")
        );
    }

    #[test]
    fn permission_projection_keeps_every_core_state_distinct() {
        let states = [
            (PermissionObservation::Allowed, "allowed"),
            (PermissionObservation::Denied, "denied"),
            (PermissionObservation::Restricted, "restricted"),
            (PermissionObservation::NotDetermined, "not-determined"),
            (PermissionObservation::Revoked, "revoked"),
            (PermissionObservation::NotObservable, "not-observable"),
            (PermissionObservation::NotApplicable, "not-applicable"),
        ];
        for (state, expected) in states {
            assert_eq!(permission_name(state), expected);
        }
    }

    #[test]
    fn query_parser_rejects_missing_or_surplus_values() {
        assert!(parse_source_query("application", None).is_err());
        assert!(parse_source_query("playing", Some("unexpected".to_owned())).is_err());
        assert_eq!(
            parse_source_query("kind", Some("input-device".to_owned())).expect("typed query"),
            SourceQuery::ByKind(SourceKind::InputDevice),
        );
    }
}
