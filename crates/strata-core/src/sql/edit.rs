use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Dialect;
use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CellValue {
    pub column: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum RowChange {
    Update {
        key: Vec<CellValue>,
        values: Vec<CellValue>,
    },
    Insert {
        values: Vec<CellValue>,
    },
    Delete {
        key: Vec<CellValue>,
    },
}

impl RowChange {
    pub fn key(&self) -> Option<&[CellValue]> {
        match self {
            Self::Update { key, .. } | Self::Delete { key } => Some(key),
            Self::Insert { .. } => None,
        }
    }
}

pub fn change_statement(dialect: Dialect, table: &str, change: &RowChange) -> CoreResult<String> {
    let limit = if dialect.is_mysql() { " LIMIT 1" } else { "" };
    match change {
        RowChange::Update { key, values } => {
            if values.is_empty() {
                return Err(CoreError::InvalidInput(
                    "update without changed values".into(),
                ));
            }
            let assignments = values
                .iter()
                .map(|cell| {
                    Ok(format!(
                        "{} = {}",
                        column(dialect, &cell.column)?,
                        dialect.literal_or_null(cell.value.as_deref())
                    ))
                })
                .collect::<CoreResult<Vec<_>>>()?
                .join(", ");
            Ok(format!(
                "UPDATE {table} SET {assignments} WHERE {}{limit}",
                conditions(dialect, key)?
            ))
        }
        RowChange::Insert { values } => {
            if values.is_empty() {
                return Ok(if dialect.is_mysql() {
                    format!("INSERT INTO {table} () VALUES ()")
                } else {
                    format!("INSERT INTO {table} DEFAULT VALUES")
                });
            }
            let columns = values
                .iter()
                .map(|cell| column(dialect, &cell.column))
                .collect::<CoreResult<Vec<_>>>()?
                .join(", ");
            let literals = values
                .iter()
                .map(|cell| dialect.literal_or_null(cell.value.as_deref()))
                .collect::<Vec<_>>()
                .join(", ");
            Ok(format!(
                "INSERT INTO {table} ({columns}) VALUES ({literals})"
            ))
        }
        RowChange::Delete { key } => Ok(format!(
            "DELETE FROM {table} WHERE {}{limit}",
            conditions(dialect, key)?
        )),
    }
}

fn column(dialect: Dialect, name: &str) -> CoreResult<String> {
    if name.is_empty() {
        return Err(CoreError::InvalidInput(
            "column name must not be empty".into(),
        ));
    }
    Ok(dialect.quote_ident(name))
}

fn conditions(dialect: Dialect, key: &[CellValue]) -> CoreResult<String> {
    if key.is_empty() {
        return Err(CoreError::InvalidInput(
            "row cannot be identified without a key".into(),
        ));
    }
    Ok(key
        .iter()
        .map(|cell| {
            let name = column(dialect, &cell.column)?;
            Ok(match &cell.value {
                Some(value) => format!("{name} = {}", dialect.quote_literal(value)),
                None => format!("{name} IS NULL"),
            })
        })
        .collect::<CoreResult<Vec<_>>>()?
        .join(" AND "))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(column: &str, value: Option<&str>) -> CellValue {
        CellValue {
            column: column.into(),
            value: value.map(str::to_string),
        }
    }

    #[test]
    fn builds_mysql_update_with_limit() {
        let change = RowChange::Update {
            key: vec![cell("id", Some("7"))],
            values: vec![cell("name", Some("O'Brien")), cell("note", None)],
        };
        assert_eq!(
            change_statement(Dialect::MYSQL, "`shop`.`users`", &change).unwrap(),
            "UPDATE `shop`.`users` SET `name` = 'O''Brien', `note` = NULL WHERE `id` = '7' LIMIT 1"
        );
    }

    #[test]
    fn builds_postgres_statements_without_limit() {
        let delete = RowChange::Delete {
            key: vec![cell("a", Some("1")), cell("b", None)],
        };
        assert_eq!(
            change_statement(Dialect::POSTGRES, "\"public\".\"t\"", &delete).unwrap(),
            "DELETE FROM \"public\".\"t\" WHERE \"a\" = '1' AND \"b\" IS NULL"
        );
        let insert = RowChange::Insert {
            values: vec![cell("a", Some("1")), cell("b", None)],
        };
        assert_eq!(
            change_statement(Dialect::POSTGRES, "\"t\"", &insert).unwrap(),
            "INSERT INTO \"t\" (\"a\", \"b\") VALUES ('1', NULL)"
        );
    }

    #[test]
    fn empty_insert_uses_defaults() {
        let insert = RowChange::Insert { values: vec![] };
        assert_eq!(
            change_statement(Dialect::MYSQL, "`t`", &insert).unwrap(),
            "INSERT INTO `t` () VALUES ()"
        );
        assert_eq!(
            change_statement(Dialect::POSTGRES, "\"t\"", &insert).unwrap(),
            "INSERT INTO \"t\" DEFAULT VALUES"
        );
    }

    #[test]
    fn rejects_changes_without_key_or_values() {
        let no_key = RowChange::Delete { key: vec![] };
        assert!(change_statement(Dialect::MYSQL, "`t`", &no_key).is_err());
        let no_values = RowChange::Update {
            key: vec![cell("id", Some("1"))],
            values: vec![],
        };
        assert!(change_statement(Dialect::MYSQL, "`t`", &no_values).is_err());
    }
}
