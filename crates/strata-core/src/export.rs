use std::collections::HashSet;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::driver::{ColumnMeta, Row, RowSink, SinkFlow};
use crate::result::ResultSet;
use crate::schema::TableTarget;
use crate::sql::SortSpec;
use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ExportFormat {
    Csv,
    Json,
}

pub async fn export_result(
    set: Arc<ResultSet>,
    format: ExportFormat,
    path: PathBuf,
) -> CoreResult<u32> {
    tokio::task::spawn_blocking(move || {
        let bytes = set.with_rows(|rows| render(format, set.columns(), rows));
        write_file(&path, &bytes)?;
        Ok(set.len().min(u32::MAX as usize) as u32)
    })
    .await
    .map_err(|err| CoreError::InvalidInput(format!("export task failed: {err}")))?
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ExportSource {
    Query {
        database: Option<String>,
        sql: String,
    },
    Table {
        target: TableTarget,
        filter: Option<String>,
        sort: Option<SortSpec>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportSummary {
    pub rows: u64,
    pub cancelled: bool,
}

pub const PROGRESS_EVERY: u64 = 10_000;

fn temp_path(path: &Path) -> PathBuf {
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    PathBuf::from(temp)
}

pub struct StreamWriter {
    format: ExportFormat,
    path: PathBuf,
    temp: PathBuf,
    out: BufWriter<File>,
    names: Vec<String>,
    rows: u64,
    failure: Option<std::io::Error>,
    cancel: Arc<AtomicBool>,
    progress: Box<dyn Fn(u64) + Send + Sync>,
}

impl StreamWriter {
    pub fn create(
        format: ExportFormat,
        path: PathBuf,
        cancel: Arc<AtomicBool>,
        progress: Box<dyn Fn(u64) + Send + Sync>,
    ) -> CoreResult<Self> {
        let temp = temp_path(&path);
        let file = File::create(&temp).map_err(|err| CoreError::io(&temp, err))?;
        Ok(Self {
            format,
            path,
            temp,
            out: BufWriter::with_capacity(1 << 20, file),
            names: Vec::new(),
            rows: 0,
            failure: None,
            cancel,
            progress,
        })
    }

    fn write(&mut self, bytes: &[u8]) {
        if self.failure.is_none()
            && let Err(err) = self.out.write_all(bytes)
        {
            self.failure = Some(err);
        }
    }

    pub fn finish(mut self) -> CoreResult<ExportSummary> {
        if let Some(err) = self.failure.take() {
            self.discard();
            return Err(CoreError::io(&self.path, err));
        }
        if self.cancel.load(Ordering::SeqCst) {
            self.discard();
            return Ok(ExportSummary {
                rows: self.rows,
                cancelled: true,
            });
        }
        if self.names.is_empty() {
            self.discard();
            return Err(CoreError::InvalidInput(
                "the statement returned no result set to export".into(),
            ));
        }
        let footer: &[u8] = match (self.format, self.rows) {
            (ExportFormat::Csv, _) => b"",
            (ExportFormat::Json, 0) => b"]\n",
            (ExportFormat::Json, _) => b"\n]\n",
        };
        let result = self
            .out
            .write_all(footer)
            .and_then(|()| self.out.flush())
            .and_then(|()| self.out.get_ref().sync_all());
        if let Err(err) = result {
            self.discard();
            return Err(CoreError::io(&self.temp, err));
        }
        let rows = self.rows;
        let Self {
            out, temp, path, ..
        } = self;
        drop(out);
        std::fs::rename(&temp, &path).map_err(|err| CoreError::io(&path, err))?;
        Ok(ExportSummary {
            rows,
            cancelled: false,
        })
    }

    pub fn discard(&mut self) {
        if let Err(err) = std::fs::remove_file(&self.temp) {
            tracing::debug!(error = %err, "temporary export file could not be removed");
        }
    }
}

impl RowSink for StreamWriter {
    fn columns(&mut self, columns: &[ColumnMeta]) {
        if !self.names.is_empty() {
            return;
        }
        self.names = unique_names(columns);
        match self.format {
            ExportFormat::Csv => {
                let header: Vec<String> = columns
                    .iter()
                    .map(|column| csv_field(&column.name))
                    .collect();
                let line = format!("\u{feff}{}\r\n", header.join(","));
                self.write(line.as_bytes());
            }
            ExportFormat::Json => {
                self.names = self
                    .names
                    .iter()
                    .map(|name| serde_json::Value::String(name.clone()).to_string())
                    .collect();
                self.write(b"[");
            }
        }
    }

    fn row(&mut self, row: Row) -> SinkFlow {
        if self.cancel.load(Ordering::SeqCst) || self.failure.is_some() {
            return SinkFlow::Stop;
        }
        let line = match self.format {
            ExportFormat::Csv => {
                let fields: Vec<String> = row
                    .iter()
                    .map(|cell| cell.as_deref().map(csv_field).unwrap_or_default())
                    .collect();
                format!("{}\r\n", fields.join(","))
            }
            ExportFormat::Json => {
                let fields: Vec<String> = self
                    .names
                    .iter()
                    .zip(&row)
                    .map(|(name, cell)| {
                        let value = match cell {
                            Some(value) => serde_json::Value::String(value.clone()),
                            None => serde_json::Value::Null,
                        };
                        format!("{name}: {value}")
                    })
                    .collect();
                let prefix = if self.rows == 0 { "\n  {" } else { ",\n  {" };
                format!("{prefix}{}}}", fields.join(", "))
            }
        };
        self.write(line.as_bytes());
        self.rows += 1;
        if self.rows.is_multiple_of(PROGRESS_EVERY) {
            (self.progress)(self.rows);
        }
        SinkFlow::Continue
    }
}

fn write_file(path: &Path, bytes: &[u8]) -> CoreResult<()> {
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    let temp = PathBuf::from(temp);
    let mut file = std::fs::File::create(&temp).map_err(|err| CoreError::io(&temp, err))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|err| CoreError::io(&temp, err))?;
    drop(file);
    std::fs::rename(&temp, path).map_err(|err| CoreError::io(path, err))
}

fn render(format: ExportFormat, columns: &[ColumnMeta], rows: &[Row]) -> Vec<u8> {
    match format {
        ExportFormat::Csv => render_csv(columns, rows).into_bytes(),
        ExportFormat::Json => render_json(columns, rows).into_bytes(),
    }
}

fn render_csv(columns: &[ColumnMeta], rows: &[Row]) -> String {
    let mut out = String::from("\u{feff}");
    let header: Vec<String> = columns
        .iter()
        .map(|column| csv_field(&column.name))
        .collect();
    out.push_str(&header.join(","));
    out.push_str("\r\n");
    for row in rows {
        let fields: Vec<String> = row
            .iter()
            .map(|cell| cell.as_deref().map(csv_field).unwrap_or_default())
            .collect();
        out.push_str(&fields.join(","));
        out.push_str("\r\n");
    }
    out
}

fn csv_field(value: &str) -> String {
    let needs_quotes = value.is_empty()
        || value.contains([',', '"', '\n', '\r'])
        || value.starts_with(char::is_whitespace)
        || value.ends_with(char::is_whitespace);
    if needs_quotes {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn unique_names(columns: &[ColumnMeta]) -> Vec<String> {
    let mut seen = HashSet::new();
    columns
        .iter()
        .map(|column| {
            let mut name = column.name.clone();
            let mut suffix = 2;
            while !seen.insert(name.clone()) {
                name = format!("{}_{suffix}", column.name);
                suffix += 1;
            }
            name
        })
        .collect()
}

fn render_json(columns: &[ColumnMeta], rows: &[Row]) -> String {
    let names: Vec<String> = unique_names(columns)
        .iter()
        .map(|name| serde_json::Value::String(name.clone()).to_string())
        .collect();
    let mut out = String::from("[");
    for (index, row) in rows.iter().enumerate() {
        out.push_str(if index == 0 { "\n  {" } else { ",\n  {" });
        let fields: Vec<String> = names
            .iter()
            .zip(row)
            .map(|(name, cell)| {
                let value = match cell {
                    Some(value) => serde_json::Value::String(value.clone()),
                    None => serde_json::Value::Null,
                };
                format!("{name}: {value}")
            })
            .collect();
        out.push_str(&fields.join(", "));
        out.push('}');
    }
    out.push_str(if rows.is_empty() { "]\n" } else { "\n]\n" });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::driver::ColumnKind;

    fn columns(names: &[&str]) -> Vec<ColumnMeta> {
        names
            .iter()
            .map(|name| ColumnMeta {
                name: name.to_string(),
                type_name: String::new(),
                kind: ColumnKind::Text,
            })
            .collect()
    }

    fn rows() -> Vec<Row> {
        vec![
            vec![Some("1".into()), Some("a,\"b\"".into())],
            vec![Some("2".into()), None],
            vec![Some("3".into()), Some(String::new())],
        ]
    }

    #[test]
    fn csv_quotes_special_values_and_keeps_null_empty() {
        let csv = render_csv(&columns(&["id", "note"]), &rows());
        assert_eq!(
            csv,
            "\u{feff}id,note\r\n1,\"a,\"\"b\"\"\"\r\n2,\r\n3,\"\"\r\n"
        );
    }

    #[test]
    fn json_keeps_order_nulls_and_disambiguates_names() {
        let json = render_json(&columns(&["id", "id"]), &rows()[..2]);
        assert_eq!(
            json,
            "[\n  {\"id\": \"1\", \"id_2\": \"a,\\\"b\\\"\"},\n  {\"id\": \"2\", \"id_2\": null}\n]\n"
        );
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed[1]["id_2"], serde_json::Value::Null);
        assert_eq!(render_json(&columns(&["id"]), &[]), "[]\n");
    }

    #[tokio::test]
    async fn writes_export_file_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.csv");
        let set = Arc::new(ResultSet::new(columns(&["id", "note"])));
        set.append(&mut rows());
        let count = export_result(set, ExportFormat::Csv, path.clone())
            .await
            .unwrap();
        assert_eq!(count, 3);
        assert!(std::fs::read_to_string(&path).unwrap().contains("id,note"));
        assert!(!dir.path().join("out.csv.tmp").exists());
    }
}
