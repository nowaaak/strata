use std::path::PathBuf;

use strata_core::driver::Row;
use strata_core::export::{self, ExportFormat};
use strata_core::history::{HistoryStatus, NewHistoryEntry};
use strata_core::schema::TableTarget;
use strata_core::session::{QUERY_ROW_CAP, QueryEvent};
use strata_core::sql::{SqlStatement, TableQuery};
use tauri::State;
use tauri::ipc::Channel;

use crate::error::CommandResult;
use crate::state::AppState;
use crate::timing::timed;

fn forward(channel: Channel<QueryEvent>) -> impl Fn(QueryEvent) + Send + Sync {
    move |event| {
        if let Err(err) = channel.send(event) {
            tracing::debug!(error = %err, "query event could not be delivered");
        }
    }
}

#[tauri::command]
pub fn split_sql(
    state: State<'_, AppState>,
    session_id: String,
    sql: String,
) -> CommandResult<Vec<SqlStatement>> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.split(&sql))
}

#[tauri::command]
pub async fn execute_query(
    state: State<'_, AppState>,
    session_id: String,
    tab_id: String,
    database: Option<String>,
    sql: String,
    on_event: Channel<QueryEvent>,
) -> CommandResult<()> {
    let session = state.sessions.get(&session_id)?;
    let emit = forward(on_event);
    let summary = session
        .execute(&tab_id, database.as_deref(), &sql, QUERY_ROW_CAP, &emit)
        .await?;
    tracing::info!(
        statements = summary.statements,
        elapsed_ms = summary.elapsed_ms,
        failed = summary.failed,
        cancelled = summary.cancelled,
        "query executed"
    );
    if state.settings.get().await.history_enabled {
        let status = if summary.cancelled {
            HistoryStatus::Cancelled
        } else if summary.failed {
            HistoryStatus::Failed
        } else {
            HistoryStatus::Success
        };
        let entry = NewHistoryEntry {
            profile_id: session.info().profile_id,
            database,
            sql,
            duration_ms: summary.elapsed_ms,
            statements: summary.statements,
            rows: summary.rows,
            affected: summary.affected,
            status,
            error: summary.error,
        };
        if let Err(err) = state.history.record(entry).await {
            tracing::warn!(kind = err.kind(), error = %err, "query history could not be saved");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn load_table(
    state: State<'_, AppState>,
    session_id: String,
    tab_id: String,
    target: TableTarget,
    query: TableQuery,
    on_event: Channel<QueryEvent>,
) -> CommandResult<()> {
    let session = state.sessions.get(&session_id)?;
    let emit = forward(on_event);
    Ok(timed(
        "load_table",
        session.load_table(&tab_id, &target, &query, &emit),
    )
    .await?)
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    session_id: String,
    tab_id: String,
) -> CommandResult<()> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.cancel(&tab_id).await?)
}

#[tauri::command]
pub async fn close_tab(
    state: State<'_, AppState>,
    session_id: String,
    tab_id: String,
) -> CommandResult<()> {
    let Ok(session) = state.sessions.get(&session_id) else {
        return Ok(());
    };
    Ok(session.close_tab(&tab_id).await?)
}

#[tauri::command]
pub fn fetch_rows(
    state: State<'_, AppState>,
    session_id: String,
    tab_id: String,
    result: u32,
    offset: u32,
    limit: u32,
) -> CommandResult<Vec<Row>> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.fetch_rows(&tab_id, result, offset, limit)?)
}

#[tauri::command]
pub async fn export_result(
    state: State<'_, AppState>,
    session_id: String,
    tab_id: String,
    result: u32,
    format: ExportFormat,
    path: PathBuf,
) -> CommandResult<u32> {
    let session = state.sessions.get(&session_id)?;
    let set = session.result(&tab_id, result)?;
    Ok(export::export_result(set, format, path).await?)
}
