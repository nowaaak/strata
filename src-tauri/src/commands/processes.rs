use strata_core::processes::{KillMode, ProcessInfo};
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
pub async fn list_processes(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Vec<ProcessInfo>> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.list_processes().await?)
}

#[tauri::command]
pub async fn kill_process(
    state: State<'_, AppState>,
    session_id: String,
    id: String,
    mode: KillMode,
) -> CommandResult<()> {
    let session = state.sessions.get(&session_id)?;
    session.kill_process(&id, mode).await?;
    tracing::info!(session = %session_id, ?mode, "process stopped");
    Ok(())
}
