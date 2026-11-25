use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Dialect, split_statements};
use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SortSpec {
    pub column: String,
    pub descending: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TableQuery {
    pub filter: Option<String>,
    pub sort: Option<SortSpec>,
    pub limit: u32,
}

pub fn select_statement(dialect: Dialect, table: &str, query: &TableQuery) -> CoreResult<String> {
    if query.limit == 0 {
        return Err(CoreError::InvalidInput("row limit must be positive".into()));
    }
    let mut sql = format!("SELECT * FROM {table}");
    if let Some(filter) = query
        .filter
        .as_deref()
        .map(str::trim)
        .filter(|filter| !filter.is_empty())
    {
        sql.push_str(&format!("\nWHERE (\n{filter}\n)"));
    }
    if let Some(sort) = &query.sort {
        if sort.column.is_empty() {
            return Err(CoreError::InvalidInput(
                "sort column must not be empty".into(),
            ));
        }
        let direction = if sort.descending { "DESC" } else { "ASC" };
        sql.push_str(&format!(
            "\nORDER BY {} {direction}",
            dialect.quote_ident(&sort.column)
        ));
    }
    sql.push_str(&format!("\nLIMIT {}", query.limit));

    let statements = split_statements(&sql, dialect);
    if statements.len() != 1 || statements[0].writes {
        return Err(CoreError::InvalidInput(
            "the filter must be a single condition without further statements".into(),
        ));
    }
    Ok(sql)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(filter: Option<&str>) -> TableQuery {
        TableQuery {
            filter: filter.map(str::to_string),
            sort: Some(SortSpec {
                column: "created".into(),
                descending: true,
            }),
            limit: 1000,
        }
    }

    #[test]
    fn builds_filtered_sorted_query_with_filter_on_own_lines() {
        assert_eq!(
            select_statement(
                Dialect::MYSQL,
                "`shop`.`orders`",
                &query(Some("total > 5 -- big"))
            )
            .unwrap(),
            "SELECT * FROM `shop`.`orders`\nWHERE (\ntotal > 5 -- big\n)\nORDER BY `created` DESC\nLIMIT 1000"
        );
    }

    #[test]
    fn rejects_filters_that_inject_statements() {
        let err = select_statement(
            Dialect::POSTGRES,
            "\"t\"",
            &query(Some("1=1); DROP TABLE t; SELECT (1")),
        )
        .unwrap_err();
        assert_eq!(err.kind(), "invalid_input");
    }

    #[test]
    fn omits_blank_filter() {
        let sql = select_statement(Dialect::POSTGRES, "\"t\"", &query(Some("   "))).unwrap();
        assert!(!sql.contains("WHERE"));
    }
}
