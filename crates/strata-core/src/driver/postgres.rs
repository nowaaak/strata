use std::pin::pin;

use futures_util::StreamExt;
use postgres_native_tls::MakeTlsConnector;
use tokio_postgres::config::SslMode;
use tokio_postgres::error::ErrorPosition;
use tokio_postgres::types::Type;
use tokio_postgres::{CancelToken, Client, Config, NoTls, SimpleQueryMessage};

use super::{
    CONNECT_TIMEOUT, ColumnKind, ColumnMeta, ConnectParams, DbError, RowSink, RunSummary,
    ServerDetails, SinkFlow,
};
use crate::profiles::TlsMode;
use crate::sql::Dialect;

const DEFAULT_DATABASE: &str = "postgres";

pub struct PgConnection {
    client: Client,
    tls: TlsMode,
    dialect: Dialect,
    details: ServerDetails,
}

#[derive(Clone)]
pub struct PgCancel {
    token: CancelToken,
    tls: TlsMode,
}

fn tls_connector(mode: TlsMode) -> Result<MakeTlsConnector, DbError> {
    let mut builder = native_tls::TlsConnector::builder();
    if mode == TlsMode::Required {
        builder
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true);
    }
    let connector = builder
        .build()
        .map_err(|err| DbError::message(format!("TLS setup failed: {err}")))?;
    Ok(MakeTlsConnector::new(connector))
}

impl PgConnection {
    pub async fn connect(params: &ConnectParams) -> Result<Self, DbError> {
        let mut config = Config::new();
        config
            .host(&params.host)
            .port(params.port)
            .user(&params.user)
            .dbname(params.database.as_deref().unwrap_or(DEFAULT_DATABASE))
            .application_name("Strata")
            .connect_timeout(CONNECT_TIMEOUT);
        if let Some(password) = &params.password {
            config.password(password);
        }
        if params.read_only {
            config.options("-c default_transaction_read_only=on");
        }
        let client = match params.tls {
            TlsMode::Disabled => {
                config.ssl_mode(SslMode::Disable);
                let (client, connection) = config.connect(NoTls).await.map_err(map_error)?;
                tokio::spawn(async move {
                    if let Err(err) = connection.await {
                        tracing::debug!(error = %err, "postgres connection ended");
                    }
                });
                client
            }
            mode => {
                config.ssl_mode(SslMode::Require);
                let (client, connection) = config
                    .connect(tls_connector(mode)?)
                    .await
                    .map_err(map_error)?;
                tokio::spawn(async move {
                    if let Err(err) = connection.await {
                        tracing::debug!(error = %err, "postgres connection ended");
                    }
                });
                client
            }
        };

        let mut info = None;
        for message in client
            .simple_query(
                "SELECT current_setting('server_version'), current_database(), current_setting('standard_conforming_strings')",
            )
            .await
            .map_err(map_error)?
        {
            if let SimpleQueryMessage::Row(row) = message {
                info = Some((
                    row.get(0).unwrap_or_default().to_string(),
                    row.get(1).map(str::to_string),
                    row.get(2) == Some("on"),
                ));
            }
        }
        let (version, database, standard_strings) =
            info.ok_or_else(|| DbError::message("server did not report its version"))?;
        let version = version
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_string();
        Ok(Self {
            client,
            tls: params.tls,
            dialect: Dialect::Postgres { standard_strings },
            details: ServerDetails {
                flavor: "PostgreSQL".into(),
                version,
                database,
            },
        })
    }

    pub fn dialect(&self) -> Dialect {
        self.dialect
    }

    pub fn details(&self) -> &ServerDetails {
        &self.details
    }

    pub fn cancel_handle(&self) -> PgCancel {
        PgCancel {
            token: self.client.cancel_token(),
            tls: self.tls,
        }
    }

    pub fn is_closed(&self) -> bool {
        self.client.is_closed()
    }

    pub async fn run(&mut self, sql: &str, sink: &mut dyn RowSink) -> Result<RunSummary, DbError> {
        let types: Vec<Type> = match self.client.prepare(sql).await {
            Ok(statement) => statement
                .columns()
                .iter()
                .map(|column| column.type_().clone())
                .collect(),
            Err(err) if err.is_closed() => return Err(map_error(err)),
            Err(_) => Vec::new(),
        };
        let mut stream = pin!(self.client.simple_query_raw(sql).await.map_err(map_error)?);
        let mut summary = RunSummary::default();
        let mut collecting = false;
        let mut in_result = false;
        let mut stopped = false;
        while let Some(message) = stream.next().await {
            match message.map_err(map_error)? {
                SimpleQueryMessage::RowDescription(columns) => {
                    in_result = true;
                    collecting = summary.columns.is_none();
                    if collecting {
                        let metas: Vec<ColumnMeta> = columns
                            .iter()
                            .enumerate()
                            .map(|(index, column)| column_meta(column.name(), types.get(index)))
                            .collect();
                        sink.columns(&metas);
                        summary.columns = Some(metas);
                    }
                }
                SimpleQueryMessage::Row(row) => {
                    if collecting && !stopped {
                        let cells = (0..row.len())
                            .map(|index| row.get(index).map(str::to_string))
                            .collect();
                        if sink.row(cells) == SinkFlow::Stop {
                            stopped = true;
                        }
                    }
                }
                SimpleQueryMessage::CommandComplete(count) => {
                    if !in_result {
                        summary.rows_affected += count;
                    }
                    in_result = false;
                    collecting = false;
                }
                _ => {}
            }
        }
        Ok(summary)
    }

    pub fn close(self) {
        drop(self.client);
    }
}

impl PgCancel {
    pub async fn cancel(&self) -> Result<(), DbError> {
        match self.tls {
            TlsMode::Disabled => self.token.cancel_query(NoTls).await,
            mode => self.token.cancel_query(tls_connector(mode)?).await,
        }
        .map_err(map_error)
    }
}

fn column_meta(name: &str, column_type: Option<&Type>) -> ColumnMeta {
    let kind = match column_type {
        Some(ty) if *ty == Type::BOOL => ColumnKind::Boolean,
        Some(ty)
            if [
                Type::INT2,
                Type::INT4,
                Type::INT8,
                Type::OID,
                Type::FLOAT4,
                Type::FLOAT8,
                Type::NUMERIC,
                Type::MONEY,
            ]
            .contains(ty) =>
        {
            ColumnKind::Number
        }
        Some(ty)
            if [
                Type::DATE,
                Type::TIME,
                Type::TIMETZ,
                Type::TIMESTAMP,
                Type::TIMESTAMPTZ,
                Type::INTERVAL,
            ]
            .contains(ty) =>
        {
            ColumnKind::Temporal
        }
        Some(ty) if *ty == Type::JSON || *ty == Type::JSONB => ColumnKind::Json,
        Some(ty) if *ty == Type::BYTEA => ColumnKind::Binary,
        _ => ColumnKind::Text,
    };
    ColumnMeta {
        name: name.to_string(),
        type_name: column_type.map(type_label).unwrap_or_default(),
        kind,
    }
}

fn map_error(err: tokio_postgres::Error) -> DbError {
    if let Some(db) = err.as_db_error() {
        let mut message = format!("{}: {}", db.severity(), db.message());
        if let Some(detail) = db.detail() {
            message.push_str(&format!("\nDETAIL: {detail}"));
        }
        if let Some(hint) = db.hint() {
            message.push_str(&format!("\nHINT: {hint}"));
        }
        let position = match db.position() {
            Some(ErrorPosition::Original(position)) => Some(*position),
            _ => None,
        };
        return DbError {
            message,
            position,
            line: None,
            connection_lost: false,
        };
    }
    let io = std::error::Error::source(&err).is_some_and(|source| source.is::<std::io::Error>());
    if err.is_closed() || io {
        DbError::lost(err.to_string())
    } else {
        DbError::message(err.to_string())
    }
}

fn type_label(ty: &Type) -> String {
    match ty.name().strip_prefix('_') {
        Some(element) => format!("{element}[]"),
        None => ty.name().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_array_types_like_sql() {
        assert_eq!(type_label(&Type::TEXT_ARRAY), "text[]");
        assert_eq!(type_label(&Type::INT4), "int4");
        assert_eq!(
            column_meta("tags", Some(&Type::INT4_ARRAY)).type_name,
            "int4[]"
        );
        assert_eq!(
            column_meta("x", Some(&Type::NUMERIC)).kind,
            ColumnKind::Number
        );
        assert_eq!(column_meta("x", None).kind, ColumnKind::Text);
    }
}
