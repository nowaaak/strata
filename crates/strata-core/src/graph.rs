use serde::Serialize;
use ts_rs::TS;

use crate::driver::Row;
use crate::schema::ObjectKind;
use crate::sql::Dialect;

pub const GRAPH_TABLE_LIMIT: usize = 400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GraphColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GraphTable {
    pub name: String,
    pub kind: ObjectKind,
    pub columns: Vec<GraphColumn>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GraphForeignKey {
    pub name: String,
    pub table: String,
    pub columns: Vec<String>,
    pub target_table: String,
    pub target_columns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SchemaGraph {
    pub tables: Vec<GraphTable>,
    pub foreign_keys: Vec<GraphForeignKey>,
    pub truncated: bool,
}

pub(crate) fn columns_sql(dialect: Dialect, database: &str, schema: &str) -> String {
    match dialect {
        Dialect::MySql { .. } => format!(
            "SELECT c.TABLE_NAME, t.TABLE_TYPE, c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE, CASE WHEN c.COLUMN_KEY = 'PRI' THEN '1' ELSE '0' END FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME WHERE c.TABLE_SCHEMA = {} ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION",
            dialect.quote_literal(database)
        ),
        Dialect::Postgres { .. } => format!(
            "SELECT c.relname, CASE WHEN c.relkind IN ('v', 'm') THEN 'VIEW' ELSE 'BASE TABLE' END, a.attname, format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, CASE WHEN EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY (i.indkey)) THEN '1' ELSE '0' END FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped WHERE n.nspname = {} AND c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition ORDER BY c.relname, a.attnum",
            dialect.quote_literal(schema)
        ),
        Dialect::Sqlite => format!(
            "SELECT m.name, upper(m.type), p.name, p.type, CASE WHEN p.\"notnull\" = 1 THEN 'NO' ELSE 'YES' END, CASE WHEN p.pk > 0 THEN '1' ELSE '0' END FROM {db}.sqlite_master m, pragma_table_info(m.name, {schema}) p WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite!_%' ESCAPE '!' ORDER BY m.name, p.cid",
            db = dialect.quote_ident(database),
            schema = dialect.quote_literal(database)
        ),
    }
}

pub(crate) fn foreign_keys_sql(dialect: Dialect, database: &str, schema: &str) -> String {
    match dialect {
        Dialect::MySql { .. } => {
            let database = dialect.quote_literal(database);
            format!(
                "SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = {database} AND REFERENCED_TABLE_SCHEMA = {database} ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION"
            )
        }
        Dialect::Postgres { .. } => {
            let schema = dialect.quote_literal(schema);
            format!(
                "SELECT con.conname, c.relname, a.attname, rc.relname, ra.attname FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_class rc ON rc.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(col, refcol, ord) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.col JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = k.refcol WHERE con.contype = 'f' AND n.nspname = {schema} AND rn.nspname = {schema} ORDER BY c.relname, con.conname, k.ord"
            )
        }
        Dialect::Sqlite => format!(
            "SELECT m.name || '_fk_' || f.id, m.name, f.\"from\", f.\"table\", COALESCE(f.\"to\", (SELECT p.name FROM pragma_table_info(f.\"table\", {schema}) p WHERE p.pk = f.seq + 1)) FROM {db}.sqlite_master m, pragma_foreign_key_list(m.name, {schema}) f WHERE m.type = 'table' ORDER BY m.name, f.id, f.seq",
            db = dialect.quote_ident(database),
            schema = dialect.quote_literal(database)
        ),
    }
}

fn cell(row: &Row, index: usize) -> Option<String> {
    row.get(index).cloned().flatten()
}

pub(crate) fn parse_graph(column_rows: Vec<Row>, key_rows: Vec<Row>) -> SchemaGraph {
    let mut tables: Vec<GraphTable> = Vec::new();
    let mut truncated = false;
    for row in &column_rows {
        let (Some(table), Some(column)) = (cell(row, 0), cell(row, 2)) else {
            continue;
        };
        if tables.last().is_none_or(|last| last.name != table) {
            if tables.len() >= GRAPH_TABLE_LIMIT {
                truncated = true;
                break;
            }
            let kind = if cell(row, 1).is_some_and(|kind| kind.contains("VIEW")) {
                ObjectKind::View
            } else {
                ObjectKind::Table
            };
            tables.push(GraphTable {
                name: table,
                kind,
                columns: Vec::new(),
            });
        }
        if let Some(last) = tables.last_mut() {
            last.columns.push(GraphColumn {
                name: column,
                data_type: cell(row, 3).unwrap_or_default(),
                nullable: cell(row, 4).as_deref() == Some("YES"),
                primary: cell(row, 5).as_deref() == Some("1"),
            });
        }
    }

    let mut foreign_keys: Vec<GraphForeignKey> = Vec::new();
    for row in &key_rows {
        let (Some(name), Some(table), Some(column), Some(target_table), Some(target_column)) = (
            cell(row, 0),
            cell(row, 1),
            cell(row, 2),
            cell(row, 3),
            cell(row, 4),
        ) else {
            continue;
        };
        let known = |name: &str| tables.iter().any(|candidate| candidate.name == name);
        if !known(&table) || !known(&target_table) {
            continue;
        }
        match foreign_keys
            .iter_mut()
            .find(|key| key.name == name && key.table == table)
        {
            Some(key) => {
                key.columns.push(column);
                key.target_columns.push(target_column);
            }
            None => foreign_keys.push(GraphForeignKey {
                name,
                table,
                columns: vec![column],
                target_table,
                target_columns: vec![target_column],
            }),
        }
    }
    SchemaGraph {
        tables,
        foreign_keys,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(values: &[&str]) -> Row {
        values
            .iter()
            .map(|value| Some((*value).to_string()))
            .collect()
    }

    #[test]
    fn groups_columns_and_composite_keys() {
        let graph = parse_graph(
            vec![
                row(&["kunden", "BASE TABLE", "id", "int", "NO", "1"]),
                row(&["kunden", "BASE TABLE", "name", "varchar(40)", "YES", "0"]),
                row(&["positionen", "BASE TABLE", "bestellung", "int", "NO", "1"]),
                row(&["positionen", "BASE TABLE", "nr", "int", "NO", "1"]),
                row(&["umsatz", "VIEW", "summe", "decimal", "YES", "0"]),
            ],
            vec![
                row(&["fk_pos", "positionen", "bestellung", "kunden", "id"]),
                row(&["fk_two", "positionen", "bestellung", "kunden", "id"]),
                row(&["fk_two", "positionen", "nr", "kunden", "name"]),
                row(&["fk_gone", "positionen", "nr", "elsewhere", "id"]),
            ],
        );
        assert_eq!(graph.tables.len(), 3);
        assert_eq!(graph.tables[0].columns.len(), 2);
        assert!(graph.tables[0].columns[0].primary);
        assert!(graph.tables[0].columns[1].nullable);
        assert_eq!(graph.tables[2].kind, ObjectKind::View);
        assert_eq!(graph.foreign_keys.len(), 2);
        assert_eq!(graph.foreign_keys[1].columns, ["bestellung", "nr"]);
        assert_eq!(graph.foreign_keys[1].target_columns, ["id", "name"]);
        assert!(!graph.truncated);
    }

    #[test]
    fn stops_at_the_table_limit() {
        let rows = (0..GRAPH_TABLE_LIMIT + 5)
            .map(|index| {
                row(&[
                    &format!("t{index:04}"),
                    "BASE TABLE",
                    "id",
                    "int",
                    "NO",
                    "1",
                ])
            })
            .collect();
        let graph = parse_graph(rows, Vec::new());
        assert_eq!(graph.tables.len(), GRAPH_TABLE_LIMIT);
        assert!(graph.truncated);
    }
}
