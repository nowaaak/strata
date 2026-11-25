mod commands;
mod error;
mod state;

use std::sync::Arc;

use strata_core::profiles::ProfileStore;
use strata_core::secrets::KeyringStore;
use strata_core::session::SessionManager;
use strata_core::settings::SettingsStore;
use strata_core::workspace::WorkspaceStore;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

const SETTINGS_FILE: &str = "settings.json";
const PROFILES_FILE: &str = "profiles.json";
const WORKSPACE_FILE: &str = "workspace.json";

pub fn run() {
    init_logging();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            tracing::info!(data_dir = %data_dir.display(), "starting strata");
            let secrets = Arc::new(KeyringStore::new(app.config().identifier.clone()));
            let state = tauri::async_runtime::block_on(async {
                let settings = SettingsStore::load(data_dir.join(SETTINGS_FILE)).await?;
                let profiles =
                    Arc::new(ProfileStore::load(data_dir.join(PROFILES_FILE), secrets).await?);
                Ok::<_, strata_core::CoreError>(AppState {
                    settings,
                    sessions: SessionManager::new(profiles.clone()),
                    workspace: WorkspaceStore::new(data_dir.join(WORKSPACE_FILE)),
                    profiles,
                })
            })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::profiles::list_profiles,
            commands::profiles::save_profile,
            commands::profiles::delete_profile,
            commands::profiles::test_connection,
            commands::profiles::set_profile_group,
            commands::profiles::rename_group,
            commands::sessions::open_session,
            commands::sessions::close_session,
            commands::sessions::list_sessions,
            commands::schema::list_databases,
            commands::schema::list_schemas,
            commands::schema::list_objects,
            commands::schema::describe_table,
            commands::schema::table_ddl,
            commands::schema::completion_schema,
            commands::query::split_sql,
            commands::query::execute_query,
            commands::query::load_table,
            commands::query::cancel_query,
            commands::query::close_tab,
            commands::query::fetch_rows,
            commands::query::export_result,
            commands::edit::preview_changes,
            commands::edit::apply_changes,
            commands::workspace::load_workspace,
            commands::workspace::save_workspace,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            eprintln!("failed to run strata: {err}");
            std::process::exit(1);
        });
}

fn init_logging() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,strata_lib=debug,strata_core=debug"));
    if let Err(err) = tracing_subscriber::fmt().with_env_filter(filter).try_init() {
        eprintln!("logging is unavailable: {err}");
    }
}
