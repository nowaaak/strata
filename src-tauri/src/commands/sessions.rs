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
    let info = state.sessions.open(&profile_id, password).await?;
    tracing::info!(
        profile = %profile_id,
        flavor = %info.server.flavor,
        version = %info.server.version,
        "session opened"
    );
    Ok(info)
}

#[tauri::command]
pub async fn close_session(state: State<'_, AppState>, session_id: String) -> CommandResult<()> {
    state.sessions.close(&session_id).await?;
    tracing::info!(session = %session_id, "session closed");
    Ok(())
}

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Vec<SessionInfo> {
    state.sessions.list()
}
