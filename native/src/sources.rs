use napi::Result;
use napi_derive::napi;

use crate::errors::error;

#[napi(js_name = "NativeSource")]
pub struct NativeSource {
    pub(crate) declaration: pocketstation::Source,
}

#[napi]
impl NativeSource {
    #[napi(factory)]
    pub fn application(name_or_application_id: String) -> Result<Self> {
        if name_or_application_id.trim().is_empty() {
            return Err(error(
                "capture.invalid_selector",
                "application name or identifier cannot be empty",
            ));
        }
        Ok(Self {
            declaration: pocketstation::Source::application(name_or_application_id),
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
}
