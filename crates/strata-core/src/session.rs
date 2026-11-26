use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use ts_rs::TS;

use crate::driver::{
    CancelHandle, ColumnMeta, ConnectParams, Connection, DbError, Row, RowSink, ServerDetails,
    SinkFlow,
};
use crate::profiles::{ConnectionProfile, Engine, PasswordUpdate, ProfileStore, Safety};
use crate::result::ResultSet;
use crate::schema::{self, CompletionTable, DbObject, TableInfo, TableTarget};
use crate::sql::{
    DdlAction, Dialect, RowChange, SqlStatement, TableQuery, change_statement, ddl_statement,
    select_statement, split_statements,
};
use crate::ssh::SshTunnel;
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

fn meta_key(dialect: Dialect, database: Option<&str>) -> String {
    match dialect {
        Dialect::MySql { .. } => String::new(),
        Dialect::Postgres { .. } => database.unwrap_or_default().to_string(),
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
            .filter(|_| !self.dialect.is_mysql());
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

    pub async fn list_databases(&self) -> CoreResult<Vec<String>> {
        let rows = self
            .meta_rows(None, schema::databases_sql(self.dialect))
            .await?;
        Ok(first_column(rows))
    }

    pub async fn list_schemas(&self, database: &str) -> CoreResult<Vec<String>> {
        if self.dialect.is_mysql() {
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
        Ok(TableInfo {
            columns,
            keys,
            editable_key,
        })
    }

    pub async fn table_ddl(&self, target: &TableTarget) -> CoreResult<String> {
        let database = Some(target.database.as_str());
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
