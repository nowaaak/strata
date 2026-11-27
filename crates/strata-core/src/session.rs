use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use ts_rs::TS;

use crate::design::{self, AlterOp, NewTable, TableDesign};
use crate::driver::{
    CancelHandle, ColumnMeta, ConnectParams, Connection, DbError, Row, RowSink, ServerDetails,
    SinkFlow,
};
use crate::dump::{self, DumpOptions, DumpProgress, DumpSummary, InsertWriter, RoutineDump};
use crate::export::{ExportFormat, ExportSource, ExportSummary, StreamWriter};
use crate::graph::{self, SchemaGraph};
use crate::import::{self, CsvImport, ImportSummary};
use crate::processes::{self, KillMode, ProcessInfo};
use crate::profiles::{ConnectionProfile, Engine, PasswordUpdate, ProfileStore, Safety};
use crate::rebuild::{self, SqliteObjects};
use crate::result::ResultSet;
use crate::routines::{self, DdlQuery, Routine, RoutineKind, RoutineTarget};
use crate::schema::{self, CompletionTable, DbObject, TableInfo, TableTarget};
use crate::server::{self, ServerInfoKind, ServerSetting};
use crate::sql::{
    DdlAction, Dialect, RowChange, SqlStatement, TableQuery, change_statement, ddl_statement,
    select_statement, split_statements,
};
use crate::ssh::SshTunnel;
use crate::users::{self, UserAccount, UserAction, UserDetail, UserRef};
use crate::{CoreError, CoreResult};

pub const QUERY_ROW_CAP: usize = 1_000_000;
const FETCH_LIMIT: usize = 5_000;
const FLUSH_ROWS: usize = 2_000;
const FLUSH_INTERVAL_MS: u128 = 120;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionInfo {
    pub session_id: String,
    pub profile_id: String,
    pub engine: Engine,
    pub read_only: bool,
    pub server: ServerDetails,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum StatementOutcome {
    Rows {
        result: u32,
        rows: u32,
        truncated: bool,
    },
    Affected {
        rows: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum QueryEvent {
    Plan {
        statements: Vec<SqlStatement>,
    },
    StatementStarted {
        index: u32,
    },
    Columns {
        index: u32,
        result: u32,
        columns: Vec<ColumnMeta>,
    },
    Progress {
        index: u32,
        result: u32,
        rows: u32,
    },
    StatementFinished {
        index: u32,
        elapsed_ms: u32,
        outcome: StatementOutcome,
    },
    StatementFailed {
        index: u32,
        message: String,
        error_at: Option<u32>,
        cancelled: bool,
    },
    Finished {
        elapsed_ms: u32,
        cancelled: bool,
    },
}

pub type EventSink<'a> = &'a (dyn Fn(QueryEvent) + Send + Sync);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExecutionSummary {
    pub statements: u32,
    pub elapsed_ms: u32,
    pub rows: Option<u32>,
    pub affected: Option<u32>,
    pub failed: bool,
    pub cancelled: bool,
    pub error: Option<String>,
}

pub struct SessionManager {
    profiles: Arc<ProfileStore>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

impl SessionManager {
    pub fn new(profiles: Arc<ProfileStore>) -> Self {
        Self {
            profiles,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn test(
        &self,
        profile: &ConnectionProfile,
        password: &PasswordUpdate,
        ssh_secret: &PasswordUpdate,
    ) -> CoreResult<ServerDetails> {
        let password = self.profiles.resolve_password(profile, password)?;
        let tunnel = self.tunnel(profile, ssh_secret).await?;
        let params = connect_params(
            profile,
            password,
            profile.database.clone(),
            tunnel.as_ref().map(SshTunnel::local_port),
        );
        let conn = Connection::connect(&params).await?;
        let details = conn.details().clone();
        conn.close().await;
        Ok(details)
    }

    async fn tunnel(
        &self,
        profile: &ConnectionProfile,
        ssh_secret: &PasswordUpdate,
    ) -> CoreResult<Option<SshTunnel>> {
        let Some(ssh) = profile.ssh.clone() else {
            return Ok(None);
        };
        let secret = self.profiles.resolve_ssh_secret(profile, ssh_secret)?;
        SshTunnel::open(ssh, secret, profile.host.clone(), profile.port)
            .await
            .map(Some)
    }

    pub async fn open(
        &self,
        profile_id: &str,
        password: Option<String>,
    ) -> CoreResult<SessionInfo> {
        let profile = self.profiles.get(profile_id).await?;
        let password = match password {
            Some(password) => Some(password),
            None => self
                .profiles
                .resolve_password(&profile, &PasswordUpdate::Keep)?,
        };
        let tunnel = self.tunnel(&profile, &PasswordUpdate::Keep).await?;
        let conn = Connection::connect(&connect_params(
            &profile,
            password.clone(),
            profile.database.clone(),
            tunnel.as_ref().map(SshTunnel::local_port),
        ))
        .await?;
        let details = conn.details().clone();
        let dialect = conn.dialect();
        let meta_key = meta_key(dialect, details.database.as_deref());
        let session = Arc::new(Session {
            id: uuid::Uuid::new_v4().to_string(),
            profile,
            password,
            details,
            dialect,
            meta: tokio::sync::Mutex::new(HashMap::from([(meta_key, conn)])),
            tunnel,
            tabs: Mutex::new(HashMap::new()),
            exports: Mutex::new(HashMap::new()),
        });
        let info = session.info();
        lock(&self.sessions).insert(session.id.clone(), session);
        Ok(info)
    }

    pub fn get(&self, session_id: &str) -> CoreResult<Arc<Session>> {
        lock(&self.sessions)
            .get(session_id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("session {session_id} is not open")))
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        lock(&self.sessions)
            .values()
            .map(|session| session.info())
            .collect()
    }

    pub async fn close(&self, session_id: &str) -> CoreResult<()> {
        let session = lock(&self.sessions)
            .remove(session_id)
            .ok_or_else(|| CoreError::NotFound(format!("session {session_id} is not open")))?;
        session.shutdown().await;
        Ok(())
    }

    pub async fn close_profile(&self, profile_id: &str) {
        let sessions: Vec<Arc<Session>> = {
            let mut map = lock(&self.sessions);
            let ids: Vec<String> = map
                .values()
                .filter(|session| session.profile.id == profile_id)
                .map(|session| session.id.clone())
                .collect();
            ids.iter().filter_map(|id| map.remove(id)).collect()
        };
        for session in sessions {
            session.shutdown().await;
        }
    }
}

fn connect_params(
    profile: &ConnectionProfile,
    password: Option<String>,
    database: Option<String>,
    tunnel_port: Option<u16>,
) -> ConnectParams {
    let (host, port, tls_server_name) = match tunnel_port {
        Some(port) => ("127.0.0.1".to_string(), port, Some(profile.host.clone())),
        None => (profile.host.clone(), profile.port, None),
    };
    ConnectParams {
        engine: profile.engine,
        host,
        port,
        user: profile.user.clone(),
        password,
        database,
        tls: profile.tls,
        read_only: profile.safety == Safety::ReadOnly,
        tls_server_name,
    }
}

fn sqlite_plan_json(rows: &[Row]) -> String {
    let steps: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let number = |index: usize| {
                row.get(index)
                    .cloned()
                    .flatten()
                    .and_then(|value| value.parse::<i64>().ok())
                    .unwrap_or_default()
            };
            serde_json::json!({
                "id": number(0),
                "parent": number(1),
                "detail": row.get(3).cloned().flatten().unwrap_or_default(),
            })
        })
        .collect();
    serde_json::json!({ "sqlite": steps }).to_string()
}

fn meta_key(dialect: Dialect, database: Option<&str>) -> String {
    match dialect {
        Dialect::MySql { .. } => String::new(),
        Dialect::Postgres { .. } => database.unwrap_or_default().to_string(),
        Dialect::Sqlite => String::new(),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct Session {
    id: String,
    profile: ConnectionProfile,
    password: Option<String>,
    details: ServerDetails,
    dialect: Dialect,
    meta: tokio::sync::Mutex<HashMap<String, Connection>>,
    tunnel: Option<SshTunnel>,
    tabs: Mutex<HashMap<String, Arc<Tab>>>,
    exports: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Default)]
struct Tab {
    conn: tokio::sync::Mutex<Option<Connection>>,
    cancel: Mutex<Option<CancelHandle>>,
    cancelled: AtomicBool,
    results: Mutex<Vec<Arc<ResultSet>>>,
}

impl Session {
    pub fn info(&self) -> SessionInfo {
        SessionInfo {
            session_id: self.id.clone(),
            profile_id: self.profile.id.clone(),
            engine: self.profile.engine,
            read_only: self.read_only(),
            server: self.details.clone(),
        }
    }

    pub fn dialect(&self) -> Dialect {
        self.dialect
    }

    fn read_only(&self) -> bool {
        self.profile.safety == Safety::ReadOnly
    }

    fn params(&self, database: Option<String>) -> ConnectParams {
        connect_params(
            &self.profile,
            self.password.clone(),
            database,
            self.tunnel.as_ref().map(SshTunnel::local_port),
        )
    }

    async fn shutdown(&self) {
        let tabs: Vec<Arc<Tab>> = lock(&self.tabs).drain().map(|(_, tab)| tab).collect();
        for tab in tabs {
            close_tab_connection(&tab).await;
        }
        let mut meta = self.meta.lock().await;
        for (_, conn) in meta.drain() {
            conn.close().await;
        }
    }

    pub async fn meta_rows(&self, database: Option<&str>, sql: &str) -> CoreResult<Vec<Row>> {
        let database = database
            .map(str::to_string)
            .or_else(|| self.details.database.clone());
        let key = meta_key(self.dialect, database.as_deref());
        let mut meta = self.meta.lock().await;
        let mut retried = false;
        loop {
            let conn = self
                .meta_connection(&mut meta, &key, database.as_deref())
                .await?;
            match conn.query_rows(sql).await {
                Ok(rows) => return Ok(rows),
                Err(err) if err.connection_lost && !retried => {
                    retried = true;
                    meta.remove(&key);
                }
                Err(err) => return Err(err.into()),
            }
        }
    }

    async fn meta_connection<'a>(
        &self,
        meta: &'a mut HashMap<String, Connection>,
        key: &str,
        database: Option<&str>,
    ) -> CoreResult<&'a mut Connection> {
        if meta.get(key).is_none_or(Connection::is_closed) {
            if let Some(old) = meta.remove(key) {
                old.close().await;
            }
            let target = if self.dialect.is_mysql() {
                self.profile.database.clone()
            } else {
                database.map(str::to_string)
            };
            let conn = Connection::connect(&self.params(target)).await?;
            meta.insert(key.to_string(), conn);
        }
        meta.get_mut(key)
            .ok_or_else(|| CoreError::Connection("metadata connection is unavailable".into()))
    }

    pub fn preview_ddl(&self, action: &DdlAction) -> CoreResult<String> {
        ddl_statement(self.dialect, action)
    }

    pub async fn run_ddl(&self, action: &DdlAction) -> CoreResult<String> {
        if self.read_only() {
            return Err(CoreError::ReadOnly(
                "this connection is read-only, the structure cannot be changed".into(),
            ));
        }
        let sql = ddl_statement(self.dialect, action)?;
        let affected = action
            .affected_database()
            .filter(|_| self.dialect.is_postgres());
        let database = match affected {
            Some(affected) => Some(self.maintenance_database(affected)),
            None => action
                .working_database()
                .map(str::to_string)
                .or_else(|| self.details.database.clone()),
        };
        let key = meta_key(self.dialect, database.as_deref());
        if let Some(affected) = affected {
            self.release_database(affected).await;
        }
        let mut meta = self.meta.lock().await;
        if let Some(affected) = affected
            && let Some(conn) = meta.remove(affected)
        {
            conn.close().await;
        }
        let conn = self
            .meta_connection(&mut meta, &key, database.as_deref())
            .await?;
        match conn.execute(&sql).await {
            Ok(_) => Ok(sql),
            Err(err) => {
                if err.connection_lost {
                    meta.remove(&key);
                }
                Err(err.into())
            }
        }
    }

    async fn release_database(&self, database: &str) {
        let tabs: Vec<Arc<Tab>> = lock(&self.tabs).values().cloned().collect();
        for tab in tabs {
            let Ok(mut slot) = tab.conn.try_lock() else {
                continue;
            };
            let connected = slot
                .as_ref()
                .is_some_and(|conn| conn.details().database.as_deref() == Some(database));
            if connected && let Some(conn) = slot.take() {
                conn.close().await;
            }
        }
    }

    fn maintenance_database(&self, affected: &str) -> String {
        match self.details.database.as_deref() {
            Some(current) if current != affected => current.to_string(),
            _ if affected == "postgres" => "template1".to_string(),
            _ => "postgres".to_string(),
        }
    }

    fn is_mariadb(&self) -> bool {
        self.details.flavor == "MariaDB"
    }

    pub async fn table_design(&self, target: &TableTarget) -> CoreResult<TableDesign> {
        let database = Some(target.database.as_str());
        let columns = self
            .meta_rows(database, &design::columns_sql(self.dialect, target))
            .await?;
        if columns.is_empty() {
            return Err(CoreError::NotFound(format!(
                "table {} does not exist",
                target.table
            )));
        }
        let indexes = self
            .meta_rows(database, &design::indexes_sql(self.dialect, target))
            .await?;
        let foreign_keys = self
            .meta_rows(database, &design::foreign_keys_sql(self.dialect, target))
            .await?;
        Ok(TableDesign {
            columns: design::parse_columns(self.dialect, columns),
            indexes: design::parse_indexes(indexes),
            foreign_keys: design::parse_foreign_keys(foreign_keys),
        })
    }

    async fn alter_plan(
        &self,
        target: &TableTarget,
        ops: &[AlterOp],
    ) -> CoreResult<(Vec<String>, bool)> {
        let current = self.table_design(target).await?;
        if self.dialect.is_sqlite() && rebuild::needs_rebuild(&current, ops) {
            let objects = self.sqlite_objects(target).await?;
            return Ok((rebuild::statements(target, &current, &objects, ops)?, true));
        }
        Ok((
            design::alter_statements(self.dialect, self.is_mariadb(), target, &current, ops)?,
            false,
        ))
    }

    async fn sqlite_objects(&self, target: &TableTarget) -> CoreResult<SqliteObjects> {
        let sql = format!(
            "SELECT type, name, sql FROM {}.sqlite_master WHERE tbl_name = {} AND sql IS NOT NULL ORDER BY type, name",
            self.dialect.quote_ident(&target.database),
            self.dialect.quote_literal(&target.table)
        );
        let rows = self.meta_rows(Some(&target.database), &sql).await?;
        let mut objects = SqliteObjects {
            table_sql: String::new(),
            indexes: Vec::new(),
            triggers: Vec::new(),
        };
        for row in rows {
            let mut cells = row.into_iter();
            let (Some(kind), Some(name), Some(sql)) = (
                cells.next().flatten(),
                cells.next().flatten(),
                cells.next().flatten(),
            ) else {
                continue;
            };
            match kind.as_str() {
                "table" => objects.table_sql = sql,
                "index" => objects.indexes.push((name, sql)),
                "trigger" => objects.triggers.push(sql),
                _ => {}
            }
        }
        if objects.table_sql.is_empty() {
            return Err(CoreError::NotFound(format!(
                "table {} does not exist",
                target.table
            )));
        }
        Ok(objects)
    }

    pub async fn preview_alter(
        &self,
        target: &TableTarget,
        ops: &[AlterOp],
    ) -> CoreResult<Vec<String>> {
        Ok(self.alter_plan(target, ops).await?.0)
    }

    pub async fn apply_alter(
        &self,
        target: &TableTarget,
        ops: &[AlterOp],
    ) -> CoreResult<Vec<String>> {
        self.ensure_writable()?;
        let (statements, rebuilt) = self.alter_plan(target, ops).await?;
        if rebuilt {
            self.run_sqlite_rebuild(&target.database, &statements)
                .await?;
        } else {
            self.run_structure(&target.database, &statements).await?;
        }
        Ok(statements)
    }

    async fn run_sqlite_rebuild(&self, database: &str, statements: &[String]) -> CoreResult<()> {
        let body: Vec<&String> = statements
            .iter()
            .filter(|statement| {
                statement.as_str() != rebuild::FOREIGN_KEYS_OFF
                    && !statement.starts_with(rebuild::FOREIGN_KEY_CHECK)
            })
            .collect();
        let check = statements
            .iter()
            .find(|statement| statement.starts_with(rebuild::FOREIGN_KEY_CHECK))
            .cloned()
            .unwrap_or_else(|| rebuild::FOREIGN_KEY_CHECK.to_string());
        let key = meta_key(self.dialect, Some(database));
        let mut meta = self.meta.lock().await;
        let conn = self
            .meta_connection(&mut meta, &key, Some(database))
            .await?;
        conn.execute(rebuild::FOREIGN_KEYS_OFF).await?;
        let outcome: CoreResult<()> = async {
            conn.execute("PRAGMA legacy_alter_table = ON").await?;
            conn.execute("BEGIN").await?;
            let changed: CoreResult<()> = async {
                for statement in &body {
                    conn.execute(statement).await?;
                }
                let violations = conn.query_rows(&check).await?;
                if !violations.is_empty() {
                    return Err(CoreError::Database(format!(
                        "{} rows would break foreign keys after the rebuild, nothing was changed",
                        violations.len()
                    )));
                }
                conn.execute("COMMIT").await?;
                Ok(())
            }
            .await;
            if changed.is_err()
                && let Err(rollback) = conn.execute("ROLLBACK").await
            {
                tracing::warn!(error = %rollback.message, "rollback failed");
            }
            changed
        }
        .await;
        for restore in [
            "PRAGMA legacy_alter_table = OFF",
            "PRAGMA foreign_keys = ON",
        ] {
            if let Err(err) = conn.execute(restore).await {
                tracing::warn!(error = %err.message, "sqlite pragma could not be restored");
            }
        }
        outcome
    }

    pub fn preview_create(&self, table: &NewTable) -> CoreResult<Vec<String>> {
        design::create_statements(self.dialect, self.is_mariadb(), table)
    }

    pub async fn apply_create(&self, table: &NewTable) -> CoreResult<Vec<String>> {
        self.ensure_writable()?;
        let statements = self.preview_create(table)?;
        self.run_structure(&table.target.database, &statements)
            .await?;
        Ok(statements)
    }

    fn ensure_writable(&self) -> CoreResult<()> {
        if self.read_only() {
            return Err(CoreError::ReadOnly(
                "this connection is read-only, the structure cannot be changed".into(),
            ));
        }
        Ok(())
    }

    async fn run_structure(&self, database: &str, statements: &[String]) -> CoreResult<()> {
        let key = meta_key(self.dialect, Some(database));
        let mut meta = self.meta.lock().await;
        let conn = self
            .meta_connection(&mut meta, &key, Some(database))
            .await?;
        let transactional = !self.dialect.is_mysql() && statements.len() > 1;
        if transactional {
            conn.execute("BEGIN").await?;
        }
        for statement in statements {
            if let Err(err) = conn.execute(statement).await {
                let lost = err.connection_lost;
                if transactional
                    && !lost
                    && let Err(rollback) = conn.execute("ROLLBACK").await
                {
                    tracing::warn!(error = %rollback.message, "rollback failed");
                }
                if lost {
                    meta.remove(&key);
                }
                return Err(err.into());
            }
        }
        if transactional {
            conn.execute("COMMIT").await?;
        }
        Ok(())
    }

    pub async fn list_routines(
        &self,
        database: &str,
        schema: Option<&str>,
    ) -> CoreResult<Vec<Routine>> {
        let sql = match self.dialect {
            Dialect::MySql { .. } => routines::mysql_routines_sql(self.dialect, database),
            Dialect::Postgres { .. } => {
                routines::pg_routines_sql(self.dialect, schema.unwrap_or("public"))
            }
            Dialect::Sqlite => routines::sqlite_routines_sql(self.dialect, database),
        };
        let rows = self.meta_rows(Some(database), &sql).await?;
        Ok(routines::parse_routines(self.dialect, rows))
    }

    pub async fn routine_ddl(&self, target: &RoutineTarget) -> CoreResult<String> {
        let database = Some(target.database.as_str());
        let missing = || {
            CoreError::NotFound(format!(
                "the definition of {} is not available, it may have been dropped or you lack the privilege to see it",
                target.routine.name
            ))
        };
        match routines::ddl_query(self.dialect, target)? {
            DdlQuery::Show { sql, column } => {
                let rows = self.meta_rows(database, &sql).await?;
                rows.into_iter()
                    .next()
                    .and_then(|row| row.into_iter().nth(column).flatten())
                    .map(|ddl| format!("{ddl};"))
                    .ok_or_else(missing)
            }
            DdlQuery::Value(sql) => {
                let rows = self.meta_rows(database, &sql).await?;
                rows.into_iter()
                    .next()
                    .and_then(|row| row.into_iter().next().flatten())
                    .ok_or_else(missing)
            }
            DdlQuery::Sequence(sql) => {
                let rows = self.meta_rows(database, &sql).await?;
                rows.first()
                    .map(|row| routines::sequence_ddl(self.dialect, target, row))
                    .ok_or_else(missing)
            }
        }
    }

    pub async fn export_full(
        &self,
        export_id: &str,
        source: &ExportSource,
        format: ExportFormat,
        path: std::path::PathBuf,
        progress: Box<dyn Fn(u64) + Send + Sync>,
    ) -> CoreResult<ExportSummary> {
        let (database, sql) = match source {
            ExportSource::Query { database, sql } => (database.clone(), sql.clone()),
            ExportSource::Table {
                target,
                filter,
                sort,
            } => (
                Some(target.database.clone()),
                select_statement(
                    self.dialect,
                    &target.qualified(self.dialect),
                    &TableQuery {
                        filter: filter.clone(),
                        sort: sort.clone(),
                        limit: u32::MAX,
                    },
                )?,
            ),
        };
        let statements = split_statements(&sql, self.dialect);
        let [statement] = statements.as_slice() else {
            return Err(CoreError::InvalidInput(
                "a full export needs exactly one statement".into(),
            ));
        };
        if statement.writes {
            return Err(CoreError::InvalidInput(
                "only reading statements can be exported, a full export runs the statement again"
                    .into(),
            ));
        }
        let wanted = database.clone().or_else(|| self.details.database.clone());
        let mut conn = Connection::connect(&self.params(wanted)).await?;
        if self.dialect.is_mysql()
            && let Some(database) = &database
            && let Err(err) = conn.use_database(database).await
        {
            conn.close().await;
            return Err(err.into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        lock(&self.exports).insert(export_id.to_string(), cancel.clone());
        let handle = conn.cancel_handle();
        let watcher = tokio::spawn({
            let cancel = cancel.clone();
            async move {
                while !cancel.load(Ordering::SeqCst) {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
                if let Err(err) = handle.cancel().await {
                    tracing::debug!(error = %err.message, "export cancel failed");
                }
            }
        });
        let outcome = match StreamWriter::create(format, path, cancel.clone(), progress) {
            Ok(mut writer) => match conn.run(&statement.text, &mut writer).await {
                Ok(_) => writer.finish(),
                Err(_) if cancel.load(Ordering::SeqCst) => writer.finish(),
                Err(err) => {
                    writer.discard();
                    Err(err.into())
                }
            },
            Err(err) => Err(err),
        };
        watcher.abort();
        lock(&self.exports).remove(export_id);
        conn.close().await;
        outcome
    }

    pub async fn import_csv(
        &self,
        request: &CsvImport,
        progress: Box<dyn Fn(u32) + Send + Sync>,
    ) -> CoreResult<ImportSummary> {
        self.ensure_writable()?;
        let info = self.describe_table(&request.target).await?;
        let numeric = request
            .mapping
            .iter()
            .map(|mapping| {
                info.columns
                    .iter()
                    .find(|column| column.name == mapping.column)
                    .map(|column| import::is_numeric_type(&column.data_type))
                    .ok_or_else(|| {
                        CoreError::NotFound(format!("column {} does not exist", mapping.column))
                    })
            })
            .collect::<CoreResult<Vec<_>>>()?;
        let path = std::path::PathBuf::from(&request.path);
        let options = request.options.clone();
        let parsed = tokio::task::spawn_blocking(move || import::read_csv(&path, &options))
            .await
            .map_err(|err| CoreError::InvalidInput(format!("reading the file failed: {err}")))??;
        let mut records = parsed.records;
        if request.options.header && !records.is_empty() {
            records.remove(0);
        }
        if records.is_empty() {
            return Err(CoreError::InvalidInput("the file contains no rows".into()));
        }
        let statements = import::insert_statements(self.dialect, request, &numeric, &records)?;
        let total = records.len();
        let mut conn =
            Connection::connect(&self.params(Some(request.target.database.clone()))).await?;
        let begin = if self.dialect.is_mysql() {
            "START TRANSACTION"
        } else {
            "BEGIN"
        };
        let outcome = async {
            conn.execute(begin).await?;
            for (offset, statement) in &statements {
                if let Err(err) = conn.execute(statement).await {
                    let last = (offset + import::BATCH_ROWS).min(total);
                    if let Err(rollback) = conn.execute("ROLLBACK").await {
                        tracing::warn!(error = %rollback.message, "rollback failed");
                    }
                    return Err(CoreError::Database(format!(
                        "rows {} to {last} were rejected, nothing was imported: {}",
                        offset + 1,
                        err.message
                    )));
                }
                progress(
                    u32::try_from((offset + import::BATCH_ROWS).min(total)).unwrap_or(u32::MAX),
                );
            }
            conn.execute("COMMIT").await?;
            Ok(ImportSummary {
                rows: u32::try_from(total).unwrap_or(u32::MAX),
            })
        }
        .await;
        conn.close().await;
        outcome
    }

    pub async fn explain(
        &self,
        database: Option<&str>,
        sql: &str,
        analyze: bool,
    ) -> CoreResult<String> {
        let statements = split_statements(sql, self.dialect);
        let [statement] = statements.as_slice() else {
            return Err(CoreError::InvalidInput(
                "explain needs exactly one statement".into(),
            ));
        };
        if analyze && (!self.dialect.is_postgres() || statement.writes) {
            return Err(CoreError::InvalidInput(
                "ANALYZE runs the statement, it is only offered for reading statements on PostgreSQL"
                    .into(),
            ));
        }
        let text = statement.text.trim().trim_end_matches(';');
        let explain = match (self.dialect, analyze) {
            (Dialect::MySql { .. }, _) => format!("EXPLAIN FORMAT=JSON {text}"),
            (Dialect::Postgres { .. }, false) => format!("EXPLAIN (FORMAT JSON) {text}"),
            (Dialect::Postgres { .. }, true) => {
                format!("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {text}")
            }
            (Dialect::Sqlite, _) => format!("EXPLAIN QUERY PLAN {text}"),
        };
        let wanted = database
            .map(str::to_string)
            .or_else(|| self.details.database.clone());
        let mut conn = Connection::connect(&self.params(wanted)).await?;
        let outcome = async {
            if self.dialect.is_mysql()
                && let Some(database) = database
            {
                conn.use_database(database).await?;
            }
            let rows = conn.query_rows(&explain).await?;
            Ok::<_, crate::driver::DbError>(rows)
        }
        .await;
        conn.close().await;
        let rows = outcome?;
        if self.dialect.is_sqlite() {
            return Ok(sqlite_plan_json(&rows));
        }
        rows.into_iter()
            .next()
            .and_then(|row| row.into_iter().next().flatten())
            .ok_or_else(|| CoreError::Database("the server returned no plan".into()))
    }

    async fn dump_table_ddl(&self, target: &TableTarget) -> CoreResult<(String, Vec<String>)> {
        if !self.dialect.is_postgres() {
            return Ok((self.table_ddl(target).await?, Vec::new()));
        }
        let database = Some(target.database.as_str());
        let info = self.describe_table(target).await?;
        let constraints = self
            .meta_rows(database, &schema::pg_constraints_sql(self.dialect, target))
            .await?;
        let indexes = self
            .meta_rows(database, &schema::pg_indexes_sql(self.dialect, target))
            .await?;
        let table = target.qualified(self.dialect);
        let (foreign, local): (Vec<Row>, Vec<Row>) = constraints.into_iter().partition(|row| {
            row.get(1)
                .cloned()
                .flatten()
                .is_some_and(|definition| definition.starts_with("FOREIGN KEY"))
        });
        let deferred = foreign
            .into_iter()
            .filter_map(|row| {
                let name = row.first().cloned().flatten()?;
                let definition = row.get(1).cloned().flatten()?;
                Some(format!(
                    "ALTER TABLE {table} ADD CONSTRAINT {} {definition};",
                    self.dialect.quote_ident(&name)
                ))
            })
            .collect();
        let mut ddl = String::new();
        let mut owned = Vec::new();
        for column in &info.columns {
            if let Some(sequence) = column.default.as_deref().and_then(dump::serial_sequence) {
                ddl.push_str(&format!("CREATE SEQUENCE IF NOT EXISTS {sequence};\n"));
                owned.push(format!(
                    "ALTER SEQUENCE {sequence} OWNED BY {table}.{};",
                    self.dialect.quote_ident(&column.name)
                ));
            }
        }
        ddl.push_str(&schema::pg_table_ddl(
            self.dialect,
            target,
            &info.columns,
            local,
            indexes,
        ));
        for statement in owned {
            ddl.push_str(&format!("\n{statement}"));
        }
        Ok((ddl, deferred))
    }

    async fn sequence_fixes(&self, target: &TableTarget) -> CoreResult<Vec<String>> {
        if !self.dialect.is_postgres() {
            return Ok(Vec::new());
        }
        let info = self.describe_table(target).await?;
        let table = target.qualified(self.dialect);
        Ok(info
            .columns
            .iter()
            .filter(|column| {
                column
                    .default
                    .as_deref()
                    .is_some_and(|default| default.contains("nextval("))
                    || column
                        .extra
                        .as_deref()
                        .is_some_and(|extra| extra.contains("IDENTITY"))
            })
            .map(|column| {
                let name = self.dialect.quote_ident(&column.name);
                format!(
                    "SELECT setval(pg_get_serial_sequence({}, {}), COALESCE((SELECT MAX({name}) FROM {table}), 1), (SELECT MAX({name}) FROM {table}) IS NOT NULL);",
                    self.dialect.quote_literal(&table),
                    self.dialect.quote_literal(&column.name)
                )
            })
            .collect())
    }

    async fn dump_routines(
        &self,
        options: &DumpOptions,
        schema_name: Option<&str>,
        selected: &[DbObject],
    ) -> CoreResult<(String, String)> {
        let routines = self.list_routines(&options.database, schema_name).await?;
        let mysql = self.dialect.is_mysql();
        let mut programs = Vec::new();
        let mut triggers = Vec::new();
        for routine in routines {
            let keep = match routine.kind {
                RoutineKind::Function | RoutineKind::Procedure => true,
                RoutineKind::Event => mysql,
                RoutineKind::Trigger => routine
                    .table
                    .as_deref()
                    .is_some_and(|table| selected.iter().any(|object| object.name == table)),
                RoutineKind::Sequence => false,
            };
            if !keep {
                continue;
            }
            let target = RoutineTarget {
                database: options.database.clone(),
                schema: schema_name.map(str::to_string),
                routine,
            };
            let ddl = self.routine_ddl(&target).await?;
            let routine = target.routine;
            let drop = options.drop_existing.then(|| {
                let word = match routine.kind {
                    RoutineKind::Function => "FUNCTION",
                    RoutineKind::Procedure => "PROCEDURE",
                    RoutineKind::Event => "EVENT",
                    _ => "TRIGGER",
                };
                let name = self.dialect.quote_ident(&routine.name);
                match (
                    !self.dialect.is_postgres(),
                    routine.kind,
                    routine.table.as_deref(),
                ) {
                    (true, _, _) => Some(format!("DROP {word} IF EXISTS {name}")),
                    (false, RoutineKind::Trigger, Some(table)) => Some(format!(
                        "DROP TRIGGER IF EXISTS {name} ON {}",
                        self.dialect
                            .qualified(&[schema_name.unwrap_or("public"), table])
                    )),
                    _ => None,
                }
            });
            let entry = RoutineDump {
                name: match routine.arguments.as_deref() {
                    Some(arguments) => format!("{}({arguments})", routine.name),
                    None => routine.name.clone(),
                },
                drop: drop.flatten(),
                ddl: if mysql {
                    dump::strip_definer(&ddl)
                } else {
                    ddl
                },
            };
            if routine.kind == RoutineKind::Trigger {
                triggers.push(entry);
            } else {
                programs.push(entry);
            }
        }
        Ok((
            dump::routine_block(self.dialect, "Routines", &programs),
            dump::routine_block(self.dialect, "Triggers", &triggers),
        ))
    }

    pub async fn dump(
        &self,
        export_id: &str,
        options: &DumpOptions,
        path: std::path::PathBuf,
        progress: Box<dyn Fn(DumpProgress) + Send + Sync>,
    ) -> CoreResult<DumpSummary> {
        if !options.structure && !options.data {
            return Err(CoreError::InvalidInput(
                "choose structure, data or both".into(),
            ));
        }
        let schema_name = self
            .dialect
            .is_postgres()
            .then(|| options.schema.clone().unwrap_or_else(|| "public".into()));
        let objects = self
            .list_objects(&options.database, schema_name.as_deref())
            .await?;
        let selected: Vec<_> = objects
            .into_iter()
            .filter(|object| options.tables.is_empty() || options.tables.contains(&object.name))
            .collect();
        if selected.is_empty() {
            return Err(CoreError::InvalidInput("there is nothing to dump".into()));
        }
        let target_of = |name: &str| TableTarget {
            database: options.database.clone(),
            schema: schema_name.clone(),
            table: name.to_string(),
        };
        let insert_name = |target: &TableTarget| {
            if self.dialect.is_postgres() {
                target.qualified(self.dialect)
            } else {
                self.dialect.quote_ident(&target.table)
            }
        };
        let (programs, triggers) = if options.structure && options.routines {
            self.dump_routines(options, schema_name.as_deref(), &selected)
                .await?
        } else {
            (String::new(), String::new())
        };

        let temp = {
            let mut temp = path.as_os_str().to_owned();
            temp.push(".tmp");
            std::path::PathBuf::from(temp)
        };
        let file = std::fs::File::create(&temp).map_err(|err| CoreError::io(&temp, err))?;
        let mut out = std::io::BufWriter::with_capacity(1 << 20, file);
        let cancel = Arc::new(AtomicBool::new(false));
        lock(&self.exports).insert(export_id.to_string(), cancel.clone());

        let mut conn = match Connection::connect(&self.params(Some(options.database.clone()))).await
        {
            Ok(conn) => conn,
            Err(err) => {
                lock(&self.exports).remove(export_id);
                drop(out);
                if let Err(remove) = std::fs::remove_file(&temp) {
                    tracing::debug!(error = %remove, "temporary dump file could not be removed");
                }
                return Err(err.into());
            }
        };
        let server = format!("{} {}", self.details.flavor, self.details.version);
        let total = u32::try_from(selected.len()).unwrap_or(u32::MAX);
        let outcome: CoreResult<(u32, u64, bool)> = async {
            let io = |err: std::io::Error| CoreError::io(&temp, err);
            use std::io::Write as _;
            out.write_all(
                dump::header(
                    self.dialect,
                    &options.database,
                    &server,
                    schema_name.as_deref(),
                )
                .as_bytes(),
            )
            .map_err(io)?;
            let mut deferred = Vec::new();
            let mut rows = 0u64;
            let mut done = 0u32;
            let (tables, views): (Vec<_>, Vec<_>) = selected
                .iter()
                .partition(|object| object.kind == schema::ObjectKind::Table);
            let mut programs_pending = !programs.is_empty();
            if programs_pending && self.dialect.is_postgres() {
                out.write_all(programs.as_bytes()).map_err(io)?;
                programs_pending = false;
            }
            for object in tables.iter().chain(views.iter()) {
                if cancel.load(Ordering::SeqCst) {
                    return Ok((done, rows, true));
                }
                let target = target_of(&object.name);
                let is_view = object.kind == schema::ObjectKind::View;
                if programs_pending && is_view {
                    out.write_all(programs.as_bytes()).map_err(io)?;
                    programs_pending = false;
                }
                progress(DumpProgress {
                    table: object.name.clone(),
                    done,
                    total,
                    rows,
                });
                let name = insert_name(&target);
                if options.structure {
                    let mut block = format!(
                        "
-- {}
",
                        object.name
                    );
                    if options.drop_existing {
                        let kind = if is_view { "VIEW" } else { "TABLE" };
                        let cascade = if self.dialect.is_postgres() {
                            " CASCADE"
                        } else {
                            ""
                        };
                        block.push_str(&format!(
                            "DROP {kind} IF EXISTS {name}{cascade};
"
                        ));
                    }
                    let (ddl, foreign) = if self.dialect.is_mysql() {
                        let rows = conn
                            .query_rows(&format!(
                                "SHOW CREATE TABLE {}",
                                self.dialect.quote_ident(&object.name)
                            ))
                            .await?;
                        let ddl = rows
                            .into_iter()
                            .next()
                            .and_then(|row| row.into_iter().nth(1).flatten())
                            .ok_or_else(|| {
                                CoreError::NotFound(format!("no DDL for {}", object.name))
                            })?;
                        (dump::strip_definer(&ddl), Vec::new())
                    } else if is_view {
                        (self.table_ddl(&target).await?, Vec::new())
                    } else {
                        self.dump_table_ddl(&target).await?
                    };
                    block.push_str(ddl.trim_end().trim_end_matches(';'));
                    block.push_str(
                        ";
",
                    );
                    deferred.extend(foreign);
                    out.write_all(block.as_bytes()).map_err(io)?;
                }
                if options.data && !is_view {
                    let select = format!("SELECT * FROM {}", target.qualified(self.dialect));
                    let report = |count: u64| {
                        progress(DumpProgress {
                            table: object.name.clone(),
                            done,
                            total,
                            rows: rows + count,
                        })
                    };
                    let mut writer = InsertWriter::new(
                        self.dialect,
                        name.clone(),
                        &mut out,
                        cancel.clone(),
                        &report,
                    );
                    let run = conn.run(&select, &mut writer).await;
                    let (count, failure) = writer.finish();
                    if let Some(err) = failure {
                        return Err(io(err));
                    }
                    if cancel.load(Ordering::SeqCst) {
                        return Ok((done, rows + count, true));
                    }
                    run?;
                    rows += count;
                    if count > 0 {
                        for fix in self.sequence_fixes(&target).await? {
                            out.write_all(
                                format!(
                                    "{fix}
"
                                )
                                .as_bytes(),
                            )
                            .map_err(io)?;
                        }
                    }
                }
                done += 1;
            }
            if programs_pending {
                out.write_all(programs.as_bytes()).map_err(io)?;
            }
            out.write_all(triggers.as_bytes()).map_err(io)?;
            out.write_all(dump::footer(self.dialect, &deferred).as_bytes())
                .map_err(io)?;
            Ok((done, rows, false))
        }
        .await;
        lock(&self.exports).remove(export_id);
        conn.close().await;

        let finished = outcome.and_then(|(tables, rows, cancelled)| {
            use std::io::Write as _;
            if cancelled {
                return Ok(DumpSummary {
                    tables,
                    rows,
                    cancelled,
                });
            }
            out.flush()
                .and_then(|()| out.get_ref().sync_all())
                .map_err(|err| CoreError::io(&temp, err))?;
            Ok(DumpSummary {
                tables,
                rows,
                cancelled,
            })
        });
        drop(out);
        match finished {
            Ok(summary) if !summary.cancelled => {
                std::fs::rename(&temp, &path).map_err(|err| CoreError::io(&path, err))?;
                Ok(summary)
            }
            other => {
                if let Err(err) = std::fs::remove_file(&temp) {
                    tracing::debug!(error = %err, "temporary dump file could not be removed");
                }
                other
            }
        }
    }

    pub fn cancel_export(&self, export_id: &str) {
        if let Some(flag) = lock(&self.exports).get(export_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    pub async fn list_users(&self) -> CoreResult<Vec<UserAccount>> {
        let rows = self
            .meta_rows(None, users::list_sql(self.dialect, self.is_mariadb())?)
            .await?;
        Ok(users::parse_users(rows))
    }

    pub async fn user_detail(&self, user: &UserRef) -> CoreResult<UserDetail> {
        let accounts = self.list_users().await?;
        let account = accounts
            .into_iter()
            .find(|account| {
                account.name == user.name
                    && (self.dialect.is_postgres() || account.host == user.host)
            })
            .ok_or_else(|| CoreError::NotFound(format!("user {} does not exist", user.name)))?;
        let grants = self
            .meta_rows(None, &users::grants_sql(self.dialect, user)?)
            .await?;
        let statements = if self.dialect.is_mysql() {
            let sql = format!("SHOW GRANTS FOR {}", users::account(self.dialect, user)?);
            self.meta_rows(None, &sql)
                .await?
                .into_iter()
                .filter_map(|row| row.into_iter().next().flatten())
                .map(|statement| users::mask_identified(&statement))
                .collect()
        } else {
            Vec::new()
        };
        Ok(UserDetail {
            account,
            grants: users::parse_grants(grants),
            statements,
        })
    }

    pub fn preview_user_action(&self, action: &UserAction) -> CoreResult<Vec<String>> {
        Ok(users::user_sql(self.dialect, action)?.preview)
    }

    pub async fn run_user_action(&self, action: &UserAction) -> CoreResult<Vec<String>> {
        if self.read_only() {
            return Err(CoreError::ReadOnly(
                "this connection is read-only, users and privileges cannot be changed".into(),
            ));
        }
        let sql = users::user_sql(self.dialect, action)?;
        let database = self.details.database.clone().unwrap_or_default();
        self.run_structure(&database, &sql.statements)
            .await
            .map_err(|err| match err {
                CoreError::Database(message) => {
                    CoreError::Database(users::mask_secrets(&message, &sql.secrets))
                }
                CoreError::Connection(message) => {
                    CoreError::Connection(users::mask_secrets(&message, &sql.secrets))
                }
                other => other,
            })?;
        Ok(sql.preview)
    }

    pub async fn list_processes(&self) -> CoreResult<Vec<ProcessInfo>> {
        let rows = self
            .meta_rows(None, processes::processes_sql(self.dialect)?)
            .await?;
        Ok(processes::parse_processes(self.dialect, rows))
    }

    pub async fn server_info(&self, kind: ServerInfoKind) -> CoreResult<Vec<ServerSetting>> {
        let rows = self
            .meta_rows(None, &server::server_info_sql(self.dialect, kind))
            .await?;
        Ok(server::parse_server_info(rows))
    }

    pub async fn kill_process(&self, id: &str, mode: KillMode) -> CoreResult<()> {
        if self.read_only() {
            return Err(CoreError::ReadOnly(
                "this connection is read-only, processes cannot be stopped".into(),
            ));
        }
        let sql = processes::kill_sql(self.dialect, id, mode)?;
        let rows = self.meta_rows(None, &sql).await?;
        let confirmed = self.dialect.is_mysql()
            || rows
                .first()
                .and_then(|row| row.first())
                .is_some_and(|value| value.as_deref() == Some("t"));
        if !confirmed {
            return Err(CoreError::Database(format!(
                "process {id} could not be stopped, it may have ended already"
            )));
        }
        Ok(())
    }

    pub async fn list_databases(&self) -> CoreResult<Vec<String>> {
        let rows = self
            .meta_rows(None, schema::databases_sql(self.dialect))
            .await?;
        Ok(first_column(rows))
    }

    pub async fn list_schemas(&self, database: &str) -> CoreResult<Vec<String>> {
        if !self.dialect.is_postgres() {
            return Ok(Vec::new());
        }
        let rows = self
            .meta_rows(Some(database), schema::PG_SCHEMAS_SQL)
            .await?;
        Ok(first_column(rows))
    }

    pub async fn list_objects(
        &self,
        database: &str,
        schema: Option<&str>,
    ) -> CoreResult<Vec<DbObject>> {
        let sql = schema::objects_sql(self.dialect, database, schema);
        let rows = self.meta_rows(Some(database), &sql).await?;
        Ok(schema::parse_objects(self.dialect, rows))
    }

    pub async fn schema_graph(
        &self,
        database: &str,
        schema: Option<&str>,
    ) -> CoreResult<SchemaGraph> {
        let schema = schema.unwrap_or("public");
        let columns = self
            .meta_rows(
                Some(database),
                &graph::columns_sql(self.dialect, database, schema),
            )
            .await?;
        let keys = self
            .meta_rows(
                Some(database),
                &graph::foreign_keys_sql(self.dialect, database, schema),
            )
            .await?;
        Ok(graph::parse_graph(columns, keys))
    }

    pub async fn describe_table(&self, target: &TableTarget) -> CoreResult<TableInfo> {
        let database = Some(target.database.as_str());
        let columns = schema::parse_columns(
            self.meta_rows(database, &schema::columns_sql(self.dialect, target))
                .await?,
        );
        if columns.is_empty() {
            return Err(CoreError::NotFound(format!(
                "table {} does not exist",
                target.table
            )));
        }
        let keys = schema::parse_keys(
            self.meta_rows(database, &schema::keys_sql(self.dialect, target))
                .await?,
        );
        let editable_key = schema::editable_key(&columns, &keys);
        let foreign_keys = schema::parse_foreign_keys(
            self.meta_rows(database, &schema::foreign_keys_sql(self.dialect, target))
                .await?,
        );
        Ok(TableInfo {
            columns,
            keys,
            editable_key,
            foreign_keys,
        })
    }

    pub fn equality_filter(
        &self,
        columns: &[String],
        values: &[Option<String>],
    ) -> CoreResult<String> {
        if columns.is_empty() || columns.len() != values.len() {
            return Err(CoreError::InvalidInput(
                "every column needs exactly one value".into(),
            ));
        }
        let parts = columns
            .iter()
            .zip(values)
            .map(|(column, value)| {
                let column = self.dialect.quote_ident(column);
                match value {
                    Some(value) => format!("{column} = {}", self.dialect.quote_literal(value)),
                    None => format!("{column} IS NULL"),
                }
            })
            .collect::<Vec<_>>();
        Ok(parts.join(" AND "))
    }

    pub async fn table_ddl(&self, target: &TableTarget) -> CoreResult<String> {
        let database = Some(target.database.as_str());
        if self.dialect.is_sqlite() {
            let rows = self
                .meta_rows(database, &schema::sqlite_ddl_sql(self.dialect, target))
                .await?;
            let statements: Vec<String> = rows
                .into_iter()
                .filter_map(|row| row.into_iter().next().flatten())
                .map(|sql| format!("{};", sql.trim_end().trim_end_matches(';')))
                .collect();
            if statements.is_empty() {
                return Err(CoreError::NotFound(format!(
                    "table {} does not exist",
                    target.table
                )));
            }
            return Ok(statements.join("\n\n"));
        }
        if self.dialect.is_mysql() {
            let rows = self
                .meta_rows(database, &schema::mysql_ddl_sql(self.dialect, target))
                .await?;
            return rows
                .into_iter()
                .next()
                .and_then(|row| row.into_iter().nth(1).flatten())
                .map(|ddl| format!("{ddl};"))
                .ok_or_else(|| CoreError::NotFound(format!("no DDL for {}", target.table)));
        }
        let kind = self
            .meta_rows(database, &schema::pg_relkind_sql(self.dialect, target))
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| CoreError::NotFound(format!("table {} does not exist", target.table)))?;
        let relkind = kind.first().cloned().flatten().unwrap_or_default();
        if relkind == "v" || relkind == "m" {
            let keyword = if relkind == "m" {
                "MATERIALIZED VIEW"
            } else {
                "VIEW"
            };
            let definition = kind.get(1).cloned().flatten().unwrap_or_default();
            return Ok(format!(
                "CREATE {keyword} {} AS\n{}",
                target.qualified(self.dialect),
                definition.trim_end()
            ));
        }
        let info = self.describe_table(target).await?;
        let constraints = self
            .meta_rows(database, &schema::pg_constraints_sql(self.dialect, target))
            .await?;
        let indexes = self
            .meta_rows(database, &schema::pg_indexes_sql(self.dialect, target))
            .await?;
        Ok(schema::pg_table_ddl(
            self.dialect,
            target,
            &info.columns,
            constraints,
            indexes,
        ))
    }

    pub async fn completion(&self, database: &str) -> CoreResult<Vec<CompletionTable>> {
        let rows = self
            .meta_rows(
                Some(database),
                &schema::completion_sql(self.dialect, database),
            )
            .await?;
        Ok(schema::parse_completion(rows))
    }

    pub fn split(&self, sql: &str) -> Vec<SqlStatement> {
        split_statements(sql, self.dialect)
    }

    fn tab(&self, tab_id: &str) -> Arc<Tab> {
        lock(&self.tabs)
            .entry(tab_id.to_string())
            .or_default()
            .clone()
    }

    fn existing_tab(&self, tab_id: &str) -> CoreResult<Arc<Tab>> {
        lock(&self.tabs)
            .get(tab_id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("tab {tab_id} has no results")))
    }

    async fn ensure_connection(
        &self,
        tab: &Tab,
        slot: &mut Option<Connection>,
        database: Option<&str>,
    ) -> CoreResult<()> {
        let wanted = database
            .map(str::to_string)
            .or_else(|| self.details.database.clone());
        let reusable = match slot.as_ref() {
            Some(conn) if conn.is_closed() => false,
            Some(conn) if !self.dialect.is_mysql() => conn.details().database == wanted,
            Some(_) => true,
            None => false,
        };
        if !reusable {
            if let Some(old) = slot.take() {
                old.close().await;
            }
            let conn = Connection::connect(&self.params(wanted.clone())).await?;
            *lock(&tab.cancel) = Some(conn.cancel_handle());
            *slot = Some(conn);
        }
        if self.dialect.is_mysql()
            && let (Some(database), Some(conn)) = (database, slot.as_mut())
            && let Err(err) = conn.use_database(database).await
        {
            if err.connection_lost {
                *slot = None;
            }
            return Err(err.into());
        }
        Ok(())
    }

    pub async fn execute(
        &self,
        tab_id: &str,
        database: Option<&str>,
        sql: &str,
        row_limit: usize,
        emit: EventSink<'_>,
    ) -> CoreResult<ExecutionSummary> {
        let statements = split_statements(sql, self.dialect);
        if statements.is_empty() {
            return Err(CoreError::InvalidInput(
                "there is no SQL statement to run".into(),
            ));
        }
        if self.read_only()
            && let Some(statement) = statements.iter().find(|statement| statement.writes)
        {
            return Err(CoreError::ReadOnly(format!(
                "this connection is read-only, the statement was not run: {}",
                preview(&statement.text)
            )));
        }
        let tab = self.tab(tab_id);
        let mut slot = tab.conn.try_lock().map_err(|_| CoreError::Busy)?;
        tab.cancelled.store(false, Ordering::SeqCst);
        self.ensure_connection(&tab, &mut slot, database).await?;
        lock(&tab.results).clear();

        emit(QueryEvent::Plan {
            statements: statements.clone(),
        });
        let started = Instant::now();
        let mut cancelled = false;
        let mut summary = ExecutionSummary {
            statements: statements.len() as u32,
            ..ExecutionSummary::default()
        };
        for (index, statement) in statements.iter().enumerate() {
            let index = index as u32;
            if tab.cancelled.load(Ordering::SeqCst) {
                cancelled = true;
                break;
            }
            emit(QueryEvent::StatementStarted { index });
            let statement_started = Instant::now();
            let Some(conn) = slot.as_mut() else {
                return Err(CoreError::Connection("connection was lost".into()));
            };
            let mut sink = ResultSink::new(&tab, index, row_limit.min(QUERY_ROW_CAP), emit);
            let outcome = conn.run(&statement.text, &mut sink).await;
            let result = sink.finish();
            match outcome {
                Ok(run) => {
                    let outcome = match result {
                        Some((result, set)) => StatementOutcome::Rows {
                            result,
                            rows: clamp(set.len()),
                            truncated: set.is_truncated(),
                        },
                        None => StatementOutcome::Affected {
                            rows: run.rows_affected.min(u32::MAX as u64) as u32,
                        },
                    };
                    match outcome {
                        StatementOutcome::Rows { rows, .. } => {
                            summary.rows.get_or_insert(rows);
                        }
                        StatementOutcome::Affected { rows } => {
                            summary.affected =
                                Some(summary.affected.unwrap_or(0).saturating_add(rows));
                        }
                    }
                    emit(QueryEvent::StatementFinished {
                        index,
                        elapsed_ms: elapsed_ms(statement_started),
                        outcome,
                    });
                }
                Err(err) => {
                    let was_cancelled = tab.cancelled.load(Ordering::SeqCst);
                    if err.connection_lost {
                        *slot = None;
                        *lock(&tab.cancel) = None;
                    }
                    summary.failed = !was_cancelled;
                    summary.error = Some(err.message.clone());
                    emit(QueryEvent::StatementFailed {
                        index,
                        error_at: error_offset(statement, &err),
                        message: err.message,
                        cancelled: was_cancelled,
                    });
                    cancelled = was_cancelled;
                    break;
                }
            }
        }
        summary.cancelled = cancelled;
        summary.elapsed_ms = elapsed_ms(started);
        emit(QueryEvent::Finished {
            elapsed_ms: summary.elapsed_ms,
            cancelled,
        });
        Ok(summary)
    }

    pub async fn load_table(
        &self,
        tab_id: &str,
        target: &TableTarget,
        query: &TableQuery,
        emit: EventSink<'_>,
    ) -> CoreResult<()> {
        let probe = TableQuery {
            limit: query.limit.saturating_add(1),
            ..query.clone()
        };
        let sql = select_statement(self.dialect, &target.qualified(self.dialect), &probe)?;
        self.execute(
            tab_id,
            Some(&target.database),
            &sql,
            query.limit as usize,
            emit,
        )
        .await
        .map(|_| ())
    }

    pub async fn cancel(&self, tab_id: &str) -> CoreResult<()> {
        let Ok(tab) = self.existing_tab(tab_id) else {
            return Ok(());
        };
        tab.cancelled.store(true, Ordering::SeqCst);
        if tab.conn.try_lock().is_ok() {
            return Ok(());
        }
        let handle = lock(&tab.cancel).clone();
        if let Some(handle) = handle {
            handle.cancel().await?;
        }
        Ok(())
    }

    pub async fn close_tab(&self, tab_id: &str) -> CoreResult<()> {
        let tab = lock(&self.tabs).remove(tab_id);
        if let Some(tab) = tab {
            if tab.conn.try_lock().is_err() {
                tab.cancelled.store(true, Ordering::SeqCst);
                let handle = lock(&tab.cancel).clone();
                if let Some(handle) = handle
                    && let Err(err) = handle.cancel().await
                {
                    tracing::debug!(error = %err.message, "cancel on tab close failed");
                }
            }
            close_tab_connection(&tab).await;
        }
        Ok(())
    }

    pub fn result(&self, tab_id: &str, result: u32) -> CoreResult<Arc<ResultSet>> {
        let tab = self.existing_tab(tab_id)?;
        let results = lock(&tab.results);
        results
            .get(result as usize)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("result {result} does not exist")))
    }

    pub fn fetch_rows(
        &self,
        tab_id: &str,
        result: u32,
        offset: u32,
        limit: u32,
    ) -> CoreResult<Vec<Row>> {
        let set = self.result(tab_id, result)?;
        Ok(set.slice(offset as usize, (limit as usize).min(FETCH_LIMIT)))
    }

    pub async fn preview_changes(
        &self,
        target: &TableTarget,
        changes: &[RowChange],
    ) -> CoreResult<Vec<String>> {
        let info = self.describe_table(target).await?;
        validate_keys(&info, changes)?;
        let table = target.qualified(self.dialect);
        changes
            .iter()
            .map(|change| change_statement(self.dialect, &table, change))
            .collect()
    }

    pub async fn apply_changes(
        &self,
        tab_id: &str,
        target: &TableTarget,
        changes: &[RowChange],
    ) -> CoreResult<u32> {
        if self.read_only() {
            return Err(CoreError::ReadOnly(
                "this connection is read-only, changes cannot be saved".into(),
            ));
        }
        if changes.is_empty() {
            return Ok(0);
        }
        let statements = self.preview_changes(target, changes).await?;
        let tab = self.tab(tab_id);
        let mut slot = tab.conn.try_lock().map_err(|_| CoreError::Busy)?;
        self.ensure_connection(&tab, &mut slot, Some(&target.database))
            .await?;
        let conn = slot
            .as_mut()
            .ok_or_else(|| CoreError::Connection("connection was lost".into()))?;
        let begin = if self.dialect.is_mysql() {
            "START TRANSACTION"
        } else {
            "BEGIN"
        };
        conn.execute(begin).await?;
        for statement in &statements {
            let failure = match conn.execute(statement).await {
                Ok(1) => continue,
                Ok(count) => CoreError::Database(format!(
                    "the statement affected {count} rows instead of exactly one, all changes were rolled back: {}",
                    preview(statement)
                )),
                Err(err) => err.into(),
            };
            if let Err(err) = conn.execute("ROLLBACK").await {
                tracing::warn!(error = %err.message, "rollback failed");
                if err.connection_lost {
                    *slot = None;
                }
            }
            return Err(failure);
        }
        conn.execute("COMMIT").await?;
        Ok(statements.len() as u32)
    }
}

async fn close_tab_connection(tab: &Tab) {
    let conn = tab.conn.lock().await.take();
    if let Some(conn) = conn {
        conn.close().await;
    }
    *lock(&tab.cancel) = None;
    lock(&tab.results).clear();
}

fn validate_keys(info: &TableInfo, changes: &[RowChange]) -> CoreResult<()> {
    let Some(key) = &info.editable_key else {
        return Err(CoreError::InvalidInput(
            "the table has no primary key or unique key without NULL values, so rows cannot be identified safely".into(),
        ));
    };
    for change in changes {
        if let Some(cells) = change.key() {
            let mut given: Vec<&str> = cells.iter().map(|cell| cell.column.as_str()).collect();
            let mut expected: Vec<&str> = key.iter().map(String::as_str).collect();
            given.sort_unstable();
            expected.sort_unstable();
            if given != expected {
                return Err(CoreError::InvalidInput(format!(
                    "rows must be identified by the key columns {}",
                    key.join(", ")
                )));
            }
        }
    }
    Ok(())
}

fn first_column(rows: Vec<Row>) -> Vec<String> {
    rows.into_iter()
        .filter_map(|row| row.into_iter().next().flatten())
        .collect()
}

fn preview(text: &str) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > 120 {
        format!("{}…", flat.chars().take(120).collect::<String>())
    } else {
        flat
    }
}

fn clamp(value: usize) -> u32 {
    value.min(u32::MAX as usize) as u32
}

fn elapsed_ms(since: Instant) -> u32 {
    since.elapsed().as_millis().min(u32::MAX as u128) as u32
}

fn error_offset(statement: &SqlStatement, err: &DbError) -> Option<u32> {
    let text = &statement.text;
    let relative: u32 = match (err.position, err.line) {
        (Some(position), _) => text
            .chars()
            .take(position.saturating_sub(1) as usize)
            .map(|c| c.len_utf16() as u32)
            .sum(),
        (None, Some(line)) => {
            let mut offset = 0u32;
            let mut current = 1u32;
            for c in text.chars() {
                if current >= line {
                    break;
                }
                offset += c.len_utf16() as u32;
                if c == '\n' {
                    current += 1;
                }
            }
            offset
        }
        (None, None) => return None,
    };
    Some(statement.start + relative)
}

struct ResultSink<'a> {
    tab: &'a Tab,
    index: u32,
    limit: usize,
    emit: EventSink<'a>,
    result: Option<(u32, Arc<ResultSet>)>,
    buffer: Vec<Row>,
    count: usize,
    last_flush: Instant,
}

impl<'a> ResultSink<'a> {
    fn new(tab: &'a Tab, index: u32, limit: usize, emit: EventSink<'a>) -> Self {
        Self {
            tab,
            index,
            limit,
            emit,
            result: None,
            buffer: Vec::new(),
            count: 0,
            last_flush: Instant::now(),
        }
    }

    fn flush(&mut self) {
        let Some((result, set)) = &self.result else {
            return;
        };
        if !self.buffer.is_empty() {
            set.append(&mut self.buffer);
        }
        (self.emit)(QueryEvent::Progress {
            index: self.index,
            result: *result,
            rows: clamp(set.len()),
        });
        self.last_flush = Instant::now();
    }

    fn finish(mut self) -> Option<(u32, Arc<ResultSet>)> {
        if let Some((_, set)) = &self.result
            && !self.buffer.is_empty()
        {
            set.append(&mut self.buffer);
        }
        self.result.take()
    }
}

impl RowSink for ResultSink<'_> {
    fn columns(&mut self, columns: &[ColumnMeta]) {
        let set = Arc::new(ResultSet::new(columns.to_vec()));
        let result = {
            let mut results = lock(&self.tab.results);
            results.push(set.clone());
            (results.len() - 1) as u32
        };
        self.result = Some((result, set));
        (self.emit)(QueryEvent::Columns {
            index: self.index,
            result,
            columns: columns.to_vec(),
        });
    }

    fn row(&mut self, row: Row) -> SinkFlow {
        if self.tab.cancelled.load(Ordering::Relaxed) {
            return SinkFlow::Stop;
        }
        if self.count >= self.limit {
            if let Some((_, set)) = &self.result {
                set.mark_truncated();
            }
            return SinkFlow::Stop;
        }
        self.buffer.push(row);
        self.count += 1;
        if self.buffer.len() >= FLUSH_ROWS
            || self.last_flush.elapsed().as_millis() >= FLUSH_INTERVAL_MS
        {
            self.flush();
        }
        SinkFlow::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_error_positions_to_utf16_offsets() {
        let statement = SqlStatement {
            text: "SELECT '😀' FROM\nnope x".into(),
            start: 10,
            end: 30,
            writes: false,
        };
        let by_position = DbError {
            message: String::new(),
            position: Some(10),
            line: None,
            connection_lost: false,
        };
        assert_eq!(error_offset(&statement, &by_position), Some(10 + 10));
        let by_line = DbError {
            position: None,
            line: Some(2),
            ..by_position.clone()
        };
        assert_eq!(error_offset(&statement, &by_line), Some(10 + 17));
        let none = DbError {
            position: None,
            line: None,
            ..by_position
        };
        assert_eq!(error_offset(&statement, &none), None);
    }

    #[test]
    fn previews_are_single_line_and_bounded() {
        assert_eq!(preview("SELECT\n  1"), "SELECT 1");
        assert_eq!(preview(&"x ".repeat(200)).chars().count(), 121);
    }
}
