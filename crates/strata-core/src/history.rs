use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::fsutil::write_atomic;
use crate::{CoreError, CoreResult};

pub const MAX_ENTRIES: usize = 5_000;
pub const MAX_SQL_BYTES: usize = 100 * 1024;
const MAX_ERROR_CHARS: usize = 500;
const DEFAULT_LIMIT: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HistoryStatus {
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HistoryEntry {
    pub id: String,
    pub profile_id: String,
    pub database: Option<String>,
    pub sql: String,
    pub executed_at: i64,
    pub duration_ms: u32,
    pub statements: u32,
    pub rows: Option<u32>,
    pub affected: Option<u32>,
    pub status: HistoryStatus,
    pub error: Option<String>,
    pub runs: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewHistoryEntry {
    pub profile_id: String,
    pub database: Option<String>,
    pub sql: String,
    pub duration_ms: u32,
    pub statements: u32,
    pub rows: Option<u32>,
    pub affected: Option<u32>,
    pub status: HistoryStatus,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum Line {
    Entry(HistoryEntry),
    Deleted { deleted: String },
}

struct State {
    entries: Vec<HistoryEntry>,
    lines: usize,
}

pub struct HistoryStore {
    path: PathBuf,
    state: Mutex<State>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn truncate(text: String, max: usize) -> String {
    if text.chars().count() <= max {
        text
    } else {
        format!("{}…", text.chars().take(max).collect::<String>())
    }
}

fn apply(entries: &mut Vec<HistoryEntry>, line: Line) {
    match line {
        Line::Entry(entry) => {
            entries.retain(|existing| existing.id != entry.id);
            entries.push(entry);
        }
        Line::Deleted { deleted } => entries.retain(|existing| existing.id != deleted),
    }
}

fn trim(entries: &mut Vec<HistoryEntry>) {
    if entries.len() > MAX_ENTRIES {
        let excess = entries.len() - MAX_ENTRIES;
        entries.drain(..excess);
    }
}

fn matches(entry: &HistoryEntry, words: &[String]) -> bool {
    let sql = entry.sql.to_lowercase();
    let database = entry.database.as_deref().unwrap_or_default().to_lowercase();
    words
        .iter()
        .all(|word| sql.contains(word) || database.contains(word))
}

impl HistoryStore {
    pub async fn load(path: impl Into<PathBuf>) -> CoreResult<Self> {
        let path = path.into();
        let text = match tokio::fs::read(&path).await {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(err) => return Err(CoreError::io(&path, err)),
        };
        let mut entries = Vec::new();
        let mut lines = 0;
        for raw in text.lines().filter(|line| !line.trim().is_empty()) {
            lines += 1;
            match serde_json::from_str::<Line>(raw) {
                Ok(line) => apply(&mut entries, line),
                Err(err) => tracing::warn!(error = %err, "skipping unreadable history line"),
            }
        }
        trim(&mut entries);
        let store = Self {
            path,
            state: Mutex::new(State { entries, lines }),
        };
        {
            let mut state = store.state.lock().await;
            if state.lines > state.entries.len() * 2 + 100 {
                store.compact(&mut state).await?;
            }
        }
        Ok(store)
    }

    pub async fn record(&self, new: NewHistoryEntry) -> CoreResult<Option<HistoryEntry>> {
        if new.sql.len() > MAX_SQL_BYTES || new.sql.trim().is_empty() {
            return Ok(None);
        }
        let mut state = self.state.lock().await;
        let previous = state
            .entries
            .iter()
            .rev()
            .find(|entry| entry.profile_id == new.profile_id)
            .filter(|entry| entry.sql == new.sql && entry.database == new.database)
            .cloned();
        let entry = HistoryEntry {
            id: previous.as_ref().map_or_else(
                || uuid::Uuid::new_v4().to_string(),
                |entry| entry.id.clone(),
            ),
            runs: previous
                .as_ref()
                .map_or(1, |entry| entry.runs.saturating_add(1)),
            profile_id: new.profile_id,
            database: new.database,
            sql: new.sql,
            executed_at: now_ms(),
            duration_ms: new.duration_ms,
            statements: new.statements,
            rows: new.rows,
            affected: new.affected,
            status: new.status,
            error: new.error.map(|error| truncate(error, MAX_ERROR_CHARS)),
        };
        self.append(&mut state, &Line::Entry(entry.clone())).await?;
        apply(&mut state.entries, Line::Entry(entry.clone()));
        trim(&mut state.entries);
        Ok(Some(entry))
    }

    pub async fn list(
        &self,
        profile_id: Option<&str>,
        search: Option<&str>,
        limit: Option<usize>,
    ) -> Vec<HistoryEntry> {
        let words: Vec<String> = search
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_lowercase)
            .collect();
        let state = self.state.lock().await;
        state
            .entries
            .iter()
            .rev()
            .filter(|entry| profile_id.is_none_or(|id| entry.profile_id == id))
            .filter(|entry| matches(entry, &words))
            .take(limit.unwrap_or(DEFAULT_LIMIT).min(MAX_ENTRIES))
            .cloned()
            .collect()
    }

    pub async fn delete(&self, id: &str) -> CoreResult<()> {
        let mut state = self.state.lock().await;
        if !state.entries.iter().any(|entry| entry.id == id) {
            return Err(CoreError::NotFound(format!(
                "history entry {id} does not exist"
            )));
        }
        let line = Line::Deleted {
            deleted: id.to_string(),
        };
        self.append(&mut state, &line).await?;
        apply(&mut state.entries, line);
        Ok(())
    }

    pub async fn clear(&self, profile_id: Option<&str>) -> CoreResult<u32> {
        let mut state = self.state.lock().await;
        let before = state.entries.len();
        state
            .entries
            .retain(|entry| profile_id.is_some_and(|id| entry.profile_id != id));
        let removed = (before - state.entries.len()) as u32;
        self.compact(&mut state).await?;
        Ok(removed)
    }

    async fn append(&self, state: &mut State, line: &Line) -> CoreResult<()> {
        let mut text =
            serde_json::to_string(line).map_err(|err| CoreError::json(&self.path, err))?;
        text.push('\n');
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|err| CoreError::io(parent, err))?;
        }
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await
            .map_err(|err| CoreError::io(&self.path, err))?;
        file.write_all(text.as_bytes())
            .await
            .map_err(|err| CoreError::io(&self.path, err))?;
        file.flush()
            .await
            .map_err(|err| CoreError::io(&self.path, err))?;
        state.lines += 1;
        Ok(())
    }

    async fn compact(&self, state: &mut State) -> CoreResult<()> {
        let mut text = String::new();
        for entry in &state.entries {
            text.push_str(
                &serde_json::to_string(&Line::Entry(entry.clone()))
                    .map_err(|err| CoreError::json(&self.path, err))?,
            );
            text.push('\n');
        }
        write_atomic(&self.path, text.as_bytes()).await?;
        state.lines = state.entries.len();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new(profile: &str, sql: &str) -> NewHistoryEntry {
        NewHistoryEntry {
            profile_id: profile.into(),
            database: Some("shop".into()),
            sql: sql.into(),
            duration_ms: 12,
            statements: 1,
            rows: Some(3),
            affected: None,
            status: HistoryStatus::Success,
            error: None,
        }
    }

    async fn store(dir: &tempfile::TempDir) -> HistoryStore {
        HistoryStore::load(dir.path().join("history.jsonl"))
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn records_newest_first_and_survives_reload() {
        let dir = tempfile::tempdir().unwrap();
        let history = store(&dir).await;
        history.record(new("p1", "SELECT 1")).await.unwrap();
        history.record(new("p1", "SELECT 2")).await.unwrap();
        history.record(new("p2", "SELECT 3")).await.unwrap();

        let reloaded = store(&dir).await;
        let all: Vec<String> = reloaded
            .list(None, None, None)
            .await
            .into_iter()
            .map(|entry| entry.sql)
            .collect();
        assert_eq!(all, vec!["SELECT 3", "SELECT 2", "SELECT 1"]);
        assert_eq!(reloaded.list(Some("p1"), None, None).await.len(), 2);
        assert_eq!(reloaded.list(None, None, Some(1)).await.len(), 1);
    }

    #[tokio::test]
    async fn repeating_the_last_statement_counts_runs_instead_of_duplicating() {
        let dir = tempfile::tempdir().unwrap();
        let history = store(&dir).await;
        let first = history
            .record(new("p1", "SELECT 1"))
            .await
            .unwrap()
            .unwrap();
        let mut failed = new("p1", "SELECT 1");
        failed.status = HistoryStatus::Failed;
        failed.error = Some("x".repeat(900));
        let second = history.record(failed).await.unwrap().unwrap();
        assert_eq!(second.id, first.id);
        assert_eq!(second.runs, 2);
        assert_eq!(second.status, HistoryStatus::Failed);
        assert_eq!(second.error.unwrap().chars().count(), MAX_ERROR_CHARS + 1);

        history.record(new("p1", "SELECT 2")).await.unwrap();
        history.record(new("p1", "SELECT 1")).await.unwrap();
        assert_eq!(store(&dir).await.list(None, None, None).await.len(), 3);
    }

    #[tokio::test]
    async fn search_matches_all_words_case_insensitively() {
        let dir = tempfile::tempdir().unwrap();
        let history = store(&dir).await;
        history
            .record(new("p1", "SELECT * FROM Kunden WHERE stadt = 'Köln'"))
            .await
            .unwrap();
        history
            .record(new("p1", "SELECT * FROM orders"))
            .await
            .unwrap();
        let hits = history.list(None, Some("kunden köln"), None).await;
        assert_eq!(hits.len(), 1);
        assert_eq!(history.list(None, Some("shop"), None).await.len(), 2);
        assert!(history.list(None, Some("missing"), None).await.is_empty());
    }

    #[tokio::test]
    async fn delete_and_clear_persist() {
        let dir = tempfile::tempdir().unwrap();
        let history = store(&dir).await;
        let entry = history
            .record(new("p1", "SELECT 1"))
            .await
            .unwrap()
            .unwrap();
        history.record(new("p2", "SELECT 2")).await.unwrap();
        history.record(new("p2", "SELECT 3")).await.unwrap();
        history.delete(&entry.id).await.unwrap();
        assert_eq!(
            history.delete(&entry.id).await.unwrap_err().kind(),
            "not_found"
        );
        assert_eq!(store(&dir).await.list(None, None, None).await.len(), 2);

        assert_eq!(history.clear(Some("p2")).await.unwrap(), 2);
        assert!(store(&dir).await.list(None, None, None).await.is_empty());
    }

    #[tokio::test]
    async fn skips_empty_and_oversized_sql_and_broken_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let history = store(&dir).await;
        assert!(history.record(new("p1", "  ")).await.unwrap().is_none());
        let huge = "x".repeat(MAX_SQL_BYTES + 1);
        assert!(history.record(new("p1", &huge)).await.unwrap().is_none());
        history.record(new("p1", "SELECT 1")).await.unwrap();

        let mut text = tokio::fs::read_to_string(&path).await.unwrap();
        text.push_str("{\"half\": \n");
        tokio::fs::write(&path, text).await.unwrap();
        assert_eq!(store(&dir).await.list(None, None, None).await.len(), 1);
    }

    fn line(index: usize) -> String {
        let entry = HistoryEntry {
            id: index.to_string(),
            profile_id: "p".into(),
            database: None,
            sql: format!("SELECT {index}"),
            executed_at: index as i64,
            duration_ms: 1,
            statements: 1,
            rows: None,
            affected: None,
            status: HistoryStatus::Success,
            error: None,
            runs: 1,
        };
        format!(
            "{}
",
            serde_json::to_string(&Line::Entry(entry)).unwrap()
        )
    }

    #[tokio::test]
    async fn keeps_only_the_newest_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let text: String = (0..MAX_ENTRIES + 50).map(line).collect();
        tokio::fs::write(&path, text).await.unwrap();

        let entries = HistoryStore::load(&path)
            .await
            .unwrap()
            .list(None, None, Some(MAX_ENTRIES))
            .await;
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries[0].sql, format!("SELECT {}", MAX_ENTRIES + 49));
        assert_eq!(entries[MAX_ENTRIES - 1].sql, "SELECT 50");
    }

    #[tokio::test]
    async fn compacts_files_with_many_obsolete_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let mut text: String = (0..10).map(line).collect();
        for index in 0..200 {
            text.push_str(&format!(
                "{{\"deleted\":\"gone-{index}\"}}
"
            ));
        }
        tokio::fs::write(&path, text).await.unwrap();

        let history = HistoryStore::load(&path).await.unwrap();
        assert_eq!(history.list(None, None, None).await.len(), 10);
        let lines = tokio::fs::read_to_string(&path)
            .await
            .unwrap()
            .lines()
            .count();
        assert_eq!(lines, 10);
    }
}
