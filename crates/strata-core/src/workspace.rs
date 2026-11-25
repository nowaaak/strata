use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::fsutil::write_json_atomic;
use crate::schema::TableTarget;
use crate::{CoreError, CoreResult};

pub const MAX_TABS: usize = 200;
pub const MAX_SQL_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum SavedTab {
    Query {
        id: String,
        profile_id: String,
        number: u32,
        database: Option<String>,
        sql: String,
    },
    Table {
        id: String,
        profile_id: String,
        title: String,
        target: TableTarget,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export)]
pub struct SavedWorkspace {
    pub tabs: Vec<SavedTab>,
    pub active_tab_id: Option<String>,
    pub query_counter: u32,
}

impl SavedWorkspace {
    fn validate(&self) -> CoreResult<()> {
        if self.tabs.len() > MAX_TABS {
            return Err(CoreError::InvalidInput(format!(
                "at most {MAX_TABS} tabs can be kept"
            )));
        }
        let oversized = self.tabs.iter().any(|tab| match tab {
            SavedTab::Query { sql, .. } => sql.len() > MAX_SQL_BYTES,
            SavedTab::Table { .. } => false,
        });
        if oversized {
            return Err(CoreError::InvalidInput(format!(
                "a query draft is larger than {} MB",
                MAX_SQL_BYTES / 1024 / 1024
            )));
        }
        Ok(())
    }
}

pub struct WorkspaceStore {
    path: PathBuf,
    write: Mutex<()>,
}

impl WorkspaceStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            write: Mutex::new(()),
        }
    }

    pub async fn load(&self) -> CoreResult<SavedWorkspace> {
        let bytes = match tokio::fs::read(&self.path).await {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(SavedWorkspace::default());
            }
            Err(err) => return Err(CoreError::io(&self.path, err)),
        };
        match serde_json::from_slice(&bytes) {
            Ok(workspace) => Ok(workspace),
            Err(err) => {
                let mut backup = self.path.as_os_str().to_owned();
                backup.push(".corrupt");
                let backup = PathBuf::from(backup);
                tracing::warn!(error = %err, backup = %backup.display(), "workspace file is unreadable, starting empty");
                tokio::fs::rename(&self.path, &backup)
                    .await
                    .map_err(|err| CoreError::io(&backup, err))?;
                Ok(SavedWorkspace::default())
            }
        }
    }

    pub async fn save(&self, workspace: &SavedWorkspace) -> CoreResult<()> {
        workspace.validate()?;
        let _guard = self.write.lock().await;
        write_json_atomic(&self.path, workspace).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> SavedWorkspace {
        SavedWorkspace {
            tabs: vec![
                SavedTab::Query {
                    id: "q1".into(),
                    profile_id: "p1".into(),
                    number: 3,
                    database: Some("shop".into()),
                    sql: "SELECT 'ä';\n-- draft".into(),
                },
                SavedTab::Table {
                    id: "t1".into(),
                    profile_id: "p2".into(),
                    title: "orders".into(),
                    target: TableTarget {
                        database: "app".into(),
                        schema: Some("public".into()),
                        table: "orders".into(),
                    },
                },
            ],
            active_tab_id: Some("t1".into()),
            query_counter: 3,
        }
    }

    #[tokio::test]
    async fn missing_file_yields_an_empty_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path().join("workspace.json"));
        assert_eq!(store.load().await.unwrap(), SavedWorkspace::default());
    }

    #[tokio::test]
    async fn saved_tabs_survive_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        WorkspaceStore::new(&path).save(&sample()).await.unwrap();
        assert_eq!(WorkspaceStore::new(&path).load().await.unwrap(), sample());
    }

    #[tokio::test]
    async fn corrupt_files_are_moved_aside_instead_of_blocking_startup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        tokio::fs::write(&path, b"{broken").await.unwrap();
        let store = WorkspaceStore::new(&path);
        assert_eq!(store.load().await.unwrap(), SavedWorkspace::default());
        assert!(dir.path().join("workspace.json.corrupt").exists());
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn rejects_oversized_workspaces() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path().join("workspace.json"));
        let mut huge = sample();
        if let SavedTab::Query { sql, .. } = &mut huge.tabs[0] {
            *sql = "x".repeat(MAX_SQL_BYTES + 1);
        }
        assert_eq!(store.save(&huge).await.unwrap_err().kind(), "invalid_input");
        let many = SavedWorkspace {
            tabs: vec![sample().tabs[1].clone(); MAX_TABS + 1],
            ..SavedWorkspace::default()
        };
        assert!(store.save(&many).await.is_err());
    }
}
