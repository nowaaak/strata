use std::time::Instant;

use strata_core::history::{HistoryStatus, NewHistoryEntry};
use strata_core::sql::DdlAction;
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
pub fn preview_ddl(
    state: State<'_, AppState>,
    session_id: String,
    action: DdlAction,
) -> CommandResult<String> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.preview_ddl(&action)?)
}

#[tauri::command]
pub async fn run_ddl(
    state: State<'_, AppState>,
    session_id: String,
    action: DdlAction,
) -> CommandResult<String> {
    let session = state.sessions.get(&session_id)?;
    let sql = session.preview_ddl(&action)?;
    let started = Instant::now();
    let outcome = session.run_ddl(&action).await;
    let duration_ms = u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX);
    match &outcome {
        Ok(_) => tracing::info!(duration_ms, "structure changed"),
        Err(err) => tracing::warn!(kind = err.kind(), error = %err, "structure change failed"),
    }
    if state.settings.get().await.history_enabled {
        let entry = NewHistoryEntry {
            profile_id: session.info().profile_id,
            database: action.working_database().map(str::to_string),
            sql,
            duration_ms,
            statements: 1,
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
    Ok(outcome?)
}
