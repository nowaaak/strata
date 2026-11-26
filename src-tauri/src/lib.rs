mod channel;
mod commands;
mod error;
mod state;
mod timing;

use std::path::Path;
use std::sync::Arc;

use strata_core::history::HistoryStore;
use strata_core::profiles::ProfileStore;
use strata_core::secrets::KeyringStore;
use strata_core::session::SessionManager;
use strata_core::settings::SettingsStore;
use strata_core::snippets::SnippetStore;
use strata_core::workspace::WorkspaceStore;
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::state::{AppPaths, AppState};

const SETTINGS_FILE: &str = "settings.json";
const PROFILES_FILE: &str = "profiles.json";
const WORKSPACE_FILE: &str = "workspace.json";
const HISTORY_FILE: &str = "history.jsonl";
const SNIPPETS_FILE: &str = "snippets.json";
const LOG_FILES_KEPT: usize = 7;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::updater::PendingUpdate::default())
        .setup(|app| {
            channel::check_identity(&app.config().identifier, channel::current())?;
            let data_dir = app.path().app_local_data_dir()?;
            let log_dir = app.path().app_log_dir()?;
            app.manage(init_logging(&log_dir)?);
            tracing::info!(
                version = %app.package_info().version,
                channel = ?channel::current(),
                data_dir = %data_dir.display(),
                log_dir = %log_dir.display(),
                "starting strata"
            );
            let secrets = Arc::new(KeyringStore::new(app.config().identifier.clone()));
            let state = tauri::async_runtime::block_on(async {
                let settings = SettingsStore::load(data_dir.join(SETTINGS_FILE)).await?;
                let profiles =
                    Arc::new(ProfileStore::load(data_dir.join(PROFILES_FILE), secrets).await?);
                let history = HistoryStore::load(data_dir.join(HISTORY_FILE)).await?;
                let snippets = SnippetStore::load(data_dir.join(SNIPPETS_FILE)).await?;
                Ok::<_, strata_core::CoreError>(AppState {
                    settings,
                    sessions: SessionManager::new(profiles.clone()),
                    workspace: WorkspaceStore::new(data_dir.join(WORKSPACE_FILE)),
                    history,
                    snippets,
                    profiles,
                    paths: AppPaths {
                        data_dir: data_dir.display().to_string(),
                        log_dir: log_dir.display().to_string(),
                    },
                })
            })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::app_paths,
            commands::profiles::list_profiles,
            commands::profiles::save_profile,
            commands::profiles::delete_profile,
            commands::profiles::test_connection,
            commands::profiles::set_profile_group,
            commands::profiles::rename_group,
            commands::profiles::set_ssh_host_key,
            commands::profiles::create_sqlite_file,
            commands::sessions::open_session,
            commands::sessions::close_session,
            commands::sessions::list_sessions,
            commands::processes::list_processes,
            commands::processes::kill_process,
            commands::server::server_info,
            commands::routines::list_routines,
            commands::routines::routine_ddl,
            commands::schema::list_databases,
            commands::schema::list_schemas,
            commands::schema::list_objects,
            commands::schema::schema_graph,
            commands::schema::describe_table,
            commands::schema::table_ddl,
            commands::schema::completion_schema,
            commands::schema::equality_filter,
            commands::query::split_sql,
            commands::query::execute_query,
            commands::query::load_table,
            commands::query::cancel_query,
            commands::query::close_tab,
            commands::query::fetch_rows,
            commands::query::export_result,
            commands::query::export_full,
            commands::import::csv_preview,
            commands::import::import_csv,
            commands::query::cancel_export,
            commands::query::explain_query,
            commands::query::dump_database,
            commands::design::table_design,
            commands::design::preview_alter,
            commands::design::apply_alter,
            commands::design::preview_create_table,
            commands::design::create_table,
            commands::ddl::preview_ddl,
            commands::ddl::run_ddl,
            commands::edit::preview_changes,
            commands::edit::apply_changes,
            commands::workspace::load_workspace,
            commands::workspace::save_workspace,
            commands::history::list_history,
            commands::history::delete_history_entry,
            commands::history::clear_history,
            commands::snippets::list_snippets,
            commands::snippets::save_snippet,
            commands::snippets::delete_snippet,
            commands::updater::get_app_info,
            commands::updater::check_for_update,
            commands::updater::install_update,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            eprintln!("failed to run strata: {err}");
            std::process::exit(1);
        });
}

fn init_logging(log_dir: &Path) -> Result<WorkerGuard, Box<dyn std::error::Error>> {
    std::fs::create_dir_all(log_dir)?;
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("strata")
        .filename_suffix("log")
        .max_log_files(LOG_FILES_KEPT)
        .build(log_dir)?;
    let (file_writer, guard) = tracing_appender::non_blocking(appender);
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,strata_lib=debug,strata_core=debug"));
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stdout))
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(file_writer),
        )
        .try_init()?;
    Ok(guard)
}
