use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use ts_rs::TS;

use crate::fsutil::{read_json_or_default, write_json_atomic};
use crate::{CoreError, CoreResult};

pub const ZOOM_RANGE: std::ops::RangeInclusive<u16> = 70..=150;
pub const EDITOR_FONT_RANGE: std::ops::RangeInclusive<u8> = 10..=24;
pub const ROW_LIMIT_RANGE: std::ops::RangeInclusive<u32> = 1..=1_000_000;
const MAX_SHORTCUTS: usize = 64;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Theme {
    #[default]
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Accent {
    #[default]
    Violet,
    Blue,
    Teal,
    Green,
    Amber,
    Rose,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Language {
    #[default]
    System,
    De,
    En,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum GridDensity {
    Compact,
    #[default]
    Normal,
    Comfortable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export)]
pub struct Settings {
    pub theme: Theme,
    pub accent: Accent,
    pub language: Language,
    pub zoom: u16,
    pub editor_font_size: u8,
    pub editor_word_wrap: bool,
    pub grid_density: GridDensity,
    pub default_row_limit: u32,
    pub history_enabled: bool,
    pub shortcuts: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            accent: Accent::default(),
            language: Language::default(),
            zoom: 100,
            editor_font_size: 13,
            editor_word_wrap: false,
            grid_density: GridDensity::default(),
            default_row_limit: 1_000,
            history_enabled: true,
            shortcuts: BTreeMap::new(),
        }
    }
}

impl Settings {
    pub fn validate(&self) -> CoreResult<()> {
        if !ZOOM_RANGE.contains(&self.zoom) {
            return Err(CoreError::InvalidInput(format!(
                "zoom must be between {} and {} percent",
                ZOOM_RANGE.start(),
                ZOOM_RANGE.end()
            )));
        }
        if !EDITOR_FONT_RANGE.contains(&self.editor_font_size) {
            return Err(CoreError::InvalidInput(format!(
                "editor font size must be between {} and {} pixels",
                EDITOR_FONT_RANGE.start(),
                EDITOR_FONT_RANGE.end()
            )));
        }
        if !ROW_LIMIT_RANGE.contains(&self.default_row_limit) {
            return Err(CoreError::InvalidInput(format!(
                "row limit must be between {} and {}",
                ROW_LIMIT_RANGE.start(),
                ROW_LIMIT_RANGE.end()
            )));
        }
        if self.shortcuts.len() > MAX_SHORTCUTS
            || self.shortcuts.iter().any(|(action, keys)| {
                action.is_empty() || action.len() > 40 || keys.is_empty() || keys.len() > 40
            })
        {
            return Err(CoreError::InvalidInput(
                "a shortcut needs an action and keys of at most 40 characters".into(),
            ));
        }
        Ok(())
    }

    fn sanitized(mut self) -> Self {
        let defaults = Self::default();
        if !ZOOM_RANGE.contains(&self.zoom) {
            self.zoom = defaults.zoom;
        }
        if !EDITOR_FONT_RANGE.contains(&self.editor_font_size) {
            self.editor_font_size = defaults.editor_font_size;
        }
        if !ROW_LIMIT_RANGE.contains(&self.default_row_limit) {
            self.default_row_limit = defaults.default_row_limit;
        }
        self.shortcuts.retain(|action, keys| {
            !action.is_empty() && action.len() <= 40 && !keys.is_empty() && keys.len() <= 40
        });
        if self.shortcuts.len() > MAX_SHORTCUTS {
            self.shortcuts.clear();
        }
        self
    }
}

pub struct SettingsStore {
    path: PathBuf,
    current: RwLock<Settings>,
}

impl SettingsStore {
    pub async fn load(path: impl Into<PathBuf>) -> CoreResult<Self> {
        let path = path.into();
        let current = read_json_or_default::<Settings>(&path).await?.sanitized();
        Ok(Self {
            path,
            current: RwLock::new(current),
        })
    }

    pub async fn get(&self) -> Settings {
        self.current.read().await.clone()
    }

    pub async fn replace(&self, settings: Settings) -> CoreResult<Settings> {
        settings.validate()?;
        let mut current = self.current.write().await;
        write_json_atomic(&self.path, &settings).await?;
        *current = settings.clone();
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_file_yields_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path().join("settings.json"))
            .await
            .unwrap();
        let settings = store.get().await;
        assert_eq!(settings, Settings::default());
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.zoom, 100);
    }

    #[tokio::test]
    async fn replace_persists_across_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        let store = SettingsStore::load(&path).await.unwrap();
        let changed = Settings {
            theme: Theme::Light,
            accent: Accent::Teal,
            language: Language::En,
            zoom: 125,
            editor_font_size: 15,
            editor_word_wrap: true,
            grid_density: GridDensity::Compact,
            default_row_limit: 10_000,
            history_enabled: false,
            shortcuts: BTreeMap::from([("run".to_string(), "Mod+R".to_string())]),
        };
        store.replace(changed.clone()).await.unwrap();

        let reloaded = SettingsStore::load(&path).await.unwrap();
        assert_eq!(reloaded.get().await, changed);
        assert!(!dir.path().join("nested").join("settings.json.tmp").exists());
    }

    #[tokio::test]
    async fn older_files_keep_their_values_and_gain_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        tokio::fs::write(&path, br#"{"theme": "light", "legacy": 1}"#)
            .await
            .unwrap();
        let settings = SettingsStore::load(&path).await.unwrap().get().await;
        assert_eq!(settings.theme, Theme::Light);
        assert_eq!(settings.accent, Accent::Violet);
        assert_eq!(settings.default_row_limit, 1_000);
        assert!(settings.history_enabled);
    }

    #[tokio::test]
    async fn out_of_range_values_are_rejected_on_save_and_repaired_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = SettingsStore::load(&path).await.unwrap();
        let too_big = Settings {
            zoom: 400,
            ..Settings::default()
        };
        assert_eq!(
            store.replace(too_big).await.unwrap_err().kind(),
            "invalid_input"
        );
        assert_eq!(store.get().await.zoom, 100);

        tokio::fs::write(&path, br#"{"zoom": 5, "editorFontSize": 99}"#)
            .await
            .unwrap();
        let repaired = SettingsStore::load(&path).await.unwrap().get().await;
        assert_eq!(repaired.zoom, 100);
        assert_eq!(repaired.editor_font_size, 13);
    }

    #[tokio::test]
    async fn corrupt_file_reports_json_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        tokio::fs::write(&path, b"{not json").await.unwrap();
        let err = SettingsStore::load(&path).await.err().unwrap();
        assert_eq!(err.kind(), "json");
    }
}
