use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::driver::Row;
use crate::sql::Dialect;

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
}

const MYSQL_VARIABLES: &str = "SHOW GLOBAL VARIABLES";

const MYSQL_STATUS: &str = "SHOW GLOBAL STATUS";

const PG_VARIABLES: &str = "SELECT name, COALESCE(current_setting(name, true), setting), category, short_desc, source NOT IN ('default', 'override', 'client', 'session') FROM pg_settings ORDER BY name";

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

pub(crate) fn parse_server_info(rows: Vec<Row>) -> Vec<ServerSetting> {
    rows.iter()
        .filter_map(|row| {
            Some(ServerSetting {
                name: cell(row, 0)?,
                value: cell(row, 1).unwrap_or_default(),
                category: cell(row, 2),
                description: cell(row, 3),
                changed: matches!(cell(row, 4).as_deref(), Some("t" | "1" | "true")),
            })
        })
        .collect()
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
        let parsed = parse_server_info(vec![
            row(&[Some("max_connections"), Some("151")]),
            row(&[Some("init_connect"), Some("")]),
            row(&[None, Some("x")]),
        ]);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "max_connections");
        assert_eq!(parsed[0].value, "151");
        assert_eq!(parsed[0].category, None);
        assert!(!parsed[0].changed);
        assert_eq!(parsed[1].value, "");
    }

    #[test]
    fn postgres_rows_carry_category_description_and_source() {
        let parsed = parse_server_info(vec![
            row(&[
                Some("shared_buffers"),
                Some("128MB"),
                Some("Resource Usage / Memory"),
                Some("Sets the number of shared memory buffers used by the server."),
                Some("t"),
            ]),
            row(&[Some("work_mem"), Some("4MB"), None, None, Some("f")]),
        ]);
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
}
