use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::fsutil::{read_json_or_default, write_json_atomic};
use crate::{CoreError, CoreResult};

const NAME_MAX: usize = 120;
const SQL_MAX: usize = 1_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub sql: String,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SnippetFile {
    #[serde(default)]
    snippets: Vec<Snippet>,
}

pub struct SnippetStore {
    path: PathBuf,
    snippets: Mutex<Vec<Snippet>>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default()
}

fn sorted(mut snippets: Vec<Snippet>) -> Vec<Snippet> {
    snippets.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    snippets
}

impl SnippetStore {
    pub async fn load(path: PathBuf) -> CoreResult<Self> {
        let file: SnippetFile = read_json_or_default(&path).await?;
        Ok(Self {
            path,
            snippets: Mutex::new(file.snippets),
        })
    }

    pub async fn list(&self) -> Vec<Snippet> {
        sorted(self.snippets.lock().await.clone())
    }

    pub async fn save(&self, id: Option<String>, name: &str, sql: &str) -> CoreResult<Snippet> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > NAME_MAX {
            return Err(CoreError::InvalidInput(format!(
                "the snippet name must have 1 to {NAME_MAX} characters"
            )));
        }
        if sql.trim().is_empty() || sql.len() > SQL_MAX {
            return Err(CoreError::InvalidInput(
                "the snippet needs SQL and must stay below 1 MB".into(),
            ));
        }
        let mut snippets = self.snippets.lock().await;
        let mut next = snippets.clone();
        let snippet = match id {
            Some(id) => {
                let existing = next
                    .iter_mut()
                    .find(|snippet| snippet.id == id)
                    .ok_or_else(|| CoreError::NotFound(format!("snippet {id} does not exist")))?;
                existing.name = name.to_string();
                existing.sql = sql.to_string();
                existing.updated_at = now_ms();
                existing.clone()
            }
            None => {
                let snippet = Snippet {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: name.to_string(),
                    sql: sql.to_string(),
                    updated_at: now_ms(),
                };
                next.push(snippet.clone());
                snippet
            }
        };
        write_json_atomic(
            &self.path,
            &SnippetFile {
                snippets: next.clone(),
            },
        )
        .await?;
        *snippets = next;
        Ok(snippet)
    }

    pub async fn delete(&self, id: &str) -> CoreResult<()> {
        let mut snippets = self.snippets.lock().await;
        let next: Vec<Snippet> = snippets
            .iter()
            .filter(|snippet| snippet.id != id)
            .cloned()
            .collect();
        if next.len() == snippets.len() {
            return Err(CoreError::NotFound(format!("snippet {id} does not exist")));
        }
        write_json_atomic(
            &self.path,
            &SnippetFile {
                snippets: next.clone(),
            },
        )
        .await?;
        *snippets = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn saves_updates_deletes_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("snippets.json");
        let store = SnippetStore::load(path.clone()).await.unwrap();
        let b = store
            .save(None, " Bestellungen ", "SELECT * FROM orders")
            .await
            .unwrap();
        assert_eq!(b.name, "Bestellungen");
        store.save(None, "aktive Kunden", "SELECT 1").await.unwrap();
        assert_eq!(
            store
                .list()
                .await
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>(),
            ["aktive Kunden", "Bestellungen"]
        );

        store
            .save(Some(b.id.clone()), "Bestellungen heute", "SELECT 2")
            .await
            .unwrap();
        let reloaded = SnippetStore::load(path.clone()).await.unwrap();
        let updated = reloaded
            .list()
            .await
            .into_iter()
            .find(|snippet| snippet.id == b.id)
            .unwrap();
        assert_eq!(updated.sql, "SELECT 2");

        reloaded.delete(&b.id).await.unwrap();
        assert_eq!(
            SnippetStore::load(path).await.unwrap().list().await.len(),
            1
        );
    }

    #[tokio::test]
    async fn rejects_empty_input_and_unknown_ids() {
        let dir = tempfile::tempdir().unwrap();
        let store = SnippetStore::load(dir.path().join("s.json")).await.unwrap();
        assert_eq!(
            store.save(None, "  ", "SELECT 1").await.unwrap_err().kind(),
            "invalid_input"
        );
        assert_eq!(
            store.save(None, "x", " ").await.unwrap_err().kind(),
            "invalid_input"
        );
        assert_eq!(
            store
                .save(Some("nope".into()), "x", "SELECT 1")
                .await
                .unwrap_err()
                .kind(),
            "not_found"
        );
        assert_eq!(store.delete("nope").await.unwrap_err().kind(), "not_found");
    }
}
