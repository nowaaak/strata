use strata_core::history::HistoryEntry;
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
pub async fn list_history(
    state: State<'_, AppState>,
    profile_id: Option<String>,
    search: Option<String>,
    limit: Option<u32>,
) -> CommandResult<Vec<HistoryEntry>> {
    Ok(state
        .history
        .list(
            profile_id.as_deref(),
            search.as_deref(),
            limit.map(|limit| limit as usize),
        )
        .await)
}

#[tauri::command]
pub async fn delete_history_entry(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    Ok(state.history.delete(&id).await?)
}

#[tauri::command]
pub async fn clear_history(
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> CommandResult<u32> {
    let removed = state.history.clear(profile_id.as_deref()).await?;
    tracing::info!(removed, "history cleared");
    Ok(removed)
}
