mod mysql;
mod postgres;

use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;

use crate::CoreError;
use crate::profiles::{Engine, TlsMode};
use crate::sql::Dialect;

pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub type Row = Vec<Option<String>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ColumnKind {
    Number,
    Text,
    Binary,
    Boolean,
    Temporal,
    Json,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ColumnMeta {
    pub name: String,
    pub type_name: String,
    pub kind: ColumnKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServerDetails {
    pub flavor: String,
    pub version: String,
    pub database: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SinkFlow {
    Continue,
    Stop,
}

pub trait RowSink: Send {
    fn columns(&mut self, columns: &[ColumnMeta]);
    fn row(&mut self, row: Row) -> SinkFlow;
}

#[derive(Debug, Default)]
pub struct RunSummary {
    pub columns: Option<Vec<ColumnMeta>>,
    pub rows_affected: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbError {
    pub message: String,
    pub position: Option<u32>,
    pub line: Option<u32>,
    pub connection_lost: bool,
}

impl DbError {
    fn message(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            position: None,
            line: None,
            connection_lost: false,
        }
    }

    fn lost(message: impl Into<String>) -> Self {
        Self {
            connection_lost: true,
            ..Self::message(message)
        }
    }
}

impl From<DbError> for CoreError {
    fn from(err: DbError) -> Self {
        if err.connection_lost {
            CoreError::Connection(err.message)
        } else {
            CoreError::Database(err.message)
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConnectParams {
    pub engine: Engine,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: Option<String>,
    pub database: Option<String>,
    pub tls: TlsMode,
    pub read_only: bool,
}

pub enum Connection {
    MySql(mysql::MySqlConnection),
    Postgres(postgres::PgConnection),
}

#[derive(Clone)]
pub enum CancelHandle {
    MySql(mysql::MySqlCancel),
    Postgres(postgres::PgCancel),
}

impl Connection {
    pub async fn connect(params: &ConnectParams) -> Result<Self, DbError> {
        let connecting = async {
            match params.engine {
                Engine::Mysql => mysql::MySqlConnection::connect(params)
                    .await
                    .map(Self::MySql),
                Engine::Postgres => postgres::PgConnection::connect(params)
                    .await
                    .map(Self::Postgres),
            }
        };
        tokio::time::timeout(CONNECT_TIMEOUT + Duration::from_secs(5), connecting)
            .await
            .map_err(|_| DbError::lost("connection attempt timed out"))?
    }

    pub fn dialect(&self) -> Dialect {
        match self {
            Self::MySql(conn) => conn.dialect(),
            Self::Postgres(conn) => conn.dialect(),
        }
    }

    pub fn details(&self) -> &ServerDetails {
        match self {
            Self::MySql(conn) => conn.details(),
            Self::Postgres(conn) => conn.details(),
        }
    }

    pub fn cancel_handle(&self) -> CancelHandle {
        match self {
            Self::MySql(conn) => CancelHandle::MySql(conn.cancel_handle()),
            Self::Postgres(conn) => CancelHandle::Postgres(conn.cancel_handle()),
        }
    }

    pub fn is_closed(&self) -> bool {
        match self {
            Self::MySql(_) => false,
            Self::Postgres(conn) => conn.is_closed(),
        }
    }

    pub async fn run(&mut self, sql: &str, sink: &mut dyn RowSink) -> Result<RunSummary, DbError> {
        match self {
            Self::MySql(conn) => conn.run(sql, sink).await,
            Self::Postgres(conn) => conn.run(sql, sink).await,
        }
    }

    pub async fn query_rows(&mut self, sql: &str) -> Result<Vec<Row>, DbError> {
        let mut sink = CollectSink::default();
        self.run(sql, &mut sink).await?;
        Ok(sink.rows)
    }

    pub async fn execute(&mut self, sql: &str) -> Result<u64, DbError> {
        let mut sink = CollectSink::default();
        Ok(self.run(sql, &mut sink).await?.rows_affected)
    }

    pub async fn use_database(&mut self, database: &str) -> Result<(), DbError> {
        match self {
            Self::MySql(conn) => conn.use_database(database).await,
            Self::Postgres(_) => Err(DbError::message(
                "PostgreSQL connections are bound to one database",
            )),
        }
    }

    pub async fn close(self) {
        match self {
            Self::MySql(conn) => conn.close().await,
            Self::Postgres(conn) => conn.close(),
        }
    }
}

impl CancelHandle {
    pub async fn cancel(&self) -> Result<(), DbError> {
        match self {
            Self::MySql(handle) => handle.cancel().await,
            Self::Postgres(handle) => handle.cancel().await,
        }
    }
}

#[derive(Default)]
struct CollectSink {
    rows: Vec<Row>,
}

impl RowSink for CollectSink {
    fn columns(&mut self, _columns: &[ColumnMeta]) {}

    fn row(&mut self, row: Row) -> SinkFlow {
        self.rows.push(row);
        SinkFlow::Continue
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("0x");
    for byte in bytes {
        out.push_str(&format!("{byte:02X}"));
    }
    out
}

fn parse_line(message: &str) -> Option<u32> {
    let index = message.rfind("at line ")?;
    let digits: String = message[index + "at line ".len()..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_hex_and_parses_error_lines() {
        assert_eq!(hex(&[0x00, 0xab, 0x10]), "0x00AB10");
        assert_eq!(
            parse_line("You have an error in your SQL syntax; check the manual near 'x' at line 3"),
            Some(3)
        );
        assert_eq!(parse_line("no line here"), None);
    }
}
