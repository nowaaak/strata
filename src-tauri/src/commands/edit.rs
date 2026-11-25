use strata_core::schema::TableTarget;
use strata_core::sql::RowChange;
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
pub async fn preview_changes(
    state: State<'_, AppState>,
    session_id: String,
    target: TableTarget,
    changes: Vec<RowChange>,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.preview_changes(&target, &changes).await?)
}

#[tauri::command]
pub async fn apply_changes(
    state: State<'_, AppState>,
    session_id: String,
    tab_id: String,
    target: TableTarget,
    changes: Vec<RowChange>,
) -> CommandResult<u32> {
    let session = state.sessions.get(&session_id)?;
    Ok(session.apply_changes(&tab_id, &target, &changes).await?)
}
