use std::sync::Arc;

use serde::Serialize;
use strata_core::history::HistoryStore;
use strata_core::profiles::ProfileStore;
use strata_core::session::SessionManager;
use strata_core::settings::SettingsStore;
use strata_core::workspace::WorkspaceStore;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppPaths {
    pub data_dir: String,
    pub log_dir: String,
}

pub struct AppState {
    pub settings: SettingsStore,
    pub profiles: Arc<ProfileStore>,
    pub sessions: SessionManager,
    pub workspace: WorkspaceStore,
    pub history: HistoryStore,
    pub paths: AppPaths,
}
