use strata_core::driver::ServerDetails;
use strata_core::profiles::{ConnectionProfile, PasswordUpdate};
use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
pub async fn list_profiles(state: State<'_, AppState>) -> CommandResult<Vec<ConnectionProfile>> {
    Ok(state.profiles.list().await)
}

#[tauri::command]
pub async fn save_profile(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
    password: PasswordUpdate,
    ssh_secret: Option<PasswordUpdate>,
) -> CommandResult<ConnectionProfile> {
    let ssh_secret = ssh_secret.unwrap_or(PasswordUpdate::Keep);
    Ok(state.profiles.save(profile, password, ssh_secret).await?)
}

#[tauri::command]
pub async fn delete_profile(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.sessions.close_profile(&id).await;
    Ok(state.profiles.delete(&id).await?)
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
    password: PasswordUpdate,
    ssh_secret: Option<PasswordUpdate>,
) -> CommandResult<ServerDetails> {
    let ssh_secret = ssh_secret.unwrap_or(PasswordUpdate::Keep);
    Ok(state
        .sessions
        .test(&profile, &password, &ssh_secret)
        .await?)
}

#[tauri::command]
pub async fn set_ssh_host_key(
    state: State<'_, AppState>,
    id: String,
    fingerprint: Option<String>,
) -> CommandResult<ConnectionProfile> {
    tracing::info!(profile = %id, trusted = fingerprint.is_some(), "ssh host key updated");
    Ok(state.profiles.set_ssh_host_key(&id, fingerprint).await?)
}

#[tauri::command]
pub async fn set_profile_group(
    state: State<'_, AppState>,
    id: String,
    group: Option<String>,
) -> CommandResult<ConnectionProfile> {
    Ok(state.profiles.set_group(&id, group).await?)
}

#[tauri::command]
pub async fn rename_group(
    state: State<'_, AppState>,
    from: String,
    to: Option<String>,
) -> CommandResult<u32> {
    Ok(state.profiles.rename_group(&from, to).await?)
}
