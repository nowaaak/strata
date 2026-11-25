use serde::Serialize;
use strata_core::CoreError;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CommandError {
    pub kind: String,
    pub message: String,
    pub detail: Option<String>,
}

impl From<CoreError> for CommandError {
    fn from(err: CoreError) -> Self {
        if err.kind() == "database" {
            tracing::warn!(kind = err.kind(), "command failed");
        } else {
            tracing::warn!(kind = err.kind(), error = %err, "command failed");
        }
        Self {
            kind: err.kind().into(),
            message: err.to_string(),
            detail: err.detail(),
        }
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
