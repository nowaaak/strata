use strata_core::server::{ServerInfoKind, ServerSetting, VariableChange};
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
pub async fn server_info(
    state: State<'_, AppState>,
    session_id: String,
    kind: ServerInfoKind,
) -> CommandResult<Vec<ServerSetting>> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.server_info(kind).await?)
}

#[tauri::command]
pub fn preview_server_variable(
    state: State<'_, AppState>,
    session_id: String,
    change: VariableChange,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.preview_variable(&change)?)
}

#[tauri::command]
pub async fn set_server_variable(
    state: State<'_, AppState>,
    session_id: String,
    change: VariableChange,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    let outcome = session.set_variable(&change).await;
    match &outcome {
        Ok(_) => tracing::info!(name = %change.name, "server variable changed"),
        Err(err) => {
            tracing::warn!(name = %change.name, kind = err.kind(), "server variable change failed")
        }
    }
    Ok(outcome?)
}
