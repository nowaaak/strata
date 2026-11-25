use strata_core::workspace::SavedWorkspace;
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
pub async fn load_workspace(state: State<'_, AppState>) -> CommandResult<SavedWorkspace> {
    Ok(state.workspace.load().await?)
}

#[tauri::command]
pub async fn save_workspace(
    state: State<'_, AppState>,
    workspace: SavedWorkspace,
) -> CommandResult<()> {
    Ok(state.workspace.save(&workspace).await?)
}
