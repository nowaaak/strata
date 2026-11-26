use strata_core::snippets::Snippet;
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
pub async fn list_snippets(state: State<'_, AppState>) -> CommandResult<Vec<Snippet>> {
    Ok(state.snippets.list().await)
}

#[tauri::command]
pub async fn save_snippet(
    state: State<'_, AppState>,
    id: Option<String>,
    name: String,
    sql: String,
) -> CommandResult<Snippet> {
    Ok(state.snippets.save(id, &name, &sql).await?)
}

#[tauri::command]
pub async fn delete_snippet(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    Ok(state.snippets.delete(&id).await?)
}
