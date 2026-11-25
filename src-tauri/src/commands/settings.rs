use strata_core::settings::Settings;
use tauri::State;

use crate::error::CommandResult;
use crate::state::{AppPaths, AppState};

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> CommandResult<Settings> {
    Ok(state.settings.get().await)
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    settings: Settings,
) -> CommandResult<Settings> {
    Ok(state.settings.replace(settings).await?)
}

#[tauri::command]
pub fn app_paths(state: State<'_, AppState>) -> AppPaths {
    state.paths.clone()
}
