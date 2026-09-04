use napi::{Error, Status};

pub(crate) fn error(code: &str, message: impl AsRef<str>) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("{code}|{}", message.as_ref()),
    )
}

pub(crate) fn state_unavailable(subject: &str) -> Error {
    error(
        "session.state_unavailable",
        format!("{subject} state is unavailable"),
    )
}
