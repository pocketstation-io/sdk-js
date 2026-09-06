use std::mem::size_of;
use std::path::PathBuf;

use napi::Result;
use napi_derive::napi;

use crate::application_audio::NativeSourceOutput;
use crate::errors::error;
use crate::graph::NativeConfigurationEntry;

#[repr(C)]
#[derive(Clone, Copy)]
struct RawStatus {
    code: u32,
    detail: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct RawUtf8 {
    data: *const u8,
    len_bytes: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct RawAbiVersion {
    struct_size_bytes: u32,
    abi_major: u16,
    abi_minor: u16,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct RawDescriptor {
    struct_size_bytes: u32,
    abi_major: u16,
    abi_minor: u16,
    kind: u32,
    revision: u32,
    generation: u32,
    port_count: u32,
    extension_id: RawUtf8,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct RawPort {
    struct_size_bytes: u32,
    abi_major: u16,
    abi_minor: u16,
    direction: u32,
    required: u32,
    name: RawUtf8,
    signal_id: RawUtf8,
    semantic_role: RawUtf8,
    schema: RawUtf8,
}

unsafe extern "C" {
    fn pks_extension_abi_get_version(output_version: *mut RawAbiVersion) -> RawStatus;
    fn pks_extension_abi_is_compatible(
        requested_abi_major: u16,
        requested_abi_minor: u16,
        requested_struct_size_bytes: u32,
    ) -> RawStatus;
    fn pks_extension_descriptor_validate(
        descriptor: *const RawDescriptor,
        ports: *const RawPort,
        port_count: u32,
    ) -> RawStatus;
}

#[napi(object)]
pub struct NativeExtensionAbiVersion {
    pub struct_size_bytes: u32,
    pub abi_major: u16,
    pub abi_minor: u16,
}

#[napi(object)]
#[derive(Clone)]
pub struct NativeExtensionPort {
    pub name: String,
    pub direction: String,
    pub required: bool,
    pub signal_id: String,
    pub semantic_role: String,
    pub schema: String,
}

#[napi(object)]
#[derive(Clone)]
pub struct NativeExtensionRegistration {
    pub id: String,
    pub kind: String,
    pub revision: u32,
    pub generation: u32,
}

#[napi(object)]
pub struct NativeExtensionLibrary {
    pub canonical_path: String,
    pub registrations: Vec<NativeExtensionRegistration>,
}

impl From<pocketstation::native_extension::NativeExtensionLibrary> for NativeExtensionLibrary {
    fn from(value: pocketstation::native_extension::NativeExtensionLibrary) -> Self {
        Self {
            canonical_path: value.canonical_path().to_string_lossy().into_owned(),
            registrations: value
                .registrations()
                .iter()
                .map(|registration| NativeExtensionRegistration {
                    id: registration.id().to_owned(),
                    kind: match registration.kind() {
                        pocketstation::native_extension::NativeExtensionKind::Source => "source",
                        pocketstation::native_extension::NativeExtensionKind::Operator => {
                            "operator"
                        }
                        pocketstation::native_extension::NativeExtensionKind::Endpoint => {
                            "endpoint"
                        }
                    }
                    .to_owned(),
                    revision: registration.revision(),
                    generation: registration.generation(),
                })
                .collect(),
        }
    }
}

#[napi(js_name = "NativeSourceInstance")]
pub struct NativeSourceInstance {
    pub(crate) session_id: u64,
    pub(crate) handle: pocketstation::SourceInstanceHandle,
}

#[napi]
impl NativeSourceInstance {
    #[napi(getter)]
    pub fn session_id(&self) -> String {
        self.session_id.to_string()
    }

    #[napi(getter)]
    pub fn instance_id(&self) -> String {
        self.handle.instance_id().value().to_string()
    }

    #[napi(getter)]
    pub fn source_id(&self) -> String {
        self.handle.source_id().get().to_string()
    }

    #[napi]
    pub fn output(&self, name: String) -> Result<NativeSourceOutput> {
        self.handle
            .output(name)
            .map(|handle| NativeSourceOutput {
                session_id: self.session_id,
                handle,
            })
            .map_err(|failure| error("session.invalid_source_output", failure.to_string()))
    }
}

#[napi]
pub fn extension_abi_version() -> Result<NativeExtensionAbiVersion> {
    let mut version = RawAbiVersion {
        struct_size_bytes: 0,
        abi_major: 0,
        abi_minor: 0,
    };
    // SAFETY: `version` is one aligned writable record retained only for this call.
    let status = unsafe { pks_extension_abi_get_version(&raw mut version) };
    check_status(status)?;
    Ok(NativeExtensionAbiVersion {
        struct_size_bytes: version.struct_size_bytes,
        abi_major: version.abi_major,
        abi_minor: version.abi_minor,
    })
}

#[napi]
pub fn extension_abi_is_compatible(
    abi_major: u16,
    abi_minor: u16,
    struct_size_bytes: u32,
) -> Result<()> {
    // SAFETY: the ABI receives values and retains no memory.
    check_status(unsafe {
        pks_extension_abi_is_compatible(abi_major, abi_minor, struct_size_bytes)
    })
}

#[napi]
pub fn validate_extension_descriptor(
    extension_id: String,
    kind: String,
    revision: u32,
    generation: u32,
    abi_major: u16,
    abi_minor: u16,
    ports: Vec<NativeExtensionPort>,
) -> Result<()> {
    let port_count = u32::try_from(ports.len()).map_err(|_| {
        error(
            "extension.invalid_descriptor",
            "port count exceeds the extension ABI range",
        )
    })?;
    let raw_ports = ports
        .iter()
        .map(|port| {
            Ok(RawPort {
                struct_size_bytes: size_of::<RawPort>() as u32,
                abi_major,
                abi_minor,
                direction: parse_direction(&port.direction)?,
                required: u32::from(port.required),
                name: raw_utf8(&port.name)?,
                signal_id: raw_utf8(&port.signal_id)?,
                semantic_role: raw_utf8(&port.semantic_role)?,
                schema: raw_utf8(&port.schema)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let descriptor = RawDescriptor {
        struct_size_bytes: size_of::<RawDescriptor>() as u32,
        abi_major,
        abi_minor,
        kind: parse_kind(&kind)?,
        revision,
        generation,
        port_count,
        extension_id: raw_utf8(&extension_id)?,
    };
    // SAFETY: every record and referenced UTF-8 string remains alive for this
    // synchronous validation call. The ABI retains no borrowed memory.
    check_status(unsafe {
        pks_extension_descriptor_validate(&raw const descriptor, raw_ports.as_ptr(), port_count)
    })
}

pub(crate) fn source_configuration(
    entries: Vec<NativeConfigurationEntry>,
) -> Result<pocketstation::SourceConfiguration> {
    let mut configuration = pocketstation::SourceConfiguration::default();
    for entry in entries {
        if entry.key.trim().is_empty() {
            return Err(error(
                "extension.invalid_source_configuration",
                "Source configuration keys cannot be empty",
            ));
        }
        if entry.sensitive.unwrap_or(false) {
            return Err(error(
                "extension.invalid_source_configuration",
                "Source configuration does not accept secret-marked values",
            ));
        }
        configuration.insert(entry.key, entry.value);
    }
    Ok(configuration)
}

pub(crate) fn native_extension_error(
    failure: pocketstation::native_extension::NativeExtensionLibraryError,
) -> napi::Error {
    use pocketstation::native_extension::NativeExtensionLibraryErrorCode;
    let code = match failure.code() {
        NativeExtensionLibraryErrorCode::PathNotAbsolute => "extension.path_not_absolute",
        NativeExtensionLibraryErrorCode::PathCanonicalizationFailed => {
            "extension.path_canonicalization_failed"
        }
        NativeExtensionLibraryErrorCode::PathNotFile => "extension.path_not_file",
        NativeExtensionLibraryErrorCode::LibraryLoadFailed => "extension.library_load_failed",
        NativeExtensionLibraryErrorCode::EntrypointMissing => "extension.entrypoint_missing",
        NativeExtensionLibraryErrorCode::EntrypointPanicked => "extension.entrypoint_panicked",
        NativeExtensionLibraryErrorCode::EntrypointFailed => "extension.entrypoint_failed",
        NativeExtensionLibraryErrorCode::UnsupportedAbiMajor => "extension.unsupported_abi_major",
        NativeExtensionLibraryErrorCode::UnsupportedAbiMinor => "extension.unsupported_abi_minor",
        NativeExtensionLibraryErrorCode::InvalidLibraryDescriptor => {
            "extension.invalid_library_descriptor"
        }
        NativeExtensionLibraryErrorCode::RegistrationAcquisitionPanicked => {
            "extension.registration_acquisition_panicked"
        }
        NativeExtensionLibraryErrorCode::RegistrationAcquisitionFailed => {
            "extension.registration_acquisition_failed"
        }
        NativeExtensionLibraryErrorCode::InvalidRegistration => "extension.invalid_registration",
        NativeExtensionLibraryErrorCode::DuplicateRegistration => {
            "extension.duplicate_registration"
        }
        NativeExtensionLibraryErrorCode::RegistrationStateUnavailable => {
            "extension.registration_state_unavailable"
        }
    };
    error(code, failure.message())
}

fn raw_utf8(value: &str) -> Result<RawUtf8> {
    let len_bytes = u32::try_from(value.len()).map_err(|_| {
        error(
            "extension.invalid_descriptor",
            "extension text exceeds the ABI range",
        )
    })?;
    Ok(RawUtf8 {
        data: value.as_ptr(),
        len_bytes,
    })
}

fn parse_kind(value: &str) -> Result<u32> {
    match value {
        "source" => Ok(1),
        "operator" => Ok(2),
        "endpoint" => Ok(3),
        _ => Err(error(
            "extension.invalid_descriptor",
            "kind must be source, operator, or endpoint",
        )),
    }
}

fn parse_direction(value: &str) -> Result<u32> {
    match value {
        "input" => Ok(1),
        "output" => Ok(2),
        _ => Err(error(
            "extension.invalid_descriptor",
            "port direction must be input or output",
        )),
    }
}

fn check_status(status: RawStatus) -> Result<()> {
    if status.code == 0 {
        return Ok(());
    }
    let (code, reason) = match status.code {
        1 => (
            "extension.null_argument",
            "the native ABI received a null pointer",
        ),
        3 => (
            "extension.unsupported_abi_major",
            "unsupported extension ABI major",
        ),
        4 => (
            "extension.invalid_struct_size",
            "invalid extension ABI struct size",
        ),
        8 => (
            "extension.internal_panic",
            "native extension ABI trapped a panic",
        ),
        9 => (
            "extension.misaligned_pointer",
            "misaligned extension ABI pointer",
        ),
        10 => (
            "extension.invalid_descriptor",
            "invalid extension descriptor or ports",
        ),
        17 => (
            "extension.unsupported_abi_minor",
            "unsupported extension ABI minor",
        ),
        _ => (
            "extension.abi_error",
            "native extension ABI rejected the request",
        ),
    };
    Err(error(code, format!("{reason} (detail={})", status.detail)))
}

pub(crate) fn source_type_id(value: String) -> Result<pocketstation::SourceTypeId> {
    pocketstation::SourceTypeId::new(value)
        .map_err(|failure| error("extension.invalid_source_type", failure.to_string()))
}

pub(crate) fn require_absolute_library_path(path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(error(
            "extension.path_not_absolute",
            "native extension library path must be absolute",
        ));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linked_abi_validates_a_source_descriptor() {
        let version = extension_abi_version().expect("linked Extension ABI version");
        extension_abi_is_compatible(
            version.abi_major,
            version.abi_minor,
            version.struct_size_bytes,
        )
        .expect("current ABI must be compatible");
        validate_extension_descriptor(
            "dev.pocketstation.source.javascript-test.v1".to_owned(),
            "source".to_owned(),
            1,
            1,
            version.abi_major,
            version.abi_minor,
            vec![NativeExtensionPort {
                name: "out".to_owned(),
                direction: "output".to_owned(),
                required: true,
                signal_id: "dev.pocketstation.javascript-test.signal.v1".to_owned(),
                semantic_role: String::new(),
                schema: String::new(),
            }],
        )
        .expect("valid source descriptor");
    }
}
