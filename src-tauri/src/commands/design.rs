use std::time::Instant;

use strata_core::CoreResult;
use strata_core::design::{AlterOp, NewTable, TableDesign};
use strata_core::history::{HistoryStatus, NewHistoryEntry};
use strata_core::schema::TableTarget;
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;
use crate::timing::timed;

#[tauri::command]
pub async fn table_design(
    state: State<'_, AppState>,
    session_id: String,
    target: TableTarget,
) -> CommandResult<TableDesign> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed("table_design", session.table_design(&target)).await?)
}

#[tauri::command]
pub async fn preview_alter(
    state: State<'_, AppState>,
    session_id: String,
    target: TableTarget,
    ops: Vec<AlterOp>,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.preview_alter(&target, &ops).await?)
}

#[tauri::command]
pub async fn apply_alter(
    state: State<'_, AppState>,
    session_id: String,
    target: TableTarget,
    ops: Vec<AlterOp>,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    let preview = session.preview_alter(&target, &ops).await?;
    let started = Instant::now();
    let outcome = session.apply_alter(&target, &ops).await;
    record(
        &state,
        &session.info().profile_id,
        &target.database,
        &preview,
        started,
        &outcome,
    )
    .await;
    Ok(outcome?)
}

#[tauri::command]
pub fn preview_create_table(
    state: State<'_, AppState>,
    session_id: String,
    table: NewTable,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.preview_create(&table)?)
}

#[tauri::command]
pub async fn create_table(
    state: State<'_, AppState>,
    session_id: String,
    table: NewTable,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    let preview = session.preview_create(&table)?;
    let started = Instant::now();
    let outcome = session.apply_create(&table).await;
    record(
        &state,
        &session.info().profile_id,
        &table.target.database,
        &preview,
        started,
        &outcome,
    )
    .await;
    Ok(outcome?)
}

async fn record(
    state: &AppState,
    profile_id: &str,
    database: &str,
    statements: &[String],
    started: Instant,
    outcome: &CoreResult<Vec<String>>,
) {
    let duration_ms = u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX);
    match outcome {
        Ok(_) => tracing::info!(
            duration_ms,
            statements = statements.len(),
            "table structure changed"
        ),
        Err(err) => {
            tracing::warn!(kind = err.kind(), error = %err, "table structure change failed")
        }
    }
    if !state.settings.get().await.history_enabled {
        return;
    }
    let entry = NewHistoryEntry {
        profile_id: profile_id.to_string(),
        database: Some(database.to_string()),
        sql: statements.join(";\n\n"),
        duration_ms,
        statements: u32::try_from(statements.len()).unwrap_or(u32::MAX),
        rows: None,
        affected: None,
        status: if outcome.is_ok() {
            HistoryStatus::Success
        } else {
            HistoryStatus::Failed
        },
        error: outcome.as_ref().err().map(ToString::to_string),
    };
    if let Err(err) = state.history.record(entry).await {
        tracing::warn!(kind = err.kind(), error = %err, "query history could not be saved");
    }
}
