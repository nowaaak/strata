use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::driver::{ColumnKind, ColumnMeta, Row, RowSink, SinkFlow};
use crate::sql::Dialect;

pub const INSERT_BATCH: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DumpOptions {
    pub database: String,
    pub schema: Option<String>,
    pub tables: Vec<String>,
    pub structure: bool,
    pub data: bool,
    pub drop_existing: bool,
    #[serde(default)]
    pub routines: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DumpSummary {
    pub tables: u32,
    #[ts(type = "number")]
    pub rows: u64,
    pub cancelled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DumpProgress {
    pub table: String,
    pub done: u32,
    pub total: u32,
    #[ts(type = "number")]
    pub rows: u64,
}

pub fn binary_literal(dialect: Dialect, value: &str) -> Option<String> {
    if !dialect.is_mysql() {
        return None;
    }
    let hex = value.strip_prefix("0x")?;
    if hex.is_empty() {
        return Some("X''".into());
    }
    hex.chars()
        .all(|c| c.is_ascii_hexdigit())
        .then(|| value.to_string())
}

pub struct InsertWriter<'a> {
    dialect: Dialect,
    table: String,
    columns: String,
    binary: Vec<bool>,
    out: &'a mut BufWriter<File>,
    pending: Vec<String>,
    pub rows: u64,
    pub failure: Option<std::io::Error>,
    cancel: Arc<AtomicBool>,
    progress: &'a (dyn Fn(u64) + Send + Sync),
}

impl<'a> InsertWriter<'a> {
    pub fn new(
        dialect: Dialect,
        table: String,
        out: &'a mut BufWriter<File>,
        cancel: Arc<AtomicBool>,
        progress: &'a (dyn Fn(u64) + Send + Sync),
    ) -> Self {
        Self {
            dialect,
            table,
            columns: String::new(),
            binary: Vec::new(),
            out,
            pending: Vec::with_capacity(INSERT_BATCH),
            rows: 0,
            failure: None,
            cancel,
            progress,
        }
    }

    fn literal(&self, index: usize, value: Option<&str>) -> String {
        match value {
            None => "NULL".into(),
            Some(value) => {
                if self.binary.get(index).copied().unwrap_or(false)
                    && let Some(binary) = binary_literal(self.dialect, value)
                {
                    return binary;
                }
                self.dialect.quote_literal(value)
            }
        }
    }

    fn flush_batch(&mut self) {
        if self.pending.is_empty() || self.failure.is_some() {
            return;
        }
        let statement = format!(
            "INSERT INTO {} ({}) VALUES\n{};\n",
            self.table,
            self.columns,
            self.pending.join(",\n")
        );
        self.pending.clear();
        if let Err(err) = self.out.write_all(statement.as_bytes()) {
            self.failure = Some(err);
        }
    }

    pub fn finish(mut self) -> (u64, Option<std::io::Error>) {
        self.flush_batch();
        (self.rows, self.failure)
    }
}

impl RowSink for InsertWriter<'_> {
    fn columns(&mut self, columns: &[ColumnMeta]) {
        self.columns = columns
            .iter()
            .map(|column| self.dialect.quote_ident(&column.name))
            .collect::<Vec<_>>()
            .join(", ");
        self.binary = columns
            .iter()
            .map(|column| column.kind == ColumnKind::Binary)
            .collect();
    }

    fn row(&mut self, row: Row) -> SinkFlow {
        if self.cancel.load(Ordering::SeqCst) || self.failure.is_some() {
            return SinkFlow::Stop;
        }
        let values = row
            .iter()
            .enumerate()
            .map(|(index, value)| self.literal(index, value.as_deref()))
            .collect::<Vec<_>>()
            .join(", ");
        self.pending.push(format!("({values})"));
        self.rows += 1;
        if self.pending.len() >= INSERT_BATCH {
            self.flush_batch();
        }
        if self.rows.is_multiple_of(10_000) {
            (self.progress)(self.rows);
        }
        SinkFlow::Continue
    }
}

pub fn serial_sequence(default: &str) -> Option<&str> {
    let start = default.find("nextval('")? + "nextval('".len();
    let rest = &default[start..];
    let end = rest.find("'::regclass")?;
    let name = &rest[..end];
    (!name.is_empty() && !name.contains('\'') && !name.contains(';')).then_some(name)
}

pub fn strip_definer(ddl: &str) -> String {
    let Some(start) = ddl.find("DEFINER=") else {
        return ddl.to_string();
    };
    let rest = &ddl[start + "DEFINER=".len()..];
    let mut end = 0;
    let mut quoted = false;
    for (index, c) in rest.char_indices() {
        match c {
            '`' => quoted = !quoted,
            ' ' if !quoted => {
                end = index;
                break;
            }
            _ => {}
        }
        end = index + c.len_utf8();
    }
    let after = rest[end..].trim_start();
    format!("{}{after}", &ddl[..start])
}

pub fn header(dialect: Dialect, database: &str, server: &str, schema: Option<&str>) -> String {
    let mut out = format!(
        "-- Strata SQL dump\n-- Database: {database}\n-- Server: {server}\n-- Created: {}\n\n",
        chrono_like_now()
    );
    match dialect {
        Dialect::MySql { .. } => {
            out.push_str("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n");
        }
        Dialect::Postgres { .. } => {
            out.push_str(
                "SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\nSET check_function_bodies = false;\n\n",
            );
            if let Some(schema) = schema.filter(|schema| *schema != "public") {
                out.push_str(&format!(
                    "CREATE SCHEMA IF NOT EXISTS {};\n\n",
                    dialect.quote_ident(schema)
                ));
            }
        }
    }
    out
}

fn chrono_like_now() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();
    let days = seconds / 86_400;
    let (year, month, day) = civil_from_days(i64::try_from(days).unwrap_or_default());
    let rest = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02} UTC",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = u32::try_from(doy - (153 * mp + 2) / 5 + 1).unwrap_or(1);
    let month = u32::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).unwrap_or(1);
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

pub struct RoutineDump {
    pub name: String,
    pub drop: Option<String>,
    pub ddl: String,
}

pub fn routine_block(dialect: Dialect, title: &str, routines: &[RoutineDump]) -> String {
    if routines.is_empty() {
        return String::new();
    }
    let mysql = dialect.is_mysql();
    let end = if mysql { ";;" } else { ";" };
    let mut out = format!("\n-- {title}\n");
    if mysql {
        out.push_str("DELIMITER ;;\n");
    }
    for routine in routines {
        out.push_str(&format!("\n-- {}\n", routine.name));
        if let Some(drop) = &routine.drop {
            out.push_str(&format!("{drop}{end}\n"));
        }
        out.push_str(routine.ddl.trim_end().trim_end_matches(';').trim_end());
        out.push_str(end);
        out.push('\n');
    }
    if mysql {
        out.push_str("DELIMITER ;\n");
    }
    out
}

pub fn footer(dialect: Dialect, deferred: &[String]) -> String {
    let mut out = String::new();
    if !deferred.is_empty() {
        out.push('\n');
        for statement in deferred {
            out.push_str(statement);
            out.push('\n');
        }
    }
    if dialect.is_mysql() {
        out.push_str("\nSET FOREIGN_KEY_CHECKS = 1;\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_values_become_hex_literals_on_mysql_only() {
        assert_eq!(
            binary_literal(Dialect::MYSQL, "0x00FF10").as_deref(),
            Some("0x00FF10")
        );
        assert_eq!(binary_literal(Dialect::MYSQL, "0x").as_deref(), Some("X''"));
        assert_eq!(binary_literal(Dialect::MYSQL, "0xZZ"), None);
        assert_eq!(binary_literal(Dialect::POSTGRES, "0x00"), None);
    }

    #[test]
    fn finds_serial_sequences() {
        assert_eq!(
            serial_sequence("nextval('bestellungen_id_seq'::regclass)"),
            Some("bestellungen_id_seq")
        );
        assert_eq!(
            serial_sequence("nextval('\"Archiv\".\"Seq\"'::regclass)"),
            Some("\"Archiv\".\"Seq\"")
        );
        assert_eq!(serial_sequence("now()"), None);
        assert_eq!(serial_sequence("nextval('a''b'::regclass)"), None);
    }

    #[test]
    fn strips_the_view_definer() {
        assert_eq!(
            strip_definer(
                "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v` AS select 1"
            ),
            "CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v` AS select 1"
        );
        assert_eq!(
            strip_definer("CREATE DEFINER=`a b`@`localhost` VIEW `v` AS select 1"),
            "CREATE VIEW `v` AS select 1"
        );
        assert_eq!(
            strip_definer("CREATE TABLE t (a int)"),
            "CREATE TABLE t (a int)"
        );
    }

    #[test]
    fn computes_calendar_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(civil_from_days(20_783), (2026, 11, 26));
    }

    #[test]
    fn header_and_footer_per_dialect() {
        let mysql = header(Dialect::MYSQL, "shop", "MySQL 8.4", None);
        assert!(mysql.contains("SET FOREIGN_KEY_CHECKS = 0;"));
        let pg = header(Dialect::POSTGRES, "shop", "PostgreSQL 17", Some("archiv"));
        assert!(pg.contains("CREATE SCHEMA IF NOT EXISTS \"archiv\";"));
        assert!(!header(Dialect::POSTGRES, "shop", "x", Some("public")).contains("CREATE SCHEMA"));
        assert!(footer(Dialect::MYSQL, &[]).contains("SET FOREIGN_KEY_CHECKS = 1;"));
        assert_eq!(
            footer(
                Dialect::POSTGRES,
                &["ALTER TABLE x ADD CONSTRAINT y FOREIGN KEY (a) REFERENCES z (b);".into()]
            ),
            "\nALTER TABLE x ADD CONSTRAINT y FOREIGN KEY (a) REFERENCES z (b);\n"
        );
    }

    #[test]
    fn mysql_routines_use_a_delimiter_block() {
        let block = routine_block(
            Dialect::MYSQL,
            "Routines",
            &[RoutineDump {
                name: "netto".into(),
                drop: Some("DROP FUNCTION IF EXISTS `netto`".into()),
                ddl: "CREATE FUNCTION `netto`(x DECIMAL(10,2)) RETURNS decimal(10,2)\nBEGIN\n  RETURN x / 1.19;\nEND;".into(),
            }],
        );
        assert_eq!(
            block,
            "\n-- Routines\nDELIMITER ;;\n\n-- netto\nDROP FUNCTION IF EXISTS `netto`;;\nCREATE FUNCTION `netto`(x DECIMAL(10,2)) RETURNS decimal(10,2)\nBEGIN\n  RETURN x / 1.19;\nEND;;\nDELIMITER ;\n"
        );
        assert_eq!(routine_block(Dialect::MYSQL, "Routines", &[]), "");
    }

    #[test]
    fn postgres_routines_end_with_a_semicolon() {
        let block = routine_block(
            Dialect::POSTGRES,
            "Triggers",
            &[RoutineDump {
                name: "stamp".into(),
                drop: None,
                ddl: "CREATE TRIGGER stamp BEFORE UPDATE ON public.t FOR EACH ROW EXECUTE FUNCTION public.touch();".into(),
            }],
        );
        assert_eq!(
            block,
            "\n-- Triggers\n\n-- stamp\nCREATE TRIGGER stamp BEFORE UPDATE ON public.t FOR EACH ROW EXECUTE FUNCTION public.touch();\n"
        );
    }
}
