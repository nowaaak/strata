use strata_core::routines::{Routine, RoutineTarget};
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;
use crate::timing::timed;

#[tauri::command]
pub async fn list_routines(
    state: State<'_, AppState>,
    session_id: String,
    database: String,
    schema: Option<String>,
) -> CommandResult<Vec<Routine>> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed(
        "list_routines",
        session.list_routines(&database, schema.as_deref()),
    )
    .await?)
}

#[tauri::command]
pub async fn routine_ddl(
    state: State<'_, AppState>,
    session_id: String,
    target: RoutineTarget,
) -> CommandResult<String> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed("routine_ddl", session.routine_ddl(&target)).await?)
}
