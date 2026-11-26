use strata_core::server::{ServerInfoKind, ServerSetting};
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
