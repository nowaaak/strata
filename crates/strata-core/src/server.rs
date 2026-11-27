use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::driver::Row;
use crate::sql::Dialect;
use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ServerInfoKind {
    Variables,
    Status,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServerSetting {
    pub name: String,
    pub value: String,
    pub category: Option<String>,
    pub description: Option<String>,
    pub changed: bool,
    pub editable: bool,
    pub restart: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct VariableChange {
    pub name: String,
    pub value: Option<String>,
    pub persist: bool,
}

const MYSQL_VARIABLES: &str = "SHOW GLOBAL VARIABLES";

const MYSQL_STATUS: &str = "SHOW GLOBAL STATUS";

const PG_VARIABLES: &str = "SELECT name, COALESCE(current_setting(name, true), setting), category, short_desc, source NOT IN ('default', 'override', 'client', 'session'), context <> 'internal', context = 'postmaster' FROM pg_settings ORDER BY name";

const PG_STATUS: &str = "SELECT key, value, category FROM (\
    SELECT 1 AS sort, 'version' AS key, version() AS value, 'Server' AS category \
    UNION ALL SELECT 2, 'server_start', pg_postmaster_start_time()::text, 'Server' \
    UNION ALL SELECT 3, 'uptime', date_trunc('second', now() - pg_postmaster_start_time())::text, 'Server' \
    UNION ALL SELECT 4, 'connections', count(*)::text, 'Server' FROM pg_stat_activity WHERE backend_type = 'client backend' \
    UNION ALL SELECT 5, 'active_connections', count(*)::text, 'Server' FROM pg_stat_activity WHERE backend_type = 'client backend' AND state = 'active' \
    UNION ALL SELECT 6, 'max_connections', current_setting('max_connections'), 'Server' \
    UNION ALL SELECT 7, 'database', current_database(), 'Database' \
    UNION ALL SELECT 8, 'database_size', pg_size_pretty(pg_database_size(current_database())), 'Database' \
    UNION ALL SELECT 9, 'cache_hit_ratio', CASE WHEN blks_hit + blks_read = 0 THEN NULL ELSE round(100.0 * blks_hit / (blks_hit + blks_read), 2)::text || ' %' END, 'Database' FROM pg_stat_database WHERE datname = current_database() \
    UNION ALL SELECT 10 + ordinality, key, value, 'Database' FROM pg_stat_database d, LATERAL unnest(\
        ARRAY['numbackends', 'xact_commit', 'xact_rollback', 'blks_read', 'blks_hit', 'tup_returned', 'tup_fetched', 'tup_inserted', 'tup_updated', 'tup_deleted', 'conflicts', 'temp_files', 'temp_bytes', 'deadlocks', 'stats_reset'], \
        ARRAY[d.numbackends::text, d.xact_commit::text, d.xact_rollback::text, d.blks_read::text, d.blks_hit::text, d.tup_returned::text, d.tup_fetched::text, d.tup_inserted::text, d.tup_updated::text, d.tup_deleted::text, d.conflicts::text, d.temp_files::text, d.temp_bytes::text, d.deadlocks::text, d.stats_reset::text]\
    ) WITH ORDINALITY AS u(key, value, ordinality) WHERE d.datname = current_database()\
) s ORDER BY sort";

const SQLITE_PRAGMAS: &[&str] = &[
    "application_id",
    "auto_vacuum",
    "automatic_index",
    "busy_timeout",
    "cache_size",
    "cache_spill",
    "cell_size_check",
    "checkpoint_fullfsync",
    "defer_foreign_keys",
    "encoding",
    "foreign_keys",
    "fullfsync",
    "ignore_check_constraints",
    "journal_mode",
    "journal_size_limit",
    "locking_mode",
    "max_page_count",
    "page_size",
    "query_only",
    "read_uncommitted",
    "recursive_triggers",
    "reverse_unordered_selects",
    "secure_delete",
    "synchronous",
    "temp_store",
    "trusted_schema",
    "user_version",
];

const SQLITE_STATUS: &str = "SELECT 'version', sqlite_version(), 'Library' \
    UNION ALL SELECT 'file', file, 'Database' FROM pragma_database_list WHERE name = 'main' \
    UNION ALL SELECT 'size_bytes', (SELECT page_count FROM pragma_page_count) * (SELECT page_size FROM pragma_page_size), 'Database' \
    UNION ALL SELECT 'page_count', page_count, 'Database' FROM pragma_page_count \
    UNION ALL SELECT 'freelist_count', freelist_count, 'Database' FROM pragma_freelist_count \
    UNION ALL SELECT 'tables', count(*), 'Database' FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite!_%' ESCAPE '!' \
    UNION ALL SELECT 'views', count(*), 'Database' FROM sqlite_master WHERE type = 'view' \
    UNION ALL SELECT 'indexes', count(*), 'Database' FROM sqlite_master WHERE type = 'index' \
    UNION ALL SELECT 'triggers', count(*), 'Database' FROM sqlite_master WHERE type = 'trigger' \
    UNION ALL SELECT 'data_version', data_version, 'Database' FROM pragma_data_version";

fn sqlite_variables_sql() -> String {
    SQLITE_PRAGMAS
        .iter()
        .map(|name| format!("SELECT '{name}', (SELECT * FROM pragma_{name}), 'PRAGMA'"))
        .collect::<Vec<_>>()
        .join(" UNION ALL ")
}

pub(crate) fn server_info_sql(dialect: Dialect, kind: ServerInfoKind) -> String {
    if dialect.is_sqlite() {
        return match kind {
            ServerInfoKind::Variables => sqlite_variables_sql(),
            ServerInfoKind::Status => SQLITE_STATUS.to_string(),
        };
    }
    server_info_static(dialect, kind).to_string()
}

fn server_info_static(dialect: Dialect, kind: ServerInfoKind) -> &'static str {
    match (dialect, kind) {
        (Dialect::MySql { .. }, ServerInfoKind::Variables) => MYSQL_VARIABLES,
        (Dialect::MySql { .. }, ServerInfoKind::Status) => MYSQL_STATUS,
        (Dialect::Postgres { .. } | Dialect::Sqlite, ServerInfoKind::Variables) => PG_VARIABLES,
        (Dialect::Postgres { .. } | Dialect::Sqlite, ServerInfoKind::Status) => PG_STATUS,
    }
}

fn cell(row: &Row, index: usize) -> Option<String> {
    row.get(index)
        .cloned()
        .flatten()
        .filter(|value| !value.is_empty())
}

fn truthy(value: Option<String>) -> bool {
    matches!(value.as_deref(), Some("t" | "1" | "true"))
}

pub(crate) fn parse_server_info(rows: Vec<Row>, editable: bool) -> Vec<ServerSetting> {
    rows.iter()
        .filter_map(|row| {
            Some(ServerSetting {
                name: cell(row, 0)?,
                value: cell(row, 1).unwrap_or_default(),
                category: cell(row, 2),
                description: cell(row, 3),
                changed: truthy(cell(row, 4)),
                editable: if row.len() > 5 {
                    truthy(cell(row, 5))
                } else {
                    editable
                },
                restart: truthy(cell(row, 6)),
            })
        })
        .collect()
}

fn variable_name(name: &str) -> CoreResult<&str> {
    let name = name.trim();
    let valid = !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
    if !valid {
        return Err(CoreError::InvalidInput(format!(
            "{name:?} is not a variable name"
        )));
    }
    Ok(name)
}

fn is_number(value: &str) -> bool {
    let digits = value.strip_prefix('-').unwrap_or(value);
    !digits.is_empty()
        && digits.chars().filter(|c| *c == '.').count() <= 1
        && digits.chars().all(|c| c.is_ascii_digit() || c == '.')
        && !digits.starts_with('.')
        && !digits.ends_with('.')
}

pub(crate) fn variable_sql(
    dialect: Dialect,
    mariadb: bool,
    change: &VariableChange,
) -> CoreResult<Vec<String>> {
    let name = variable_name(&change.name)?;
    match dialect {
        Dialect::MySql { .. } => {
            if change.persist && mariadb {
                return Err(CoreError::InvalidInput(
                    "MariaDB has no SET PERSIST, change the server configuration file instead"
                        .into(),
                ));
            }
            let scope = if change.persist { "PERSIST" } else { "GLOBAL" };
            let value = match change.value.as_deref().map(str::trim) {
                None => "DEFAULT".to_string(),
                Some(value) if is_number(value) => value.to_string(),
                Some(value) => dialect.quote_literal(value),
            };
            Ok(vec![format!("SET {scope} {name} = {value}")])
        }
        Dialect::Postgres { .. } => {
            let quoted = dialect.quote_ident(name);
            let statement = match change.value.as_deref() {
                None => format!("ALTER SYSTEM RESET {quoted}"),
                Some(value) => format!(
                    "ALTER SYSTEM SET {quoted} = {}",
                    dialect.quote_literal(value.trim())
                ),
            };
            Ok(vec![statement, "SELECT pg_reload_conf()".to_string()])
        }
        Dialect::Sqlite => Err(CoreError::InvalidInput(
            "SQLite pragmas only apply to one connection and are not changed here".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(values: &[Option<&str>]) -> Row {
        values
            .iter()
            .map(|value| value.map(str::to_string))
            .collect()
    }

    #[test]
    fn mysql_rows_have_name_and_value_only() {
        let parsed = parse_server_info(
            vec![
                row(&[Some("max_connections"), Some("151")]),
                row(&[Some("init_connect"), Some("")]),
                row(&[None, Some("x")]),
            ],
            true,
        );
        assert!(parsed[0].editable && !parsed[0].restart);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "max_connections");
        assert_eq!(parsed[0].value, "151");
        assert_eq!(parsed[0].category, None);
        assert!(!parsed[0].changed);
        assert_eq!(parsed[1].value, "");
    }

    #[test]
    fn postgres_rows_carry_category_description_and_source() {
        let parsed = parse_server_info(
            vec![
                row(&[
                    Some("shared_buffers"),
                    Some("128MB"),
                    Some("Resource Usage / Memory"),
                    Some("Sets the number of shared memory buffers used by the server."),
                    Some("t"),
                    Some("t"),
                    Some("t"),
                ]),
                row(&[
                    Some("work_mem"),
                    Some("4MB"),
                    None,
                    None,
                    Some("f"),
                    Some("t"),
                    Some("f"),
                ]),
                row(&[
                    Some("block_size"),
                    Some("8192"),
                    None,
                    None,
                    Some("f"),
                    Some("f"),
                    Some("f"),
                ]),
            ],
            false,
        );
        assert!(parsed[0].editable && parsed[0].restart);
        assert!(parsed[1].editable && !parsed[1].restart);
        assert!(!parsed[2].editable);
        assert_eq!(
            parsed[0].category.as_deref(),
            Some("Resource Usage / Memory")
        );
        assert!(parsed[0].changed);
        assert!(!parsed[1].changed);
    }

    #[test]
    fn every_dialect_and_kind_has_a_query() {
        for dialect in [Dialect::MYSQL, Dialect::POSTGRES] {
            for kind in [ServerInfoKind::Variables, ServerInfoKind::Status] {
                assert!(!server_info_sql(dialect, kind).is_empty());
            }
        }
    }

    #[test]
    fn variable_changes_per_dialect() {
        let change = |name: &str, value: Option<&str>, persist: bool| VariableChange {
            name: name.into(),
            value: value.map(str::to_string),
            persist,
        };
        assert_eq!(
            variable_sql(
                Dialect::MYSQL,
                false,
                &change("max_connections", Some(" 200 "), false)
            )
            .unwrap(),
            ["SET GLOBAL max_connections = 200"]
        );
        assert_eq!(
            variable_sql(
                Dialect::MYSQL,
                false,
                &change("sql_mode", Some("ANSI_QUOTES"), true)
            )
            .unwrap(),
            ["SET PERSIST sql_mode = 'ANSI_QUOTES'"]
        );
        assert_eq!(
            variable_sql(
                Dialect::MYSQL,
                true,
                &change("max_connections", None, false)
            )
            .unwrap(),
            ["SET GLOBAL max_connections = DEFAULT"]
        );
        assert!(variable_sql(Dialect::MYSQL, true, &change("x", Some("1"), true)).is_err());
        assert_eq!(
            variable_sql(
                Dialect::POSTGRES,
                false,
                &change("work_mem", Some("8MB"), false)
            )
            .unwrap(),
            [
                "ALTER SYSTEM SET \"work_mem\" = '8MB'",
                "SELECT pg_reload_conf()"
            ]
        );
        assert_eq!(
            variable_sql(Dialect::POSTGRES, false, &change("work_mem", None, false)).unwrap(),
            ["ALTER SYSTEM RESET \"work_mem\"", "SELECT pg_reload_conf()"]
        );
        assert!(variable_sql(Dialect::MYSQL, false, &change("x; DROP", Some("1"), false)).is_err());
        assert!(
            variable_sql(
                Dialect::Sqlite,
                false,
                &change("foreign_keys", Some("1"), false)
            )
            .is_err()
        );
        assert!(is_number("-1.5") && !is_number("1.") && !is_number("1e3") && !is_number(""));
    }
}
