use std::sync::Arc;

use strata_core::profiles::ProfileStore;
use strata_core::session::SessionManager;
use strata_core::settings::SettingsStore;
use strata_core::workspace::WorkspaceStore;

pub struct AppState {
    pub settings: SettingsStore,
    pub profiles: Arc<ProfileStore>,
    pub sessions: SessionManager,
    pub workspace: WorkspaceStore,
}
