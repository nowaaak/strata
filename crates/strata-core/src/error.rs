use std::path::PathBuf;

pub type CoreResult<T> = Result<T, CoreError>;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("file operation failed at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("invalid JSON in {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("{0}")]
    Database(String),

    #[error("{0}")]
    Connection(String),

    #[error("system keyring error: {0}")]
    Secret(String),

    #[error("{0}")]
    InvalidInput(String),

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    ReadOnly(String),

    #[error("another query is still running in this tab")]
    Busy,

    #[error("unknown SSH host key {fingerprint} for {host}")]
    SshHostKeyUnknown { host: String, fingerprint: String },

    #[error("the SSH host key of {host} changed to {fingerprint}, the trusted key is {expected}")]
    SshHostKeyChanged {
        host: String,
        expected: String,
        fingerprint: String,
    },
}

impl CoreError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Io { .. } => "io",
            Self::Json { .. } => "json",
            Self::Database(_) => "database",
            Self::Connection(_) => "connection",
            Self::Secret(_) => "secret",
            Self::InvalidInput(_) => "invalid_input",
            Self::NotFound(_) => "not_found",
            Self::ReadOnly(_) => "read_only",
            Self::Busy => "busy",
            Self::SshHostKeyUnknown { .. } => "ssh_host_key_unknown",
            Self::SshHostKeyChanged { .. } => "ssh_host_key_changed",
        }
    }

    pub fn detail(&self) -> Option<String> {
        match self {
            Self::SshHostKeyUnknown { fingerprint, .. }
            | Self::SshHostKeyChanged { fingerprint, .. } => Some(fingerprint.clone()),
            _ => None,
        }
    }

    pub(crate) fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }

    pub(crate) fn json(path: impl Into<PathBuf>, source: serde_json::Error) -> Self {
        Self::Json {
            path: path.into(),
            source,
        }
    }
}
