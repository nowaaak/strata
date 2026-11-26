use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::driver::Row;
use crate::schema::TableTarget;
use crate::sql::{Dialect, identifier_name, target_names};
use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ColumnDesign {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub default_expression: bool,
    pub auto_increment: bool,
    pub generated: bool,
    pub on_update: Option<String>,
    pub collation: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IndexDesign {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
    pub constraint: Option<String>,
    pub editable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ForeignKeyRule {
    NoAction,
    Restrict,
    Cascade,
    SetNull,
    SetDefault,
}

impl ForeignKeyRule {
    fn sql(self) -> &'static str {
        match self {
            Self::NoAction => "NO ACTION",
            Self::Restrict => "RESTRICT",
            Self::Cascade => "CASCADE",
            Self::SetNull => "SET NULL",
            Self::SetDefault => "SET DEFAULT",
        }
    }

    fn parse(value: &str) -> Self {
        match value.trim().to_ascii_uppercase().as_str() {
            "RESTRICT" => Self::Restrict,
            "CASCADE" => Self::Cascade,
            "SET NULL" => Self::SetNull,
            "SET DEFAULT" => Self::SetDefault,
            _ => Self::NoAction,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ForeignKeyDesign {
    pub name: String,
    pub columns: Vec<String>,
    pub target: TableTarget,
    pub target_columns: Vec<String>,
    pub on_delete: ForeignKeyRule,
    pub on_update: ForeignKeyRule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TableDesign {
    pub columns: Vec<ColumnDesign>,
    pub indexes: Vec<IndexDesign>,
    pub foreign_keys: Vec<ForeignKeyDesign>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ColumnPosition {
    First,
    After { column: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum DefaultValue {
    Keep,
    None,
    Null,
    Text { value: String },
    Expression { value: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default: DefaultValue,
    pub auto_increment: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "op", rename_all = "snake_case")]
#[ts(export)]
pub enum AlterOp {
    AddColumn {
        column: ColumnDef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        position: Option<ColumnPosition>,
    },
    ChangeColumn {
        name: String,
        column: ColumnDef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        position: Option<ColumnPosition>,
    },
    DropColumn {
        name: String,
    },
    AddIndex {
        name: String,
        columns: Vec<String>,
        unique: bool,
    },
    DropIndex {
        name: String,
    },
    AddPrimaryKey {
        columns: Vec<String>,
    },
    AddForeignKey {
        name: String,
        columns: Vec<String>,
        target_table: String,
        target_columns: Vec<String>,
        on_delete: ForeignKeyRule,
        on_update: ForeignKeyRule,
    },
    DropForeignKey {
        name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewTable {
    pub target: TableTarget,
    pub columns: Vec<ColumnDef>,
    pub primary_key: Vec<String>,
}

pub(crate) fn columns_sql(dialect: Dialect, target: &TableTarget) -> String {
    match dialect {
        Dialect::MySql { .. } => format!(
            "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLLATION_NAME, COLUMN_COMMENT, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = {} AND TABLE_NAME = {} ORDER BY ORDINAL_POSITION",
            dialect.quote_literal(&target.database),
            dialect.quote_literal(&target.table)
        ),
        Dialect::Postgres { .. } => format!(
            "SELECT a.attname, format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated, col_description(a.attrelid, a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = {} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
            regclass(dialect, target)
        ),
    }
}

pub(crate) fn indexes_sql(dialect: Dialect, target: &TableTarget) -> String {
    match dialect {
        Dialect::MySql { .. } => format!(
            "SELECT INDEX_NAME, CASE WHEN NON_UNIQUE = 0 THEN 'YES' ELSE 'NO' END, CASE WHEN INDEX_NAME = 'PRIMARY' THEN 'YES' ELSE 'NO' END, COLUMN_NAME, NULL, 'NO' FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = {} AND TABLE_NAME = {} ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX",
            dialect.quote_literal(&target.database),
            dialect.quote_literal(&target.table)
        ),
        Dialect::Postgres { .. } => format!(
            "SELECT ic.relname, CASE WHEN i.indisunique THEN 'YES' ELSE 'NO' END, CASE WHEN i.indisprimary THEN 'YES' ELSE 'NO' END, a.attname, c.conname, CASE WHEN i.indpred IS NULL THEN 'NO' ELSE 'YES' END FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord) LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum LEFT JOIN pg_constraint c ON c.conindid = i.indexrelid AND c.conrelid = i.indrelid WHERE i.indrelid = {} AND k.ord <= i.indnkeyatts ORDER BY i.indisprimary DESC, ic.relname, k.ord",
            regclass(dialect, target)
        ),
    }
}

pub(crate) fn foreign_keys_sql(dialect: Dialect, target: &TableTarget) -> String {
    match dialect {
        Dialect::MySql { .. } => format!(
            "SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, NULL, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = {} AND k.TABLE_NAME = {} AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION",
            dialect.quote_literal(&target.database),
            dialect.quote_literal(&target.table)
        ),
        Dialect::Postgres { .. } => {
            let rule = |column: &str| {
                format!(
                    "CASE c.{column} WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE 'NO ACTION' END"
                )
            };
            format!(
                "SELECT c.conname, a.attname, current_database(), rn.nspname, rc.relname, ra.attname, {}, {} FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(col, refcol, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.col JOIN pg_class rc ON rc.oid = c.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = k.refcol WHERE c.conrelid = {} AND c.contype = 'f' ORDER BY c.conname, k.ord",
                rule("confdeltype"),
                rule("confupdtype"),
                regclass(dialect, target)
            )
        }
    }
}

pub(crate) fn parse_foreign_keys(rows: Vec<Row>) -> Vec<ForeignKeyDesign> {
    let rules: Vec<(String, ForeignKeyRule, ForeignKeyRule)> = rows
        .iter()
        .filter_map(|row| {
            Some((
                cell(row, 0)?,
                ForeignKeyRule::parse(&cell(row, 6).unwrap_or_default()),
                ForeignKeyRule::parse(&cell(row, 7).unwrap_or_default()),
            ))
        })
        .collect();
    crate::schema::parse_foreign_keys(rows)
        .into_iter()
        .map(|key| {
            let (on_delete, on_update) = rules
                .iter()
                .find(|(name, _, _)| *name == key.name)
                .map(|(_, on_delete, on_update)| (*on_delete, *on_update))
                .unwrap_or((ForeignKeyRule::NoAction, ForeignKeyRule::NoAction));
            ForeignKeyDesign {
                name: key.name,
                columns: key.columns,
                target: key.target,
                target_columns: key.target_columns,
                on_delete,
                on_update,
            }
        })
        .collect()
}

fn regclass(dialect: Dialect, target: &TableTarget) -> String {
    format!(
        "{}::regclass",
        dialect.quote_literal(&target.qualified(dialect))
    )
}

fn cell(row: &Row, index: usize) -> Option<String> {
    row.get(index)
        .cloned()
        .flatten()
        .filter(|value| !value.is_empty())
}

pub(crate) fn parse_columns(dialect: Dialect, rows: Vec<Row>) -> Vec<ColumnDesign> {
    rows.iter()
        .filter_map(|row| {
            let name = cell(row, 0)?;
            let data_type = cell(row, 1).unwrap_or_default();
            let nullable = cell(row, 2).as_deref() == Some("YES");
            let default = row.get(3).cloned().flatten();
            Some(match dialect {
                Dialect::MySql { .. } => {
                    let extra = cell(row, 4).unwrap_or_default();
                    let lower = extra.to_ascii_lowercase();
                    let on_update = lower
                        .find("on update ")
                        .map(|start| extra[start + "on update ".len()..].trim().to_string());
                    ColumnDesign {
                        name,
                        data_type,
                        nullable,
                        default,
                        default_expression: lower.contains("default_generated"),
                        auto_increment: lower.contains("auto_increment"),
                        generated: cell(row, 7).is_some()
                            || lower.contains("virtual generated")
                            || lower.contains("stored generated")
                            || lower.contains("persistent generated"),
                        on_update,
                        collation: cell(row, 5),
                        comment: cell(row, 6),
                    }
                }
                Dialect::Postgres { .. } => ColumnDesign {
                    name,
                    data_type,
                    nullable,
                    default_expression: default.is_some(),
                    default,
                    auto_increment: cell(row, 4).is_some(),
                    generated: cell(row, 5).is_some(),
                    on_update: None,
                    collation: None,
                    comment: cell(row, 6),
                },
            })
        })
        .collect()
}

pub(crate) fn parse_indexes(rows: Vec<Row>) -> Vec<IndexDesign> {
    let mut indexes: Vec<IndexDesign> = Vec::new();
    for row in &rows {
        let Some(name) = cell(row, 0) else {
            continue;
        };
        let position = match indexes.iter().position(|index| index.name == name) {
            Some(position) => position,
            None => {
                indexes.push(IndexDesign {
                    name,
                    columns: Vec::new(),
                    unique: cell(row, 1).as_deref() == Some("YES"),
                    primary: cell(row, 2).as_deref() == Some("YES"),
                    constraint: cell(row, 4),
                    editable: cell(row, 5).as_deref() != Some("YES"),
                });
                indexes.len() - 1
            }
        };
        let index = &mut indexes[position];
        match cell(row, 3) {
            Some(column) => index.columns.push(column),
            None => index.editable = false,
        }
    }
    indexes
}

fn fragment<'a>(value: &'a str, what: &str) -> CoreResult<&'a str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CoreError::InvalidInput(format!(
            "the {what} must not be empty"
        )));
    }
    if ["--", "/*", "*/", ";", "#"]
        .iter()
        .any(|token| trimmed.contains(token))
    {
        return Err(CoreError::InvalidInput(format!(
            "the {what} must not contain ; or comments"
        )));
    }
    Ok(trimmed)
}

fn is_time_keyword(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    let base = match lower.find('(') {
        Some(open) if lower.ends_with(')') => {
            let inner = lower[open + 1..lower.len() - 1].trim();
            if !inner.chars().all(|c| c.is_ascii_digit()) {
                return false;
            }
            &lower[..open]
        }
        Some(_) => return false,
        None => lower.as_str(),
    };
    matches!(
        base.trim(),
        "current_timestamp"
            | "now"
            | "localtime"
            | "localtimestamp"
            | "current_date"
            | "current_time"
    )
}

fn is_textual(data_type: &str) -> bool {
    let lower = data_type.trim().to_ascii_lowercase();
    lower.contains("char")
        || lower.contains("text")
        || lower.starts_with("enum")
        || lower.starts_with("set")
}

fn needs_expression_default(data_type: &str) -> bool {
    let lower = data_type.trim().to_ascii_lowercase();
    lower.contains("blob")
        || lower.contains("text")
        || lower.starts_with("json")
        || lower.contains("geometry")
        || lower.contains("point")
        || lower.contains("polygon")
        || lower.contains("linestring")
}

fn same_type(a: &str, b: &str) -> bool {
    let normalize = |value: &str| {
        value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase()
    };
    normalize(a) == normalize(b)
}

fn new_default(dialect: Dialect, value: &DefaultValue) -> CoreResult<Option<String>> {
    Ok(match value {
        DefaultValue::Keep | DefaultValue::None => None,
        DefaultValue::Null => Some("NULL".into()),
        DefaultValue::Text { value } => Some(dialect.quote_literal(value)),
        DefaultValue::Expression { value } => {
            let expression = fragment(value, "default expression")?;
            Some(if dialect.is_mysql() && !is_time_keyword(expression) {
                format!("({expression})")
            } else {
                expression.to_string()
            })
        }
    })
}

fn unescape_catalog(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c == '\\'
            && let Some(next) = chars.next()
        {
            out.push(next);
            continue;
        }
        out.push(c);
    }
    out
}

fn kept_mysql_default(current: &ColumnDesign, mariadb: bool) -> Option<String> {
    let value = current.default.as_deref()?;
    if mariadb {
        return Some(value.to_string());
    }
    if current.default_expression {
        return Some(if is_time_keyword(value) {
            value.to_string()
        } else {
            format!("({})", unescape_catalog(value))
        });
    }
    Some(Dialect::MYSQL.quote_literal(value))
}

fn column_definition(
    dialect: Dialect,
    mariadb: bool,
    column: &ColumnDef,
    current: Option<&ColumnDesign>,
) -> CoreResult<String> {
    let name = dialect.quote_ident(identifier_name(&column.name)?);
    let data_type = fragment(&column.data_type, "data type")?;
    let mut parts = vec![name, data_type.to_string()];
    let default = match (&column.default, current) {
        (DefaultValue::Keep, Some(current)) if dialect.is_mysql() => {
            kept_mysql_default(current, mariadb)
        }
        (DefaultValue::Text { value }, _)
            if dialect.is_mysql() && !mariadb && needs_expression_default(data_type) =>
        {
            Some(format!("({})", dialect.quote_literal(value)))
        }
        (value, _) => new_default(dialect, value)?,
    }
    .filter(|default| column.nullable || !default.eq_ignore_ascii_case("NULL"));
    match dialect {
        Dialect::MySql { .. } => {
            if let Some(collation) = current.and_then(|current| current.collation.as_deref())
                && is_textual(data_type)
            {
                parts.push(format!("COLLATE {collation}"));
            }
            parts.push(if column.nullable { "NULL" } else { "NOT NULL" }.into());
            if let Some(default) = default {
                parts.push(format!("DEFAULT {default}"));
            }
            if column.auto_increment {
                parts.push("AUTO_INCREMENT".into());
            }
            if let Some(on_update) = current.and_then(|current| current.on_update.as_deref()) {
                parts.push(format!("ON UPDATE {on_update}"));
            }
            let comment = match &column.comment {
                Some(comment) => Some(comment.as_str()),
                None => current.and_then(|current| current.comment.as_deref()),
            };
            if let Some(comment) = comment.filter(|comment| !comment.is_empty()) {
                parts.push(format!("COMMENT {}", dialect.quote_literal(comment)));
            }
        }
        Dialect::Postgres { .. } => {
            if column.auto_increment {
                parts.push("GENERATED BY DEFAULT AS IDENTITY".into());
            }
            if !column.nullable {
                parts.push("NOT NULL".into());
            }
            if let Some(default) = default {
                parts.push(format!("DEFAULT {default}"));
            }
        }
    }
    Ok(parts.join(" "))
}

fn position_clause(dialect: Dialect, position: Option<&ColumnPosition>) -> CoreResult<String> {
    Ok(match (dialect, position) {
        (_, None) => String::new(),
        (Dialect::Postgres { .. }, Some(_)) => {
            return Err(CoreError::InvalidInput(
                "PostgreSQL cannot change the column order of an existing table".into(),
            ));
        }
        (Dialect::MySql { .. }, Some(ColumnPosition::First)) => " FIRST".into(),
        (Dialect::MySql { .. }, Some(ColumnPosition::After { column })) => {
            format!(" AFTER {}", dialect.quote_ident(identifier_name(column)?))
        }
    })
}

fn postgres_comment(
    dialect: Dialect,
    table: &str,
    column: &str,
    comment: &str,
) -> CoreResult<String> {
    let value = if comment.is_empty() {
        "NULL".to_string()
    } else {
        dialect.quote_literal(comment)
    };
    Ok(format!(
        "COMMENT ON COLUMN {table}.{} IS {value}",
        dialect.quote_ident(identifier_name(column)?)
    ))
}

fn new_comment(column: &ColumnDef) -> Option<&str> {
    column
        .comment
        .as_deref()
        .filter(|comment| !comment.is_empty())
}

fn find_foreign_key<'a>(design: &'a TableDesign, name: &str) -> CoreResult<&'a ForeignKeyDesign> {
    design
        .foreign_keys
        .iter()
        .find(|key| key.name == name)
        .ok_or_else(|| CoreError::NotFound(format!("foreign key {name} does not exist")))
}

fn index_columns(dialect: Dialect, columns: &[String]) -> CoreResult<String> {
    if columns.is_empty() {
        return Err(CoreError::InvalidInput(
            "an index needs at least one column".into(),
        ));
    }
    let quoted = columns
        .iter()
        .map(|column| identifier_name(column).map(|name| dialect.quote_ident(name)))
        .collect::<CoreResult<Vec<_>>>()?;
    Ok(quoted.join(", "))
}

fn find_column<'a>(design: &'a TableDesign, name: &str) -> CoreResult<&'a ColumnDesign> {
    design
        .columns
        .iter()
        .find(|column| column.name == name)
        .ok_or_else(|| CoreError::NotFound(format!("column {name} does not exist")))
}

fn find_index<'a>(design: &'a TableDesign, name: &str) -> CoreResult<&'a IndexDesign> {
    design
        .indexes
        .iter()
        .find(|index| index.name == name)
        .ok_or_else(|| CoreError::NotFound(format!("index {name} does not exist")))
}

fn postgres_change(
    dialect: Dialect,
    table: &str,
    current: &ColumnDesign,
    column: &ColumnDef,
) -> CoreResult<Vec<String>> {
    let mut statements = Vec::new();
    let mut name = dialect.quote_ident(&current.name);
    if column.name != current.name {
        let renamed = dialect.quote_ident(identifier_name(&column.name)?);
        statements.push(format!(
            "ALTER TABLE {table} RENAME COLUMN {name} TO {renamed}"
        ));
        name = renamed;
    }
    let data_type = fragment(&column.data_type, "data type")?;
    if !same_type(data_type, &current.data_type) {
        statements.push(format!(
            "ALTER TABLE {table} ALTER COLUMN {name} TYPE {data_type} USING {name}::{data_type}"
        ));
    }
    if column.nullable != current.nullable {
        let action = if column.nullable {
            "DROP NOT NULL"
        } else {
            "SET NOT NULL"
        };
        statements.push(format!("ALTER TABLE {table} ALTER COLUMN {name} {action}"));
    }
    match &column.default {
        DefaultValue::Keep => {}
        DefaultValue::None => {
            if current.default.is_some() && !current.auto_increment {
                statements.push(format!(
                    "ALTER TABLE {table} ALTER COLUMN {name} DROP DEFAULT"
                ));
            }
        }
        value => {
            if let Some(default) = new_default(dialect, value)? {
                statements.push(format!(
                    "ALTER TABLE {table} ALTER COLUMN {name} SET DEFAULT {default}"
                ));
            }
        }
    }
    if column.auto_increment && !current.auto_increment {
        statements.push(format!(
            "ALTER TABLE {table} ALTER COLUMN {name} ADD GENERATED BY DEFAULT AS IDENTITY"
        ));
    } else if !column.auto_increment && current.auto_increment {
        statements.push(format!(
            "ALTER TABLE {table} ALTER COLUMN {name} DROP IDENTITY"
        ));
    }
    if let Some(comment) = &column.comment
        && comment.as_str() != current.comment.as_deref().unwrap_or_default()
    {
        statements.push(postgres_comment(dialect, table, &column.name, comment)?);
    }
    Ok(statements)
}

pub(crate) fn alter_statements(
    dialect: Dialect,
    mariadb: bool,
    target: &TableTarget,
    design: &TableDesign,
    ops: &[AlterOp],
) -> CoreResult<Vec<String>> {
    target_names(target)?;
    if ops.is_empty() {
        return Err(CoreError::InvalidInput("there is nothing to change".into()));
    }
    let table = target.qualified(dialect);
    let mysql = dialect.is_mysql();
    let schema = target.schema.as_deref().unwrap_or("public");
    let mut drop_keys = Vec::new();
    let mut drop_indexes = Vec::new();
    let mut columns = Vec::new();
    let mut drops = Vec::new();
    let mut add_primary = Vec::new();
    let mut add_indexes = Vec::new();
    let mut add_keys = Vec::new();

    for op in ops {
        match op {
            AlterOp::DropForeignKey { name } => {
                find_foreign_key(design, name)?;
                let key = dialect.quote_ident(name);
                drop_keys.push(if mysql {
                    format!("DROP FOREIGN KEY {key}")
                } else {
                    format!("ALTER TABLE {table} DROP CONSTRAINT {key}")
                });
            }
            AlterOp::DropIndex { name } => {
                let index = find_index(design, name)?;
                drop_indexes.push(match dialect {
                    Dialect::MySql { .. } if index.primary => "DROP PRIMARY KEY".to_string(),
                    Dialect::MySql { .. } => format!("DROP INDEX {}", dialect.quote_ident(name)),
                    Dialect::Postgres { .. } => match &index.constraint {
                        Some(constraint) => format!(
                            "ALTER TABLE {table} DROP CONSTRAINT {}",
                            dialect.quote_ident(constraint)
                        ),
                        None => format!("DROP INDEX {}", dialect.qualified(&[schema, name])),
                    },
                });
            }
            AlterOp::ChangeColumn {
                name,
                column,
                position,
            } => {
                let current = find_column(design, name)?;
                if current.generated {
                    return Err(CoreError::InvalidInput(format!(
                        "{name} is a generated column and cannot be changed here"
                    )));
                }
                let position = position_clause(dialect, position.as_ref())?;
                match dialect {
                    Dialect::MySql { .. } => columns.push(format!(
                        "CHANGE COLUMN {} {}{position}",
                        dialect.quote_ident(name),
                        column_definition(dialect, mariadb, column, Some(current))?
                    )),
                    Dialect::Postgres { .. } => {
                        columns.extend(postgres_change(dialect, &table, current, column)?)
                    }
                }
            }
            AlterOp::AddColumn { column, position } => {
                let definition = column_definition(dialect, mariadb, column, None)?;
                let position = position_clause(dialect, position.as_ref())?;
                match dialect {
                    Dialect::MySql { .. } => {
                        columns.push(format!("ADD COLUMN {definition}{position}"))
                    }
                    Dialect::Postgres { .. } => {
                        columns.push(format!("ALTER TABLE {table} ADD COLUMN {definition}"));
                        if let Some(comment) = new_comment(column) {
                            columns.push(postgres_comment(dialect, &table, &column.name, comment)?);
                        }
                    }
                }
            }
            AlterOp::DropColumn { name } => {
                find_column(design, name)?;
                let column = dialect.quote_ident(name);
                drops.push(if mysql {
                    format!("DROP COLUMN {column}")
                } else {
                    format!("ALTER TABLE {table} DROP COLUMN {column}")
                });
            }
            AlterOp::AddIndex {
                name,
                columns,
                unique,
            } => {
                let index = dialect.quote_ident(identifier_name(name)?);
                let columns = index_columns(dialect, columns)?;
                let unique = if *unique { "UNIQUE " } else { "" };
                add_indexes.push(if mysql {
                    format!("ADD {unique}INDEX {index} ({columns})")
                } else {
                    format!("CREATE {unique}INDEX {index} ON {table} ({columns})")
                });
            }
            AlterOp::AddPrimaryKey { columns } => {
                if !add_primary.is_empty() {
                    return Err(CoreError::InvalidInput(
                        "a table can only have one primary key".into(),
                    ));
                }
                let columns = index_columns(dialect, columns)?;
                add_primary.push(if mysql {
                    format!("ADD PRIMARY KEY ({columns})")
                } else {
                    format!("ALTER TABLE {table} ADD PRIMARY KEY ({columns})")
                });
            }
            AlterOp::AddForeignKey {
                name,
                columns,
                target_table,
                target_columns,
                on_delete,
                on_update,
            } => {
                if columns.len() != target_columns.len() {
                    return Err(CoreError::InvalidInput(
                        "a foreign key needs as many referenced columns as columns".into(),
                    ));
                }
                let key = dialect.quote_ident(identifier_name(name)?);
                let referenced = dialect.qualified(&[
                    if mysql {
                        target.database.as_str()
                    } else {
                        schema
                    },
                    identifier_name(target_table)?,
                ]);
                let clause = format!(
                    "CONSTRAINT {key} FOREIGN KEY ({}) REFERENCES {referenced} ({}) ON DELETE {} ON UPDATE {}",
                    index_columns(dialect, columns)?,
                    index_columns(dialect, target_columns)?,
                    on_delete.sql(),
                    on_update.sql()
                );
                add_keys.push(if mysql {
                    format!("ADD {clause}")
                } else {
                    format!("ALTER TABLE {table} ADD {clause}")
                });
            }
        }
    }

    let ordered: Vec<String> = drop_keys
        .into_iter()
        .chain(drop_indexes)
        .chain(columns)
        .chain(drops)
        .chain(add_primary)
        .chain(add_indexes)
        .chain(add_keys)
        .collect();
    Ok(if mysql {
        vec![format!(
            "ALTER TABLE {table}\n    {}",
            ordered.join(",\n    ")
        )]
    } else {
        ordered
    })
}

pub(crate) fn create_statements(
    dialect: Dialect,
    mariadb: bool,
    table: &NewTable,
) -> CoreResult<Vec<String>> {
    target_names(&table.target)?;
    if table.columns.is_empty() {
        return Err(CoreError::InvalidInput(
            "a table needs at least one column".into(),
        ));
    }
    let mut lines = table
        .columns
        .iter()
        .map(|column| column_definition(dialect, mariadb, column, None))
        .collect::<CoreResult<Vec<_>>>()?;
    if !table.primary_key.is_empty() {
        for key in &table.primary_key {
            if !table.columns.iter().any(|column| &column.name == key) {
                return Err(CoreError::InvalidInput(format!(
                    "the primary key column {key} is not part of the table"
                )));
            }
        }
        lines.push(format!(
            "PRIMARY KEY ({})",
            index_columns(dialect, &table.primary_key)?
        ));
    }
    let qualified = table.target.qualified(dialect);
    let mut statements = vec![format!(
        "CREATE TABLE {qualified} (\n    {}\n)",
        lines.join(",\n    ")
    )];
    if !dialect.is_mysql() {
        for column in &table.columns {
            if let Some(comment) = new_comment(column) {
                statements.push(postgres_comment(
                    dialect,
                    &qualified,
                    &column.name,
                    comment,
                )?);
            }
        }
    }
    Ok(statements)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(schema: Option<&str>) -> TableTarget {
        TableTarget {
            database: "shop".into(),
            schema: schema.map(str::to_string),
            table: "orders".into(),
        }
    }

    fn column(name: &str, data_type: &str) -> ColumnDesign {
        ColumnDesign {
            name: name.into(),
            data_type: data_type.into(),
            nullable: true,
            default: None,
            default_expression: false,
            auto_increment: false,
            generated: false,
            on_update: None,
            collation: None,
            comment: None,
        }
    }

    fn def(name: &str, data_type: &str, nullable: bool, default: DefaultValue) -> ColumnDef {
        ColumnDef {
            comment: None,
            name: name.into(),
            data_type: data_type.into(),
            nullable,
            default,
            auto_increment: false,
        }
    }

    fn design() -> TableDesign {
        let mut label = column("label", "varchar(50)");
        label.collation = Some("utf8mb4_german2_ci".into());
        label.comment = Some("Bezeichnung's".into());
        let mut changed = column("changed", "timestamp");
        changed.default = Some("CURRENT_TIMESTAMP".into());
        changed.default_expression = true;
        changed.on_update = Some("CURRENT_TIMESTAMP".into());
        let mut id = column("id", "int");
        id.nullable = false;
        id.auto_increment = true;
        TableDesign {
            foreign_keys: Vec::new(),
            columns: vec![id, label, changed],
            indexes: vec![
                IndexDesign {
                    name: "PRIMARY".into(),
                    columns: vec!["id".into()],
                    unique: true,
                    primary: true,
                    constraint: None,
                    editable: true,
                },
                IndexDesign {
                    name: "orders_label_key".into(),
                    columns: vec!["label".into()],
                    unique: true,
                    primary: false,
                    constraint: Some("orders_label_key".into()),
                    editable: true,
                },
            ],
        }
    }

    #[test]
    fn mysql_change_keeps_collation_comment_and_on_update() {
        let statements = alter_statements(
            Dialect::MYSQL,
            false,
            &target(None),
            &design(),
            &[
                AlterOp::ChangeColumn {
                    position: None,
                    name: "label".into(),
                    column: def("title", "varchar(120)", false, DefaultValue::Keep),
                },
                AlterOp::ChangeColumn {
                    position: None,
                    name: "changed".into(),
                    column: def("changed", "timestamp", true, DefaultValue::Keep),
                },
            ],
        )
        .unwrap();
        assert_eq!(
            statements,
            vec![
                "ALTER TABLE `shop`.`orders`\n    CHANGE COLUMN `label` `title` varchar(120) COLLATE utf8mb4_german2_ci NOT NULL COMMENT 'Bezeichnung''s',\n    CHANGE COLUMN `changed` `changed` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
            ]
        );
    }

    #[test]
    fn mysql_defaults_are_quoted_or_wrapped() {
        let statements = alter_statements(
            Dialect::MYSQL,
            false,
            &target(None),
            &design(),
            &[
                AlterOp::AddColumn {
                    position: None,
                    column: def(
                        "note",
                        "text",
                        true,
                        DefaultValue::Text {
                            value: "it's".into(),
                        },
                    ),
                },
                AlterOp::AddColumn {
                    position: None,
                    column: def(
                        "uid",
                        "binary(16)",
                        true,
                        DefaultValue::Expression {
                            value: "uuid_to_bin(uuid())".into(),
                        },
                    ),
                },
                AlterOp::AddColumn {
                    position: None,
                    column: def("gone", "int", true, DefaultValue::Null),
                },
            ],
        )
        .unwrap();
        assert!(statements[0].contains("ADD COLUMN `note` text NULL DEFAULT ('it''s')"));
        assert!(statements[0].contains("DEFAULT (uuid_to_bin(uuid()))"));
        assert!(statements[0].contains("ADD COLUMN `gone` int NULL DEFAULT NULL"));
    }

    #[test]
    fn mariadb_defaults_are_reused_verbatim() {
        let mut design = design();
        design.columns[1].default = Some("'abc'".into());
        let statements = alter_statements(
            Dialect::MYSQL,
            true,
            &target(None),
            &design,
            &[AlterOp::ChangeColumn {
                position: None,
                name: "label".into(),
                column: def("label", "varchar(60)", true, DefaultValue::Keep),
            }],
        )
        .unwrap();
        assert!(
            statements[0].contains("NULL DEFAULT 'abc' COMMENT"),
            "{statements:?}"
        );
    }

    #[test]
    fn mysql_orders_clauses_and_drops_the_primary_key() {
        let statements = alter_statements(
            Dialect::MYSQL,
            false,
            &target(None),
            &design(),
            &[
                AlterOp::AddIndex {
                    name: "by_label".into(),
                    columns: vec!["label".into(), "changed".into()],
                    unique: false,
                },
                AlterOp::DropColumn {
                    name: "changed".into(),
                },
                AlterOp::DropIndex {
                    name: "PRIMARY".into(),
                },
            ],
        )
        .unwrap();
        assert_eq!(
            statements,
            vec![
                "ALTER TABLE `shop`.`orders`\n    DROP PRIMARY KEY,\n    DROP COLUMN `changed`,\n    ADD INDEX `by_label` (`label`, `changed`)"
            ]
        );
    }

    #[test]
    fn postgres_change_only_touches_what_changed() {
        let mut design = design();
        design.columns[1].data_type = "character varying(50)".into();
        let statements = alter_statements(
            Dialect::POSTGRES,
            false,
            &target(Some("public")),
            &design,
            &[
                AlterOp::ChangeColumn {
                    position: None,
                    name: "label".into(),
                    column: def(
                        "title",
                        "text",
                        false,
                        DefaultValue::Text { value: "x".into() },
                    ),
                },
                AlterOp::ChangeColumn {
                    position: None,
                    name: "id".into(),
                    column: ColumnDef {
                        comment: None,
                        auto_increment: false,
                        ..def("id", "INT", false, DefaultValue::Keep)
                    },
                },
                AlterOp::DropIndex {
                    name: "orders_label_key".into(),
                },
            ],
        )
        .unwrap();
        assert_eq!(
            statements,
            vec![
                "ALTER TABLE \"public\".\"orders\" DROP CONSTRAINT \"orders_label_key\"",
                "ALTER TABLE \"public\".\"orders\" RENAME COLUMN \"label\" TO \"title\"",
                "ALTER TABLE \"public\".\"orders\" ALTER COLUMN \"title\" TYPE text USING \"title\"::text",
                "ALTER TABLE \"public\".\"orders\" ALTER COLUMN \"title\" SET NOT NULL",
                "ALTER TABLE \"public\".\"orders\" ALTER COLUMN \"title\" SET DEFAULT 'x'",
                "ALTER TABLE \"public\".\"orders\" ALTER COLUMN \"id\" DROP IDENTITY",
            ]
        );
    }

    #[test]
    fn create_table_with_primary_key() {
        let statements = create_statements(
            Dialect::POSTGRES,
            false,
            &NewTable {
                target: target(Some("public")),
                columns: vec![
                    ColumnDef {
                        comment: None,
                        auto_increment: true,
                        ..def("id", "bigint", false, DefaultValue::None)
                    },
                    def(
                        "created",
                        "timestamptz",
                        false,
                        DefaultValue::Expression {
                            value: "now()".into(),
                        },
                    ),
                ],
                primary_key: vec!["id".into()],
            },
        )
        .unwrap();
        assert_eq!(
            statements,
            vec![
                "CREATE TABLE \"public\".\"orders\" (\n    \"id\" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,\n    \"created\" timestamptz NOT NULL DEFAULT now(),\n    PRIMARY KEY (\"id\")\n)"
            ]
        );
    }

    #[test]
    fn rejects_injection_and_unknown_names() {
        let bad_type = alter_statements(
            Dialect::MYSQL,
            false,
            &target(None),
            &design(),
            &[AlterOp::AddColumn {
                position: None,
                column: def("x", "int; DROP TABLE y", true, DefaultValue::None),
            }],
        );
        assert_eq!(bad_type.unwrap_err().kind(), "invalid_input");
        let bad_default = alter_statements(
            Dialect::POSTGRES,
            false,
            &target(Some("public")),
            &design(),
            &[AlterOp::AddColumn {
                position: None,
                column: def(
                    "x",
                    "int",
                    true,
                    DefaultValue::Expression {
                        value: "1 -- comment".into(),
                    },
                ),
            }],
        );
        assert_eq!(bad_default.unwrap_err().kind(), "invalid_input");
        let unknown = alter_statements(
            Dialect::MYSQL,
            false,
            &target(None),
            &design(),
            &[AlterOp::DropColumn {
                name: "missing".into(),
            }],
        );
        assert_eq!(unknown.unwrap_err().kind(), "not_found");
        let mut design = design();
        design.columns[0].generated = true;
        let generated = alter_statements(
            Dialect::MYSQL,
            false,
            &target(None),
            &design,
            &[AlterOp::ChangeColumn {
                position: None,
                name: "id".into(),
                column: def("id", "int", false, DefaultValue::Keep),
            }],
        );
        assert_eq!(generated.unwrap_err().kind(), "invalid_input");
    }

    #[test]
    fn mysql_expression_defaults_from_the_catalog_are_unescaped() {
        let mut design = design();
        design.columns[1].default = Some("_utf8mb4\\'it\\\\\\'s\\'".into());
        design.columns[1].default_expression = true;
        let statements = alter_statements(
            Dialect::MYSQL,
            false,
            &target(None),
            &design,
            &[AlterOp::ChangeColumn {
                position: None,
                name: "label".into(),
                column: def("label", "text", true, DefaultValue::Keep),
            }],
        )
        .unwrap();
        assert!(
            statements[0].contains("DEFAULT (_utf8mb4'it\\'s')"),
            "{statements:?}"
        );
    }

    #[test]
    fn recognises_time_keywords() {
        assert!(is_time_keyword("CURRENT_TIMESTAMP"));
        assert!(is_time_keyword("current_timestamp(3)"));
        assert!(is_time_keyword("now()"));
        assert!(!is_time_keyword("uuid()"));
        assert!(!is_time_keyword("now(1 + 1)"));
    }

    #[test]
    fn parses_index_rows() {
        let row = |values: &[Option<&str>]| -> Row {
            values
                .iter()
                .map(|value| value.map(str::to_string))
                .collect()
        };
        let indexes = parse_indexes(vec![
            row(&[
                Some("PRIMARY"),
                Some("YES"),
                Some("YES"),
                Some("id"),
                None,
                Some("NO"),
            ]),
            row(&[
                Some("idx"),
                Some("NO"),
                Some("NO"),
                Some("a"),
                None,
                Some("NO"),
            ]),
            row(&[
                Some("idx"),
                Some("NO"),
                Some("NO"),
                Some("b"),
                None,
                Some("NO"),
            ]),
            row(&[Some("expr"), Some("NO"), Some("NO"), None, None, Some("NO")]),
        ]);
        assert_eq!(indexes.len(), 3);
        assert!(indexes[0].primary);
        assert_eq!(indexes[1].columns, ["a", "b"]);
        assert!(!indexes[2].editable);
    }

    fn with_foreign_key() -> TableDesign {
        let mut design = design();
        design.foreign_keys.push(ForeignKeyDesign {
            name: "orders_customer".into(),
            columns: vec!["customer_id".into()],
            target: TableTarget {
                database: "shop".into(),
                schema: Some("public".into()),
                table: "customers".into(),
            },
            target_columns: vec!["id".into()],
            on_delete: ForeignKeyRule::Cascade,
            on_update: ForeignKeyRule::NoAction,
        });
        design
    }

    fn add_key() -> AlterOp {
        AlterOp::AddForeignKey {
            name: "orders_owner".into(),
            columns: vec!["label".into()],
            target_table: "owners".into(),
            target_columns: vec!["code".into()],
            on_delete: ForeignKeyRule::SetNull,
            on_update: ForeignKeyRule::Cascade,
        }
    }

    #[test]
    fn mysql_keys_order_and_comments_in_one_statement() {
        let mut moved = def("label", "varchar(50)", true, DefaultValue::Keep);
        moved.comment = Some("Name".into());
        let mut added = def("code", "int", true, DefaultValue::None);
        added.comment = Some("Kürzel".into());
        let statements = alter_statements(
            Dialect::MYSQL,
            false,
            &target(None),
            &with_foreign_key(),
            &[
                add_key(),
                AlterOp::AddPrimaryKey {
                    columns: vec!["id".into(), "label".into()],
                },
                AlterOp::DropIndex {
                    name: "PRIMARY".into(),
                },
                AlterOp::ChangeColumn {
                    name: "label".into(),
                    column: moved,
                    position: Some(ColumnPosition::First),
                },
                AlterOp::AddColumn {
                    column: added,
                    position: Some(ColumnPosition::After {
                        column: "label".into(),
                    }),
                },
                AlterOp::DropForeignKey {
                    name: "orders_customer".into(),
                },
            ],
        )
        .unwrap();
        assert_eq!(
            statements,
            vec![
                "ALTER TABLE `shop`.`orders`\n    DROP FOREIGN KEY `orders_customer`,\n    DROP PRIMARY KEY,\n    CHANGE COLUMN `label` `label` varchar(50) COLLATE utf8mb4_german2_ci NULL COMMENT 'Name' FIRST,\n    ADD COLUMN `code` int NULL COMMENT 'Kürzel' AFTER `label`,\n    ADD PRIMARY KEY (`id`, `label`),\n    ADD CONSTRAINT `orders_owner` FOREIGN KEY (`label`) REFERENCES `shop`.`owners` (`code`) ON DELETE SET NULL ON UPDATE CASCADE"
            ]
        );
    }

    #[test]
    fn mariadb_null_default_is_dropped_for_not_null() {
        let mut design = design();
        design.columns[1].default = Some("NULL".into());
        let statements = alter_statements(
            Dialect::MYSQL,
            true,
            &target(None),
            &design,
            &[AlterOp::ChangeColumn {
                name: "label".into(),
                column: def("label", "varchar(50)", false, DefaultValue::Keep),
                position: None,
            }],
        )
        .unwrap();
        assert!(!statements[0].contains("DEFAULT"), "{}", statements[0]);
    }

    #[test]
    fn mysql_empty_comment_removes_it() {
        let mut label = def("label", "varchar(50)", true, DefaultValue::Keep);
        label.comment = Some(String::new());
        let statements = alter_statements(
            Dialect::MYSQL,
            false,
            &target(None),
            &design(),
            &[AlterOp::ChangeColumn {
                name: "label".into(),
                column: label,
                position: None,
            }],
        )
        .unwrap();
        assert!(!statements[0].contains("COMMENT"), "{}", statements[0]);
    }

    #[test]
    fn postgres_keys_and_comments_are_separate_statements() {
        let mut label = def("label", "varchar(50)", true, DefaultValue::Keep);
        label.comment = Some(String::new());
        let mut added = def("code", "integer", true, DefaultValue::None);
        added.comment = Some("Kürzel".into());
        let statements = alter_statements(
            Dialect::POSTGRES,
            false,
            &target(Some("public")),
            &with_foreign_key(),
            &[
                AlterOp::DropForeignKey {
                    name: "orders_customer".into(),
                },
                AlterOp::ChangeColumn {
                    name: "label".into(),
                    column: label,
                    position: None,
                },
                AlterOp::AddColumn {
                    column: added,
                    position: None,
                },
                AlterOp::AddPrimaryKey {
                    columns: vec!["id".into()],
                },
                add_key(),
            ],
        )
        .unwrap();
        assert_eq!(
            statements,
            vec![
                "ALTER TABLE \"public\".\"orders\" DROP CONSTRAINT \"orders_customer\"",
                "COMMENT ON COLUMN \"public\".\"orders\".\"label\" IS NULL",
                "ALTER TABLE \"public\".\"orders\" ADD COLUMN \"code\" integer",
                "COMMENT ON COLUMN \"public\".\"orders\".\"code\" IS 'Kürzel'",
                "ALTER TABLE \"public\".\"orders\" ADD PRIMARY KEY (\"id\")",
                "ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"orders_owner\" FOREIGN KEY (\"label\") REFERENCES \"public\".\"owners\" (\"code\") ON DELETE SET NULL ON UPDATE CASCADE",
            ]
        );
    }

    #[test]
    fn postgres_refuses_column_positions_and_unknown_keys() {
        let error = alter_statements(
            Dialect::POSTGRES,
            false,
            &target(Some("public")),
            &design(),
            &[AlterOp::ChangeColumn {
                name: "label".into(),
                column: def("label", "varchar(50)", true, DefaultValue::Keep),
                position: Some(ColumnPosition::First),
            }],
        )
        .unwrap_err();
        assert_eq!(error.kind(), "invalid_input");
        let error = alter_statements(
            Dialect::POSTGRES,
            false,
            &target(Some("public")),
            &design(),
            &[AlterOp::DropForeignKey {
                name: "missing".into(),
            }],
        )
        .unwrap_err();
        assert_eq!(error.kind(), "not_found");
        let mismatch = AlterOp::AddForeignKey {
            name: "k".into(),
            columns: vec!["a".into(), "b".into()],
            target_table: "t".into(),
            target_columns: vec!["a".into()],
            on_delete: ForeignKeyRule::NoAction,
            on_update: ForeignKeyRule::NoAction,
        };
        assert!(
            alter_statements(
                Dialect::POSTGRES,
                false,
                &target(Some("public")),
                &design(),
                &[mismatch]
            )
            .is_err()
        );
    }

    #[test]
    fn postgres_create_adds_column_comments() {
        let mut id = def("id", "bigint", false, DefaultValue::None);
        id.comment = Some("Schlüssel".into());
        let statements = create_statements(
            Dialect::POSTGRES,
            false,
            &NewTable {
                target: target(Some("public")),
                columns: vec![id, def("name", "text", true, DefaultValue::None)],
                primary_key: vec!["id".into()],
            },
        )
        .unwrap();
        assert_eq!(statements.len(), 2);
        assert_eq!(
            statements[1],
            "COMMENT ON COLUMN \"public\".\"orders\".\"id\" IS 'Schlüssel'"
        );
    }

    #[test]
    fn foreign_key_rules_are_parsed() {
        let row = |values: &[Option<&str>]| -> Row {
            values
                .iter()
                .map(|value| value.map(str::to_string))
                .collect()
        };
        let keys = parse_foreign_keys(vec![
            row(&[
                Some("fk"),
                Some("a"),
                Some("shop"),
                Some("public"),
                Some("t"),
                Some("x"),
                Some("CASCADE"),
                Some("SET NULL"),
            ]),
            row(&[
                Some("fk"),
                Some("b"),
                Some("shop"),
                Some("public"),
                Some("t"),
                Some("y"),
                Some("CASCADE"),
                Some("SET NULL"),
            ]),
        ]);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].columns, ["a", "b"]);
        assert_eq!(keys[0].target_columns, ["x", "y"]);
        assert_eq!(keys[0].on_delete, ForeignKeyRule::Cascade);
        assert_eq!(keys[0].on_update, ForeignKeyRule::SetNull);
    }
}
