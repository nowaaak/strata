use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::driver::Row;
use crate::sql::{Dialect, identifier_name};
use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RoutineKind {
    Function,
    Procedure,
    Trigger,
    Event,
    Sequence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Routine {
    pub kind: RoutineKind,
    pub name: String,
    pub arguments: Option<String>,
    pub table: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RoutineTarget {
    pub database: String,
    pub schema: Option<String>,
    pub routine: Routine,
}

pub(crate) fn mysql_routines_sql(dialect: Dialect, database: &str) -> String {
    let db = dialect.quote_literal(database);
    format!(
        "SELECT 'routine', ROUTINE_TYPE, ROUTINE_NAME, NULL, DTD_IDENTIFIER FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = {db} \
         UNION ALL SELECT 'trigger', 'TRIGGER', TRIGGER_NAME, EVENT_OBJECT_TABLE, CONCAT(ACTION_TIMING, ' ', EVENT_MANIPULATION) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = {db} \
         UNION ALL SELECT 'event', 'EVENT', EVENT_NAME, NULL, STATUS FROM information_schema.EVENTS WHERE EVENT_SCHEMA = {db} \
         ORDER BY 2, 3"
    )
}

pub(crate) fn pg_routines_sql(dialect: Dialect, schema: &str) -> String {
    let schema = dialect.quote_literal(schema);
    format!(
        "SELECT 'routine', CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = {schema} AND p.prokind IN ('f', 'p') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e') \
         UNION ALL SELECT 'trigger', 'TRIGGER', t.tgname, c.relname, NULL FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = {schema} AND NOT t.tgisinternal \
         UNION ALL SELECT 'sequence', 'SEQUENCE', c.relname, NULL, NULL FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = {schema} AND c.relkind = 'S' \
         ORDER BY 2, 3, 4"
    )
}

fn cell(row: &Row, index: usize) -> Option<String> {
    row.get(index)
        .cloned()
        .flatten()
        .filter(|value| !value.is_empty())
}

pub(crate) fn parse_routines(dialect: Dialect, rows: Vec<Row>) -> Vec<Routine> {
    rows.iter()
        .filter_map(|row| {
            let kind = match cell(row, 1)?.as_str() {
                "FUNCTION" => RoutineKind::Function,
                "PROCEDURE" => RoutineKind::Procedure,
                "TRIGGER" => RoutineKind::Trigger,
                "EVENT" => RoutineKind::Event,
                "SEQUENCE" => RoutineKind::Sequence,
                _ => return None,
            };
            let name = cell(row, 2)?;
            let third = cell(row, 3);
            let (arguments, table) = match kind {
                RoutineKind::Trigger => (None, third),
                RoutineKind::Function | RoutineKind::Procedure if !dialect.is_mysql() => (
                    Some(row.get(3).cloned().flatten().unwrap_or_default()),
                    None,
                ),
                _ => (None, None),
            };
            Some(Routine {
                kind,
                name,
                arguments,
                table,
                detail: cell(row, 4),
            })
        })
        .collect()
}

fn fragment(value: &str) -> CoreResult<&str> {
    if ["--", "/*", "*/", ";"]
        .iter()
        .any(|token| value.contains(token))
    {
        return Err(CoreError::InvalidInput(
            "the routine arguments contain characters that are not allowed".into(),
        ));
    }
    Ok(value)
}

fn pg_schema(target: &RoutineTarget) -> &str {
    target.schema.as_deref().unwrap_or("public")
}

fn pg_signature(dialect: Dialect, target: &RoutineTarget) -> CoreResult<String> {
    let routine = &target.routine;
    let arguments = fragment(routine.arguments.as_deref().unwrap_or_default())?;
    Ok(format!(
        "{}({arguments})",
        dialect.qualified(&[pg_schema(target), identifier_name(&routine.name)?])
    ))
}

fn trigger_table(target: &RoutineTarget) -> CoreResult<&str> {
    target
        .routine
        .table
        .as_deref()
        .ok_or_else(|| CoreError::InvalidInput("a trigger needs its table".into()))
}

pub(crate) enum DdlQuery {
    Show { sql: String, column: usize },
    Value(String),
    Sequence(String),
}

pub(crate) fn ddl_query(dialect: Dialect, target: &RoutineTarget) -> CoreResult<DdlQuery> {
    let routine = &target.routine;
    let name = identifier_name(&routine.name)?;
    Ok(match dialect {
        Dialect::MySql { .. } => {
            let qualified = dialect.qualified(&[&target.database, name]);
            let (word, column) = match routine.kind {
                RoutineKind::Function => ("FUNCTION", 2),
                RoutineKind::Procedure => ("PROCEDURE", 2),
                RoutineKind::Trigger => ("TRIGGER", 2),
                RoutineKind::Event => ("EVENT", 3),
                RoutineKind::Sequence => {
                    return Err(CoreError::InvalidInput(
                        "MySQL and MariaDB sequences are not listed".into(),
                    ));
                }
            };
            DdlQuery::Show {
                sql: format!("SHOW CREATE {word} {qualified}"),
                column,
            }
        }
        Dialect::Postgres { .. } => match routine.kind {
            RoutineKind::Function | RoutineKind::Procedure => DdlQuery::Value(format!(
                "SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = {} AND p.proname = {} AND pg_get_function_identity_arguments(p.oid) = {}",
                dialect.quote_literal(pg_schema(target)),
                dialect.quote_literal(name),
                dialect.quote_literal(routine.arguments.as_deref().unwrap_or_default())
            )),
            RoutineKind::Trigger => DdlQuery::Value(format!(
                "SELECT pg_get_triggerdef(t.oid, true) || ';' FROM pg_trigger t WHERE t.tgname = {} AND t.tgrelid = {}::regclass",
                dialect.quote_literal(name),
                dialect.quote_literal(
                    &dialect.qualified(&[pg_schema(target), trigger_table(target)?])
                )
            )),
            RoutineKind::Sequence => DdlQuery::Sequence(format!(
                "SELECT data_type::text, start_value, increment_by, min_value, max_value, cache_size, cycle FROM pg_sequences WHERE schemaname = {} AND sequencename = {}",
                dialect.quote_literal(pg_schema(target)),
                dialect.quote_literal(name)
            )),
            RoutineKind::Event => {
                return Err(CoreError::InvalidInput("PostgreSQL has no events".into()));
            }
        },
    })
}

pub(crate) fn sequence_ddl(dialect: Dialect, target: &RoutineTarget, row: &Row) -> String {
    let value = |index: usize| row.get(index).cloned().flatten().unwrap_or_default();
    let cycle = if value(6) == "t" { "CYCLE" } else { "NO CYCLE" };
    format!(
        "CREATE SEQUENCE {}\n    AS {}\n    START WITH {}\n    INCREMENT BY {}\n    MINVALUE {}\n    MAXVALUE {}\n    CACHE {}\n    {cycle};",
        dialect.qualified(&[pg_schema(target), &target.routine.name]),
        value(0),
        value(1),
        value(2),
        value(3),
        value(4),
        value(5),
    )
}

pub(crate) fn drop_statement(dialect: Dialect, target: &RoutineTarget) -> CoreResult<String> {
    let routine = &target.routine;
    let name = identifier_name(&routine.name)?;
    let word = match routine.kind {
        RoutineKind::Function => "FUNCTION",
        RoutineKind::Procedure => "PROCEDURE",
        RoutineKind::Trigger => "TRIGGER",
        RoutineKind::Event => "EVENT",
        RoutineKind::Sequence => "SEQUENCE",
    };
    Ok(match dialect {
        Dialect::MySql { .. } => {
            if routine.kind == RoutineKind::Sequence {
                return Err(CoreError::InvalidInput(
                    "MySQL and MariaDB sequences are not listed".into(),
                ));
            }
            format!(
                "DROP {word} {}",
                dialect.qualified(&[&target.database, name])
            )
        }
        Dialect::Postgres { .. } => match routine.kind {
            RoutineKind::Function | RoutineKind::Procedure => {
                format!("DROP {word} {}", pg_signature(dialect, target)?)
            }
            RoutineKind::Trigger => format!(
                "DROP TRIGGER {} ON {}",
                dialect.quote_ident(name),
                dialect.qualified(&[pg_schema(target), trigger_table(target)?])
            ),
            RoutineKind::Sequence => format!(
                "DROP SEQUENCE {}",
                dialect.qualified(&[pg_schema(target), name])
            ),
            RoutineKind::Event => {
                return Err(CoreError::InvalidInput("PostgreSQL has no events".into()));
            }
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(
        kind: RoutineKind,
        name: &str,
        arguments: Option<&str>,
        table: Option<&str>,
    ) -> RoutineTarget {
        RoutineTarget {
            database: "shop".into(),
            schema: Some("public".into()),
            routine: Routine {
                kind,
                name: name.into(),
                arguments: arguments.map(str::to_string),
                table: table.map(str::to_string),
                detail: None,
            },
        }
    }

    #[test]
    fn drop_statements_per_dialect() {
        assert_eq!(
            drop_statement(
                Dialect::MYSQL,
                &target(RoutineKind::Procedure, "p`x", None, None)
            )
            .unwrap(),
            "DROP PROCEDURE `shop`.`p``x`"
        );
        assert_eq!(
            drop_statement(
                Dialect::MYSQL,
                &target(RoutineKind::Event, "nightly", None, None)
            )
            .unwrap(),
            "DROP EVENT `shop`.`nightly`"
        );
        assert_eq!(
            drop_statement(
                Dialect::POSTGRES,
                &target(
                    RoutineKind::Function,
                    "add",
                    Some("a integer, b integer"),
                    None
                )
            )
            .unwrap(),
            "DROP FUNCTION \"public\".\"add\"(a integer, b integer)"
        );
        assert_eq!(
            drop_statement(
                Dialect::POSTGRES,
                &target(RoutineKind::Trigger, "audit", None, Some("orders"))
            )
            .unwrap(),
            "DROP TRIGGER \"audit\" ON \"public\".\"orders\""
        );
        assert_eq!(
            drop_statement(
                Dialect::POSTGRES,
                &target(RoutineKind::Sequence, "ids", None, None)
            )
            .unwrap(),
            "DROP SEQUENCE \"public\".\"ids\""
        );
    }

    #[test]
    fn rejects_unsafe_arguments_and_missing_trigger_tables() {
        let bad = target(
            RoutineKind::Function,
            "f",
            Some("x int); DROP TABLE t; --"),
            None,
        );
        assert_eq!(
            drop_statement(Dialect::POSTGRES, &bad).unwrap_err().kind(),
            "invalid_input"
        );
        let orphan = target(RoutineKind::Trigger, "t", None, None);
        assert_eq!(
            drop_statement(Dialect::POSTGRES, &orphan)
                .unwrap_err()
                .kind(),
            "invalid_input"
        );
    }

    #[test]
    fn parses_mixed_rows() {
        let row = |values: &[Option<&str>]| -> Row {
            values
                .iter()
                .map(|value| value.map(str::to_string))
                .collect()
        };
        let routines = parse_routines(
            Dialect::POSTGRES,
            vec![
                row(&[
                    Some("routine"),
                    Some("FUNCTION"),
                    Some("add"),
                    Some(""),
                    Some("integer"),
                ]),
                row(&[
                    Some("trigger"),
                    Some("TRIGGER"),
                    Some("audit"),
                    Some("orders"),
                    None,
                ]),
                row(&[Some("x"), Some("UNKNOWN"), Some("y"), None, None]),
            ],
        );
        assert_eq!(routines.len(), 2);
        assert_eq!(routines[0].arguments.as_deref(), Some(""));
        assert_eq!(routines[1].table.as_deref(), Some("orders"));
    }
}
