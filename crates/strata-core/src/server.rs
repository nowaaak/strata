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

pub(crate) fn server_info_sql(dialect: Dialect, kind: ServerInfoKind) -> &'static str {
    match (dialect, kind) {
        (Dialect::MySql { .. }, ServerInfoKind::Variables) => MYSQL_VARIABLES,
        (Dialect::MySql { .. }, ServerInfoKind::Status) => MYSQL_STATUS,
        (Dialect::Postgres { .. }, ServerInfoKind::Variables) => PG_VARIABLES,
        (Dialect::Postgres { .. }, ServerInfoKind::Status) => PG_STATUS,
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
