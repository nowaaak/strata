use strata_core::schema::{CompletionTable, DbObject, TableInfo, TableTarget};
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;
use crate::timing::timed;

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed("list_databases", session.list_databases()).await?)
}

#[tauri::command]
pub async fn list_schemas(
    state: State<'_, AppState>,
    session_id: String,
    database: String,
) -> CommandResult<Vec<String>> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed("list_schemas", session.list_schemas(&database)).await?)
}

#[tauri::command]
pub async fn list_objects(
    state: State<'_, AppState>,
    session_id: String,
    database: String,
    schema: Option<String>,
) -> CommandResult<Vec<DbObject>> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed(
        "list_objects",
        session.list_objects(&database, schema.as_deref()),
    )
    .await?)
}

#[tauri::command]
pub async fn describe_table(
    state: State<'_, AppState>,
    session_id: String,
    target: TableTarget,
) -> CommandResult<TableInfo> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed("describe_table", session.describe_table(&target)).await?)
}

#[tauri::command]
pub async fn table_ddl(
    state: State<'_, AppState>,
    session_id: String,
    target: TableTarget,
) -> CommandResult<String> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed("table_ddl", session.table_ddl(&target)).await?)
}

#[tauri::command]
pub async fn completion_schema(
    state: State<'_, AppState>,
    session_id: String,
    database: String,
) -> CommandResult<Vec<CompletionTable>> {
    let session = state.sessions.get(&session_id)?;
    Ok(timed("completion_schema", session.completion(&database)).await?)
}
