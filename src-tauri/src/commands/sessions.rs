use strata_core::session::SessionInfo;
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
pub async fn open_session(
    state: State<'_, AppState>,
    profile_id: String,
    password: Option<String>,
) -> CommandResult<SessionInfo> {
    Ok(state.sessions.open(&profile_id, password).await?)
}

#[tauri::command]
pub async fn close_session(state: State<'_, AppState>, session_id: String) -> CommandResult<()> {
    Ok(state.sessions.close(&session_id).await?)
}

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Vec<SessionInfo> {
    state.sessions.list()
}
