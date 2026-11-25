use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::prelude::Queryable;
use mysql_async::{Column, Conn, DriverError, Opts, OptsBuilder, SslOpts, Value};

use super::{
    ColumnKind, ColumnMeta, ConnectParams, DbError, RowSink, RunSummary, ServerDetails, SinkFlow,
    hex, parse_line,
};
use crate::profiles::TlsMode;
use crate::sql::Dialect;

const BINARY_CHARSET: u16 = 63;

pub struct MySqlConnection {
    conn: Conn,
    opts: Opts,
    dialect: Dialect,
    details: ServerDetails,
}

#[derive(Clone)]
pub struct MySqlCancel {
    opts: Opts,
    connection_id: u32,
}

impl MySqlConnection {
    pub async fn connect(params: &ConnectParams) -> Result<Self, DbError> {
        let mut builder = OptsBuilder::default()
            .ip_or_hostname(params.host.clone())
            .tcp_port(params.port)
            .user(Some(params.user.clone()))
            .pass(params.password.clone())
            .db_name(params.database.clone())
            .prefer_socket(false)
            .client_found_rows(true)
            .stmt_cache_size(0);
        if params.read_only {
            builder = builder.init(vec!["SET SESSION TRANSACTION READ ONLY"]);
        }
        builder = match params.tls {
            TlsMode::Disabled => builder,
            TlsMode::Required => builder.ssl_opts(
                SslOpts::default()
                    .with_danger_accept_invalid_certs(true)
                    .with_danger_skip_domain_validation(true),
            ),
            TlsMode::VerifyFull => builder.ssl_opts(SslOpts::default()),
        };
        let opts = Opts::from(builder);
        let mut conn = Conn::new(opts.clone()).await.map_err(map_error)?;
        let info: Option<(String, String, Option<String>)> = conn
            .query_first("SELECT VERSION(), @@SESSION.sql_mode, DATABASE()")
            .await
            .map_err(map_error)?;
        let (version, sql_mode, database) =
            info.ok_or_else(|| DbError::message("server did not report its version"))?;
        let flavor = if version.contains("MariaDB") {
            "MariaDB"
        } else {
            "MySQL"
        };
        let version = version
            .split("-MariaDB")
            .next()
            .unwrap_or(&version)
            .to_string();
        Ok(Self {
            conn,
            opts,
            dialect: Dialect::MySql {
                backslash_escapes: !sql_mode.contains("NO_BACKSLASH_ESCAPES"),
            },
            details: ServerDetails {
                flavor: flavor.into(),
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

    pub fn cancel_handle(&self) -> MySqlCancel {
        MySqlCancel {
            opts: self.opts.clone(),
            connection_id: self.conn.id(),
        }
    }

    pub async fn use_database(&mut self, database: &str) -> Result<(), DbError> {
        let sql = format!("USE {}", self.dialect.quote_ident(database));
        self.conn.query_drop(sql).await.map_err(map_error)?;
        self.details.database = Some(database.to_string());
        Ok(())
    }

    pub async fn run(&mut self, sql: &str, sink: &mut dyn RowSink) -> Result<RunSummary, DbError> {
        let mut result = self.conn.query_iter(sql).await.map_err(map_error)?;
        let mut summary = RunSummary::default();
        let mut stopped = false;
        loop {
            match result.columns().filter(|columns| !columns.is_empty()) {
                None => {
                    summary.rows_affected += result.affected_rows();
                    while result.next().await.map_err(map_error)?.is_some() {}
                }
                Some(columns) => {
                    let collect = summary.columns.is_none();
                    let binary: Vec<bool> = columns.iter().map(is_binary).collect();
                    if collect {
                        let metas: Vec<ColumnMeta> = columns.iter().map(column_meta).collect();
                        sink.columns(&metas);
                        summary.columns = Some(metas);
                    }
                    while let Some(row) = result.next().await.map_err(map_error)? {
                        if !collect || stopped {
                            continue;
                        }
                        let cells = row
                            .unwrap()
                            .into_iter()
                            .zip(&binary)
                            .map(|(value, binary)| cell(value, *binary))
                            .collect();
                        if sink.row(cells) == SinkFlow::Stop {
                            stopped = true;
                        }
                    }
                }
            }
            if result.is_empty() {
                break;
            }
        }
        Ok(summary)
    }

    pub async fn close(self) {
        if let Err(err) = self.conn.disconnect().await {
            tracing::debug!(error = %err, "mysql disconnect failed");
        }
    }
}

impl MySqlCancel {
    pub async fn cancel(&self) -> Result<(), DbError> {
        let mut conn = Conn::new(self.opts.clone()).await.map_err(map_error)?;
        let outcome = conn
            .query_drop(format!("KILL QUERY {}", self.connection_id))
            .await
            .map_err(map_error);
        if let Err(err) = conn.disconnect().await {
            tracing::debug!(error = %err, "mysql cancel disconnect failed");
        }
        outcome
    }
}

fn is_binary(column: &Column) -> bool {
    matches!(
        column.column_type(),
        ColumnType::MYSQL_TYPE_BIT
            | ColumnType::MYSQL_TYPE_GEOMETRY
            | ColumnType::MYSQL_TYPE_VECTOR
    ) || (column.character_set() == BINARY_CHARSET
        && matches!(
            column.column_type(),
            ColumnType::MYSQL_TYPE_TINY_BLOB
                | ColumnType::MYSQL_TYPE_MEDIUM_BLOB
                | ColumnType::MYSQL_TYPE_LONG_BLOB
                | ColumnType::MYSQL_TYPE_BLOB
                | ColumnType::MYSQL_TYPE_VAR_STRING
                | ColumnType::MYSQL_TYPE_STRING
                | ColumnType::MYSQL_TYPE_VARCHAR
        ))
}

fn column_meta(column: &Column) -> ColumnMeta {
    use ColumnType::*;
    let column_type = column.column_type();
    let kind = if is_binary(column) {
        ColumnKind::Binary
    } else {
        match column_type {
            MYSQL_TYPE_TINY
            | MYSQL_TYPE_SHORT
            | MYSQL_TYPE_LONG
            | MYSQL_TYPE_INT24
            | MYSQL_TYPE_LONGLONG
            | MYSQL_TYPE_FLOAT
            | MYSQL_TYPE_DOUBLE
            | MYSQL_TYPE_DECIMAL
            | MYSQL_TYPE_NEWDECIMAL => ColumnKind::Number,
            MYSQL_TYPE_DATE
            | MYSQL_TYPE_NEWDATE
            | MYSQL_TYPE_TIME
            | MYSQL_TYPE_TIME2
            | MYSQL_TYPE_DATETIME
            | MYSQL_TYPE_DATETIME2
            | MYSQL_TYPE_TIMESTAMP
            | MYSQL_TYPE_TIMESTAMP2
            | MYSQL_TYPE_YEAR => ColumnKind::Temporal,
            MYSQL_TYPE_JSON => ColumnKind::Json,
            _ => ColumnKind::Text,
        }
    };
    let type_name = sql_type_name(column);
    ColumnMeta {
        name: column.name_str().into_owned(),
        type_name,
        kind,
    }
}

fn sql_type_name(column: &Column) -> String {
    use ColumnType::*;
    let binary = column.character_set() == BINARY_CHARSET;
    let flags = column.flags();
    let name = match column.column_type() {
        MYSQL_TYPE_TINY => "tinyint",
        MYSQL_TYPE_SHORT => "smallint",
        MYSQL_TYPE_INT24 => "mediumint",
        MYSQL_TYPE_LONG => "int",
        MYSQL_TYPE_LONGLONG => "bigint",
        MYSQL_TYPE_FLOAT => "float",
        MYSQL_TYPE_DOUBLE => "double",
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => "decimal",
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => "date",
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => "time",
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 => "datetime",
        MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2 => "timestamp",
        MYSQL_TYPE_YEAR => "year",
        MYSQL_TYPE_JSON => "json",
        MYSQL_TYPE_BIT => "bit",
        MYSQL_TYPE_GEOMETRY => "geometry",
        MYSQL_TYPE_VECTOR => "vector",
        MYSQL_TYPE_ENUM => "enum",
        MYSQL_TYPE_SET => "set",
        MYSQL_TYPE_NULL => "null",
        MYSQL_TYPE_STRING if flags.contains(ColumnFlags::ENUM_FLAG) => "enum",
        MYSQL_TYPE_STRING if flags.contains(ColumnFlags::SET_FLAG) => "set",
        MYSQL_TYPE_VARCHAR | MYSQL_TYPE_VAR_STRING if binary => "varbinary",
        MYSQL_TYPE_VARCHAR | MYSQL_TYPE_VAR_STRING => "varchar",
        MYSQL_TYPE_STRING if binary => "binary",
        MYSQL_TYPE_STRING => "char",
        MYSQL_TYPE_TINY_BLOB | MYSQL_TYPE_MEDIUM_BLOB | MYSQL_TYPE_LONG_BLOB | MYSQL_TYPE_BLOB
            if binary =>
        {
            "blob"
        }
        MYSQL_TYPE_TINY_BLOB | MYSQL_TYPE_MEDIUM_BLOB | MYSQL_TYPE_LONG_BLOB | MYSQL_TYPE_BLOB => {
            "text"
        }
        _ => "",
    };
    name.to_string()
}

fn cell(value: Value, binary: bool) -> Option<String> {
    match value {
        Value::NULL => None,
        Value::Bytes(bytes) if binary => Some(hex(&bytes)),
        Value::Bytes(bytes) => Some(match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(err) => hex(err.as_bytes()),
        }),
        Value::Int(number) => Some(number.to_string()),
        Value::UInt(number) => Some(number.to_string()),
        Value::Float(number) => Some(number.to_string()),
        Value::Double(number) => Some(number.to_string()),
        other => Some(other.as_sql(true)),
    }
}

fn map_error(err: mysql_async::Error) -> DbError {
    match &err {
        mysql_async::Error::Server(server) => DbError {
            message: format!(
                "ERROR {} ({}): {}",
                server.code, server.state, server.message
            ),
            position: None,
            line: parse_line(&server.message),
            connection_lost: false,
        },
        mysql_async::Error::Io(_) | mysql_async::Error::Driver(DriverError::ConnectionClosed) => {
            DbError::lost(err.to_string())
        }
        _ => DbError::message(err.to_string()),
    }
}
