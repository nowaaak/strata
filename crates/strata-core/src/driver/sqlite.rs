use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::fallible_iterator::FallibleIterator;
use rusqlite::types::ValueRef;
use rusqlite::{Batch, InterruptHandle, OpenFlags};

use super::{
    ColumnKind, ColumnMeta, ConnectParams, DbError, Row, RowSink, RunSummary, ServerDetails,
    SinkFlow, hex,
};
use crate::sql::Dialect;

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub struct SqliteConnection {
    db: Arc<Mutex<rusqlite::Connection>>,
    interrupt: Arc<InterruptHandle>,
    details: ServerDetails,
}

#[derive(Clone)]
pub struct SqliteCancel {
    interrupt: Arc<InterruptHandle>,
}

fn map_error(err: rusqlite::Error) -> DbError {
    let message = match &err {
        rusqlite::Error::SqliteFailure(failure, Some(message)) => {
            format!("SQLITE {}: {message}", failure.extended_code)
        }
        rusqlite::Error::SqliteFailure(failure, None) => {
            format!("SQLITE {}: {failure}", failure.extended_code)
        }
        other => other.to_string(),
    };
    DbError::message(message)
}

pub fn create_file(path: &Path) -> Result<(), DbError> {
    if path.as_os_str().is_empty() {
        return Err(DbError::message("the database file must not be empty"));
    }
    if path.exists() {
        return Err(DbError::message(format!(
            "{} already exists",
            path.display()
        )));
    }
    let db = rusqlite::Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )
    .map_err(map_error)?;
    db.execute_batch("PRAGMA user_version = 0")
        .map_err(map_error)?;
    db.close().map_err(|(_, err)| map_error(err))
}

fn kind_for_declared(declared: &str) -> Option<ColumnKind> {
    let upper = declared.to_ascii_uppercase();
    if upper.is_empty() {
        return None;
    }
    Some(if upper.contains("BOOL") {
        ColumnKind::Boolean
    } else if upper.contains("JSON") {
        ColumnKind::Json
    } else if upper.contains("DATE") || upper.contains("TIME") {
        ColumnKind::Temporal
    } else if upper.contains("INT")
        || upper.contains("REAL")
        || upper.contains("FLOA")
        || upper.contains("DOUB")
        || upper.contains("NUM")
        || upper.contains("DEC")
    {
        ColumnKind::Number
    } else if upper.contains("BLOB") {
        ColumnKind::Binary
    } else {
        ColumnKind::Text
    })
}

fn kind_for_value(value: ValueRef<'_>) -> ColumnKind {
    match value {
        ValueRef::Integer(_) | ValueRef::Real(_) => ColumnKind::Number,
        ValueRef::Blob(_) => ColumnKind::Binary,
        ValueRef::Null | ValueRef::Text(_) => ColumnKind::Text,
    }
}

fn real(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}

fn cell(value: ValueRef<'_>) -> Option<String> {
    match value {
        ValueRef::Null => None,
        ValueRef::Integer(value) => Some(value.to_string()),
        ValueRef::Real(value) => Some(real(value)),
        ValueRef::Text(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(bytes) => Some(hex(bytes)),
    }
}

impl SqliteConnection {
    pub async fn connect(params: &ConnectParams) -> Result<Self, DbError> {
        let path = params.host.clone();
        let read_only = params.read_only;
        tokio::task::spawn_blocking(move || Self::open(&path, read_only))
            .await
            .map_err(|err| DbError::message(format!("opening the database failed: {err}")))?
    }

    fn open(path: &str, read_only: bool) -> Result<Self, DbError> {
        if !Path::new(path).is_file() {
            return Err(DbError::lost(format!("the file {path} does not exist")));
        }
        let mut flags = OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        flags |= if read_only {
            OpenFlags::SQLITE_OPEN_READ_ONLY
        } else {
            OpenFlags::SQLITE_OPEN_READ_WRITE
        };
        let db = rusqlite::Connection::open_with_flags(path, flags).map_err(map_error)?;
        db.busy_timeout(BUSY_TIMEOUT).map_err(map_error)?;
        let pragmas = if read_only {
            "PRAGMA foreign_keys = ON; PRAGMA query_only = ON"
        } else {
            "PRAGMA foreign_keys = ON"
        };
        db.execute_batch(pragmas).map_err(map_error)?;
        db.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
            .map_err(map_error)?;
        let interrupt = Arc::new(db.get_interrupt_handle());
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            interrupt,
            details: ServerDetails {
                flavor: "SQLite".into(),
                version: rusqlite::version().to_string(),
                database: Some("main".into()),
            },
        })
    }

    pub fn dialect(&self) -> Dialect {
        Dialect::Sqlite
    }

    pub fn details(&self) -> &ServerDetails {
        &self.details
    }

    pub fn cancel_handle(&self) -> SqliteCancel {
        SqliteCancel {
            interrupt: self.interrupt.clone(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, rusqlite::Connection> {
        self.db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub async fn run(&mut self, sql: &str, sink: &mut dyn RowSink) -> Result<RunSummary, DbError> {
        tokio::task::block_in_place(|| {
            let db = self.lock();
            run_batch(&db, sql, sink)
        })
    }

    pub async fn close(self) {
        let db = self.db;
        let closing = tokio::task::spawn_blocking(move || {
            if let Ok(mutex) = Arc::try_unwrap(db) {
                let db = mutex
                    .into_inner()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if let Err((_, err)) = db.close() {
                    tracing::debug!(error = %err, "sqlite connection did not close cleanly");
                }
            }
        });
        if let Err(err) = closing.await {
            tracing::debug!(error = %err, "closing the sqlite connection failed");
        }
    }
}

fn run_batch(
    db: &rusqlite::Connection,
    sql: &str,
    sink: &mut dyn RowSink,
) -> Result<RunSummary, DbError> {
    let mut summary = RunSummary::default();
    let mut batch = Batch::new(db, sql);
    while let Some(mut statement) = batch.next().map_err(map_error)? {
        let count = statement.column_count();
        if count == 0 {
            summary.rows_affected += statement.raw_execute().map_err(map_error)? as u64;
            continue;
        }
        let names: Vec<String> = statement.column_names().map(str::to_string).collect();
        let declared: Vec<Option<ColumnKind>> = statement
            .columns()
            .map(|column| column.decl_type().and_then(kind_for_declared))
            .collect();
        let collecting = summary.columns.is_none();
        let before = db.total_changes();
        let mut rows = statement.raw_query();
        let mut announced = false;
        let announce = |sink: &mut dyn RowSink, first: Option<&rusqlite::Row<'_>>| {
            let metas: Vec<ColumnMeta> = names
                .iter()
                .enumerate()
                .map(|(index, name)| {
                    let kind = declared[index].unwrap_or_else(|| {
                        first
                            .and_then(|row| row.get_ref(index).ok())
                            .map_or(ColumnKind::Text, kind_for_value)
                    });
                    ColumnMeta {
                        name: name.clone(),
                        type_name: String::new(),
                        kind,
                    }
                })
                .collect();
            sink.columns(&metas);
            metas
        };
        while let Some(row) = rows.next().map_err(map_error)? {
            if !collecting {
                continue;
            }
            if !announced {
                summary.columns = Some(announce(sink, Some(row)));
                announced = true;
            }
            let cells: Row = (0..count)
                .map(|index| row.get_ref(index).ok().and_then(cell))
                .collect();
            if sink.row(cells) == SinkFlow::Stop {
                break;
            }
        }
        if collecting && !announced {
            summary.columns = Some(announce(sink, None));
        }
        drop(rows);
        summary.rows_affected += db.total_changes().saturating_sub(before);
    }
    Ok(summary)
}

impl SqliteCancel {
    pub async fn cancel(&self) -> Result<(), DbError> {
        self.interrupt.interrupt();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Collect {
        columns: Vec<ColumnMeta>,
        rows: Vec<Row>,
    }

    impl RowSink for Collect {
        fn columns(&mut self, columns: &[ColumnMeta]) {
            self.columns = columns.to_vec();
        }

        fn row(&mut self, row: Row) -> SinkFlow {
            self.rows.push(row);
            SinkFlow::Continue
        }
    }

    #[test]
    fn maps_values_and_kinds() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, price REAL, data BLOB, day DATE, flag BOOLEAN);
             INSERT INTO t VALUES (1, 'Käse', 2.0, x'00ff', '2026-11-26', 1), (2, NULL, 0.1, NULL, NULL, 0);",
        )
        .unwrap();
        let mut sink = Collect::default();
        let summary =
            run_batch(&db, "SELECT *, 1 + 1 AS sum FROM t ORDER BY id", &mut sink).unwrap();
        let kinds: Vec<ColumnKind> = sink.columns.iter().map(|column| column.kind).collect();
        assert_eq!(
            kinds,
            [
                ColumnKind::Number,
                ColumnKind::Text,
                ColumnKind::Number,
                ColumnKind::Binary,
                ColumnKind::Temporal,
                ColumnKind::Boolean,
                ColumnKind::Number,
            ]
        );
        assert_eq!(
            sink.rows[0],
            [
                Some("1".into()),
                Some("Käse".into()),
                Some("2.0".into()),
                Some("0x00FF".into()),
                Some("2026-11-26".into()),
                Some("1".into()),
                Some("2".into()),
            ]
        );
        assert_eq!(sink.rows[1][1], None);
        assert_eq!(sink.rows[1][2].as_deref(), Some("0.1"));
        assert_eq!(summary.columns.unwrap().len(), 7);
    }

    #[test]
    fn counts_changes_and_reports_errors() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        let mut sink = Collect::default();
        let summary = run_batch(
            &db,
            "CREATE TABLE t (a); INSERT INTO t VALUES (1), (2); UPDATE t SET a = a + 1",
            &mut sink,
        )
        .unwrap();
        assert_eq!(summary.rows_affected, 4);
        assert!(summary.columns.is_none());
        let returning = run_batch(&db, "DELETE FROM t WHERE a = 2 RETURNING a", &mut sink).unwrap();
        assert_eq!(returning.rows_affected, 1);
        assert_eq!(sink.rows, [[Some("2".to_string())]]);
        let error = run_batch(&db, "SELECT * FROM missing", &mut sink).unwrap_err();
        assert!(
            error.message.starts_with("SQLITE 1: no such table"),
            "{}",
            error.message
        );
    }

    #[test]
    fn empty_results_still_announce_columns() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE t (a INTEGER, b TEXT)")
            .unwrap();
        let mut sink = Collect::default();
        run_batch(&db, "SELECT * FROM t", &mut sink).unwrap();
        assert_eq!(sink.columns.len(), 2);
        assert!(sink.rows.is_empty());
    }

    #[test]
    fn creates_a_file_only_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("neu.sqlite");
        create_file(&path).unwrap();
        assert!(path.is_file());
        assert!(create_file(&path).is_err());
        assert!(create_file(Path::new("")).is_err());
    }
}
