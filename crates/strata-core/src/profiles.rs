use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use ts_rs::TS;

use crate::fsutil::{read_json_or_default, write_json_atomic};
use crate::secrets::SecretStore;
use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Engine {
    Mysql,
    Postgres,
}

impl Engine {
    pub fn default_port(self) -> u16 {
        match self {
            Self::Mysql => 3306,
            Self::Postgres => 5432,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TlsMode {
    #[default]
    Disabled,
    Required,
    VerifyFull,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ProfileColor {
    #[default]
    None,
    Red,
    Amber,
    Green,
    Sky,
    Violet,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Safety {
    #[default]
    Normal,
    Confirm,
    ReadOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub engine: Engine,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub tls: TlsMode,
    #[serde(default)]
    pub color: ProfileColor,
    #[serde(default)]
    pub safety: Safety,
    #[serde(default)]
    pub ask_password: bool,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "mode", rename_all = "snake_case")]
#[ts(export)]
pub enum PasswordUpdate {
    Keep,
    Set { value: String },
    Clear,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ProfileFile {
    #[serde(default)]
    profiles: Vec<ConnectionProfile>,
}

pub struct ProfileStore {
    path: PathBuf,
    profiles: RwLock<Vec<ConnectionProfile>>,
    secrets: Arc<dyn SecretStore>,
}

impl ProfileStore {
    pub async fn load(path: impl Into<PathBuf>, secrets: Arc<dyn SecretStore>) -> CoreResult<Self> {
        let path = path.into();
        let file: ProfileFile = read_json_or_default(&path).await?;
        Ok(Self {
            path,
            profiles: RwLock::new(file.profiles),
            secrets,
        })
    }

    pub async fn list(&self) -> Vec<ConnectionProfile> {
        self.profiles.read().await.clone()
    }

    pub async fn get(&self, id: &str) -> CoreResult<ConnectionProfile> {
        self.profiles
            .read()
            .await
            .iter()
            .find(|profile| profile.id == id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("connection profile {id} does not exist")))
    }

    pub async fn save(
        &self,
        profile: ConnectionProfile,
        password: PasswordUpdate,
    ) -> CoreResult<ConnectionProfile> {
        let mut profile = normalize(profile)?;
        let mut profiles = self.profiles.write().await;
        let existing = profiles.iter().position(|item| item.id == profile.id);
        if profile.id.is_empty() {
            profile.id = uuid::Uuid::new_v4().to_string();
        } else if existing.is_none() {
            return Err(CoreError::NotFound(format!(
                "connection profile {} does not exist",
                profile.id
            )));
        }

        self.apply_password(&profile, &password)?;

        let mut next = profiles.clone();
        match existing {
            Some(index) => next[index] = profile.clone(),
            None => next.push(profile.clone()),
        }
        let file = ProfileFile { profiles: next };
        if let Err(err) = write_json_atomic(&self.path, &file).await {
            if existing.is_none()
                && let Err(cleanup) = self.secrets.delete(&profile.id)
            {
                tracing::warn!(error = %cleanup, "could not remove password of unsaved profile");
            }
            return Err(err);
        }
        *profiles = file.profiles;
        Ok(profile)
    }

    pub async fn delete(&self, id: &str) -> CoreResult<()> {
        let mut profiles = self.profiles.write().await;
        let next: Vec<ConnectionProfile> = profiles
            .iter()
            .filter(|profile| profile.id != id)
            .cloned()
            .collect();
        if next.len() == profiles.len() {
            return Err(CoreError::NotFound(format!(
                "connection profile {id} does not exist"
            )));
        }
        let file = ProfileFile { profiles: next };
        write_json_atomic(&self.path, &file).await?;
        *profiles = file.profiles;
        self.secrets.delete(id)
    }

    pub async fn set_group(
        &self,
        id: &str,
        group: Option<String>,
    ) -> CoreResult<ConnectionProfile> {
        let group = normalize_group(group)?;
        let mut profiles = self.profiles.write().await;
        let mut next = profiles.clone();
        let profile = next
            .iter_mut()
            .find(|profile| profile.id == id)
            .ok_or_else(|| {
                CoreError::NotFound(format!("connection profile {id} does not exist"))
            })?;
        profile.group = group;
        let updated = profile.clone();
        let file = ProfileFile { profiles: next };
        write_json_atomic(&self.path, &file).await?;
        *profiles = file.profiles;
        Ok(updated)
    }

    pub async fn rename_group(&self, from: &str, to: Option<String>) -> CoreResult<u32> {
        let to = normalize_group(to)?;
        let mut profiles = self.profiles.write().await;
        let mut next = profiles.clone();
        let mut moved = 0;
        for profile in next
            .iter_mut()
            .filter(|profile| profile.group.as_deref() == Some(from))
        {
            profile.group = to.clone();
            moved += 1;
        }
        if moved == 0 {
            return Err(CoreError::NotFound(format!("group {from} does not exist")));
        }
        let file = ProfileFile { profiles: next };
        write_json_atomic(&self.path, &file).await?;
        *profiles = file.profiles;
        Ok(moved)
    }

    pub fn resolve_password(
        &self,
        profile: &ConnectionProfile,
        update: &PasswordUpdate,
    ) -> CoreResult<Option<String>> {
        match update {
            PasswordUpdate::Set { value } => Ok(Some(value.clone())),
            PasswordUpdate::Clear => Ok(None),
            PasswordUpdate::Keep if profile.ask_password || profile.id.is_empty() => Ok(None),
            PasswordUpdate::Keep => self.secrets.get(&profile.id),
        }
    }

    fn apply_password(
        &self,
        profile: &ConnectionProfile,
        password: &PasswordUpdate,
    ) -> CoreResult<()> {
        if profile.ask_password {
            return self.secrets.delete(&profile.id);
        }
        match password {
            PasswordUpdate::Keep => Ok(()),
            PasswordUpdate::Set { value } => self.secrets.set(&profile.id, value),
            PasswordUpdate::Clear => self.secrets.delete(&profile.id),
        }
    }
}

fn normalize(mut profile: ConnectionProfile) -> CoreResult<ConnectionProfile> {
    profile.id = profile.id.trim().to_string();
    profile.name = profile.name.trim().to_string();
    profile.host = profile.host.trim().to_string();
    profile.user = profile.user.trim().to_string();
    profile.database = profile
        .database
        .map(|database| database.trim().to_string())
        .filter(|database| !database.is_empty());

    if profile.name.is_empty() {
        return Err(CoreError::InvalidInput("name must not be empty".into()));
    }
    if profile.name.chars().count() > 100 {
        return Err(CoreError::InvalidInput(
            "name must be at most 100 characters".into(),
        ));
    }
    if profile.host.is_empty() {
        return Err(CoreError::InvalidInput("host must not be empty".into()));
    }
    if profile.port == 0 {
        return Err(CoreError::InvalidInput(
            "port must be between 1 and 65535".into(),
        ));
    }
    if profile.user.is_empty() {
        return Err(CoreError::InvalidInput("user must not be empty".into()));
    }
    profile.group = normalize_group(profile.group)?;
    Ok(profile)
}

const MAX_GROUP_CHARS: usize = 60;

fn normalize_group(group: Option<String>) -> CoreResult<Option<String>> {
    let group = group
        .map(|group| group.trim().to_string())
        .filter(|group| !group.is_empty());
    if group
        .as_ref()
        .is_some_and(|group| group.chars().count() > MAX_GROUP_CHARS)
    {
        return Err(CoreError::InvalidInput(format!(
            "group name must be at most {MAX_GROUP_CHARS} characters"
        )));
    }
    Ok(group)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecretStore;

    fn sample() -> ConnectionProfile {
        ConnectionProfile {
            id: String::new(),
            name: "  Local  ".into(),
            engine: Engine::Mysql,
            host: "localhost".into(),
            port: 3306,
            user: "root".into(),
            database: Some("  ".into()),
            tls: TlsMode::Disabled,
            color: ProfileColor::None,
            safety: Safety::Normal,
            ask_password: false,
            group: Some("  ".into()),
        }
    }

    #[tokio::test]
    async fn groups_can_be_assigned_renamed_and_dissolved() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = store(&dir).await;
        let first = store.save(sample(), PasswordUpdate::Keep).await.unwrap();
        assert_eq!(first.group, None);
        let second = store.save(sample(), PasswordUpdate::Keep).await.unwrap();

        let moved = store
            .set_group(&first.id, Some("  Kunden ".into()))
            .await
            .unwrap();
        assert_eq!(moved.group.as_deref(), Some("Kunden"));
        store
            .set_group(&second.id, Some("Kunden".into()))
            .await
            .unwrap();

        assert_eq!(
            store
                .rename_group("Kunden", Some("Produktion".into()))
                .await
                .unwrap(),
            2
        );
        let reloaded = ProfileStore::load(
            dir.path().join("profiles.json"),
            Arc::new(MemorySecretStore::default()),
        )
        .await
        .unwrap();
        assert!(
            reloaded
                .list()
                .await
                .iter()
                .all(|profile| profile.group.as_deref() == Some("Produktion"))
        );

        assert_eq!(store.rename_group("Produktion", None).await.unwrap(), 2);
        assert!(
            store
                .list()
                .await
                .iter()
                .all(|profile| profile.group.is_none())
        );
        assert_eq!(
            store
                .rename_group("Produktion", None)
                .await
                .unwrap_err()
                .kind(),
            "not_found"
        );
        assert_eq!(
            store
                .set_group(&first.id, Some("x".repeat(61)))
                .await
                .unwrap_err()
                .kind(),
            "invalid_input"
        );
    }

    async fn store(dir: &tempfile::TempDir) -> (ProfileStore, Arc<MemorySecretStore>) {
        let secrets = Arc::new(MemorySecretStore::default());
        let store = ProfileStore::load(dir.path().join("profiles.json"), secrets.clone())
            .await
            .unwrap();
        (store, secrets)
    }

    #[tokio::test]
    async fn save_assigns_id_normalizes_and_stores_password() {
        let dir = tempfile::tempdir().unwrap();
        let (store, secrets) = store(&dir).await;
        let saved = store
            .save(
                sample(),
                PasswordUpdate::Set {
                    value: "secret".into(),
                },
            )
            .await
            .unwrap();

        assert!(!saved.id.is_empty());
        assert_eq!(saved.name, "Local");
        assert_eq!(saved.database, None);
        assert_eq!(secrets.get(&saved.id).unwrap().as_deref(), Some("secret"));

        let reloaded = ProfileStore::load(dir.path().join("profiles.json"), secrets.clone())
            .await
            .unwrap();
        assert_eq!(reloaded.list().await, vec![saved.clone()]);
        let raw = std::fs::read_to_string(dir.path().join("profiles.json")).unwrap();
        assert!(!raw.contains("secret"));
    }

    #[tokio::test]
    async fn keep_preserves_password_and_ask_password_removes_it() {
        let dir = tempfile::tempdir().unwrap();
        let (store, secrets) = store(&dir).await;
        let saved = store
            .save(sample(), PasswordUpdate::Set { value: "pw".into() })
            .await
            .unwrap();

        let mut renamed = saved.clone();
        renamed.name = "Renamed".into();
        store.save(renamed, PasswordUpdate::Keep).await.unwrap();
        assert_eq!(secrets.get(&saved.id).unwrap().as_deref(), Some("pw"));
        assert_eq!(
            store
                .resolve_password(&saved, &PasswordUpdate::Keep)
                .unwrap()
                .as_deref(),
            Some("pw")
        );

        let mut asking = saved.clone();
        asking.ask_password = true;
        store
            .save(asking.clone(), PasswordUpdate::Keep)
            .await
            .unwrap();
        assert_eq!(secrets.get(&saved.id).unwrap(), None);
        assert_eq!(
            store
                .resolve_password(&asking, &PasswordUpdate::Keep)
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn rejects_invalid_profiles_and_unknown_ids() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = store(&dir).await;
        let mut nameless = sample();
        nameless.name = " ".into();
        assert_eq!(
            store
                .save(nameless, PasswordUpdate::Keep)
                .await
                .unwrap_err()
                .kind(),
            "invalid_input"
        );

        let mut no_port = sample();
        no_port.port = 0;
        assert!(store.save(no_port, PasswordUpdate::Keep).await.is_err());

        let mut unknown = sample();
        unknown.id = "missing".into();
        assert_eq!(
            store
                .save(unknown, PasswordUpdate::Keep)
                .await
                .unwrap_err()
                .kind(),
            "not_found"
        );
        assert!(store.list().await.is_empty());
    }

    #[tokio::test]
    async fn delete_removes_profile_and_password() {
        let dir = tempfile::tempdir().unwrap();
        let (store, secrets) = store(&dir).await;
        let saved = store
            .save(sample(), PasswordUpdate::Set { value: "pw".into() })
            .await
            .unwrap();
        store.delete(&saved.id).await.unwrap();
        assert!(store.list().await.is_empty());
        assert_eq!(secrets.get(&saved.id).unwrap(), None);
        assert_eq!(
            store.delete(&saved.id).await.unwrap_err().kind(),
            "not_found"
        );
    }
}
