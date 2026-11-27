use std::time::Instant;

use strata_core::history::{HistoryStatus, NewHistoryEntry};
use strata_core::users::{UserAccount, UserAction, UserDetail, UserRef};
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;
use crate::timing::timed;

#[tauri::command]
pub async fn list_users(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Vec<UserAccount>> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed("list_users", session.list_users()).await?)
}

#[tauri::command]
pub async fn user_detail(
    state: State<'_, AppState>,
    session_id: String,
    user: UserRef,
) -> CommandResult<UserDetail> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed("user_detail", session.user_detail(&user)).await?)
}

#[tauri::command]
pub fn preview_user_action(
    state: State<'_, AppState>,
    session_id: String,
    action: UserAction,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.preview_user_action(&action)?)
}

#[tauri::command]
pub async fn run_user_action(
    state: State<'_, AppState>,
    session_id: String,
    action: UserAction,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    let preview = session.preview_user_action(&action)?;
    let started = Instant::now();
    let outcome = session.run_user_action(&action).await;
    let duration_ms = u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX);
    match &outcome {
        Ok(_) => tracing::info!(duration_ms, "user or privilege changed"),
        Err(err) => tracing::warn!(kind = err.kind(), "user or privilege change failed"),
    }
    if state.settings.get().await.history_enabled {
        let entry = NewHistoryEntry {
            profile_id: session.info().profile_id,
            database: None,
            sql: preview.join(";\n"),
            duration_ms,
            statements: u32::try_from(preview.len()).unwrap_or(u32::MAX),
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
