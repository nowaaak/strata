use serde::Serialize;
use ts_rs::TS;

use crate::driver::Row;
use crate::sql::Dialect;
use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProcessInfo {
    pub id: String,
    pub user: Option<String>,
    pub client: Option<String>,
    pub database: Option<String>,
    pub state: Option<String>,
    pub seconds: Option<u32>,
    pub query: Option<String>,
    pub active: bool,
    pub own: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum KillMode {
    Query,
    Connection,
}

const MYSQL_PROCESSES: &str = "SELECT ID, USER, HOST, DB, COMMAND, STATE, TIME, INFO, ID = CONNECTION_ID() FROM information_schema.PROCESSLIST ORDER BY TIME DESC, ID";

const PG_PROCESSES: &str = "SELECT pid, usename, COALESCE(client_addr::text, client_hostname), datname, state, wait_event, EXTRACT(EPOCH FROM now() - COALESCE(query_start, backend_start))::bigint, query, pid = pg_backend_pid() FROM pg_stat_activity WHERE backend_type = 'client backend' ORDER BY 7 DESC NULLS LAST, pid";

fn not_for_sqlite() -> CoreError {
    CoreError::InvalidInput("a SQLite file has no server processes".into())
}

pub(crate) fn processes_sql(dialect: Dialect) -> CoreResult<&'static str> {
    match dialect {
        Dialect::MySql { .. } => Ok(MYSQL_PROCESSES),
        Dialect::Postgres { .. } => Ok(PG_PROCESSES),
        Dialect::Sqlite => Err(not_for_sqlite()),
    }
}

fn cell(row: &Row, index: usize) -> Option<String> {
    row.get(index)
        .cloned()
        .flatten()
        .filter(|value| !value.is_empty())
}

fn truthy(value: Option<String>) -> bool {
    matches!(value.as_deref(), Some("1" | "t" | "true"))
}

fn seconds(value: Option<String>) -> Option<u32> {
    value
        .and_then(|value| value.parse::<i64>().ok())
        .map(|value| u32::try_from(value.max(0)).unwrap_or(u32::MAX))
}

fn joined(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(first), Some(second)) => Some(format!("{first}: {second}")),
        (first, second) => first.or(second),
    }
}

pub(crate) fn parse_processes(dialect: Dialect, rows: Vec<Row>) -> Vec<ProcessInfo> {
    rows.iter()
        .filter_map(|row| {
            let id = cell(row, 0)?;
            let (state, active) = match dialect {
                Dialect::MySql { .. } => {
                    let command = cell(row, 4);
                    let active = !matches!(command.as_deref(), Some("Sleep" | "Daemon"));
                    (joined(command, cell(row, 5)), active)
                }
                Dialect::Postgres { .. } | Dialect::Sqlite => {
                    let state = cell(row, 4);
                    let active = !matches!(state.as_deref(), Some("idle") | None);
                    (joined(state, cell(row, 5)), active)
                }
            };
            Some(ProcessInfo {
                id,
                user: cell(row, 1),
                client: cell(row, 2),
                database: cell(row, 3),
                state,
                seconds: seconds(cell(row, 6)),
                query: cell(row, 7),
                active,
                own: truthy(cell(row, 8)),
            })
        })
        .collect()
}

pub(crate) fn kill_sql(dialect: Dialect, id: &str, mode: KillMode) -> CoreResult<String> {
    let id: u64 = id
        .trim()
        .parse()
        .map_err(|_| CoreError::InvalidInput(format!("{id:?} is not a process id")))?;
    Ok(match (dialect, mode) {
        (Dialect::MySql { .. }, KillMode::Query) => format!("KILL QUERY {id}"),
        (Dialect::MySql { .. }, KillMode::Connection) => format!("KILL CONNECTION {id}"),
        (Dialect::Postgres { .. }, KillMode::Query) => format!("SELECT pg_cancel_backend({id})"),
        (Dialect::Postgres { .. }, KillMode::Connection) => {
            format!("SELECT pg_terminate_backend({id})")
        }
        (Dialect::Sqlite, _) => return Err(not_for_sqlite()),
    })
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
    fn kill_statements_only_take_numeric_ids() {
        assert_eq!(
            kill_sql(Dialect::MYSQL, "42", KillMode::Query).unwrap(),
            "KILL QUERY 42"
        );
        assert_eq!(
            kill_sql(Dialect::MYSQL, " 7 ", KillMode::Connection).unwrap(),
            "KILL CONNECTION 7"
        );
        assert_eq!(
            kill_sql(Dialect::POSTGRES, "123", KillMode::Connection).unwrap(),
            "SELECT pg_terminate_backend(123)"
        );
        for bad in ["", "1; DROP TABLE x", "-1", "1.5", "abc"] {
            assert_eq!(
                kill_sql(Dialect::POSTGRES, bad, KillMode::Query)
                    .unwrap_err()
                    .kind(),
                "invalid_input",
                "{bad:?}"
            );
        }
    }

    #[test]
    fn parses_mysql_rows() {
        let processes = parse_processes(
            Dialect::MYSQL,
            vec![
                row(&[
                    Some("12"),
                    Some("root"),
                    Some("172.18.0.1:5000"),
                    Some("shop"),
                    Some("Query"),
                    Some("User sleep"),
                    Some("31"),
                    Some("SELECT SLEEP(60)"),
                    Some("0"),
                ]),
                row(&[
                    Some("13"),
                    Some("root"),
                    None,
                    None,
                    Some("Sleep"),
                    Some(""),
                    Some("2"),
                    None,
                    Some("1"),
                ]),
            ],
        );
        assert_eq!(processes[0].state.as_deref(), Some("Query: User sleep"));
        assert_eq!(processes[0].seconds, Some(31));
        assert!(processes[0].active);
        assert!(!processes[0].own);
        assert_eq!(processes[1].state.as_deref(), Some("Sleep"));
        assert!(!processes[1].active);
        assert!(processes[1].own);
    }

    #[test]
    fn parses_postgres_rows() {
        let processes = parse_processes(
            Dialect::POSTGRES,
            vec![row(&[
                Some("4711"),
                Some("postgres"),
                Some("172.18.0.1/32"),
                Some("strata"),
                Some("idle"),
                Some("ClientRead"),
                Some("-3"),
                Some("SELECT 1"),
                Some("t"),
            ])],
        );
        assert_eq!(processes[0].state.as_deref(), Some("idle: ClientRead"));
        assert_eq!(processes[0].seconds, Some(0));
        assert!(!processes[0].active);
        assert!(processes[0].own);
    }
}
