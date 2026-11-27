use crate::design::{
    AlterOp, ColumnDef, ColumnPosition, DefaultValue, ForeignKeyRule, IndexDesign, TableDesign,
};
use crate::schema::TableTarget;
use crate::sql::{Dialect, identifier_name, keywords, target_names};
use crate::{CoreError, CoreResult};

const DIALECT: Dialect = Dialect::Sqlite;
pub(crate) const FOREIGN_KEYS_OFF: &str = "PRAGMA foreign_keys = OFF";
pub(crate) const FOREIGN_KEY_CHECK: &str = "PRAGMA foreign_key_check";

pub(crate) struct SqliteObjects {
    pub table_sql: String,
    pub indexes: Vec<(String, String)>,
    pub triggers: Vec<String>,
}

struct Column {
    old: Option<String>,
    name: String,
    data_type: String,
    nullable: bool,
    default: Option<String>,
    autoincrement: bool,
}

struct ForeignKey {
    name: Option<String>,
    columns: Vec<String>,
    target: String,
    target_columns: Vec<String>,
    on_delete: ForeignKeyRule,
    on_update: ForeignKeyRule,
}

fn rule(rule: ForeignKeyRule) -> &'static str {
    match rule {
        ForeignKeyRule::NoAction => "NO ACTION",
        ForeignKeyRule::Restrict => "RESTRICT",
        ForeignKeyRule::Cascade => "CASCADE",
        ForeignKeyRule::SetNull => "SET NULL",
        ForeignKeyRule::SetDefault => "SET DEFAULT",
    }
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

fn is_autoindex(index: &IndexDesign) -> bool {
    index.name.starts_with("sqlite_autoindex_")
}

pub(crate) fn needs_rebuild(design: &TableDesign, ops: &[AlterOp]) -> bool {
    ops.iter().any(|op| match op {
        AlterOp::AddPrimaryKey { .. }
        | AlterOp::AddForeignKey { .. }
        | AlterOp::DropForeignKey { .. } => true,
        AlterOp::DropIndex { name } => design
            .indexes
            .iter()
            .any(|index| index.name == *name && (index.primary || is_autoindex(index))),
        AlterOp::AddColumn { column, position } => {
            position.is_some()
                || column.auto_increment
                || (!column.nullable && matches!(column.default, DefaultValue::None))
        }
        AlterOp::ChangeColumn {
            name,
            column,
            position,
        } => {
            let Some(current) = design.columns.iter().find(|current| current.name == *name) else {
                return false;
            };
            position.is_some()
                || !same_type(&column.data_type, &current.data_type)
                || column.nullable != current.nullable
                || !matches!(column.default, DefaultValue::Keep)
                || column.auto_increment != current.auto_increment
        }
        AlterOp::DropColumn { .. } | AlterOp::AddIndex { .. } => false,
    })
}

fn default_sql(value: &DefaultValue, current: Option<&str>) -> CoreResult<Option<String>> {
    Ok(match value {
        DefaultValue::Keep => current.map(str::to_string),
        DefaultValue::None => None,
        DefaultValue::Null => Some("NULL".into()),
        DefaultValue::Text { value } => Some(DIALECT.quote_literal(value)),
        DefaultValue::Expression { value } => {
            let trimmed = value.trim();
            if trimmed.is_empty()
                || [";", "--", "/*"]
                    .iter()
                    .any(|token| trimmed.contains(token))
            {
                return Err(CoreError::InvalidInput(
                    "the default expression must not be empty or contain ; or comments".into(),
                ));
            }
            Some(format!("({trimmed})"))
        }
    })
}

fn place(columns: &mut Vec<Column>, index: usize, position: &ColumnPosition) -> CoreResult<()> {
    let column = columns.remove(index);
    let at = match position {
        ColumnPosition::First => 0,
        ColumnPosition::After { column: after } => {
            columns
                .iter()
                .position(|candidate| candidate.name == *after)
                .ok_or_else(|| CoreError::InvalidInput(format!("column {after} does not exist")))?
                + 1
        }
    };
    columns.insert(at, column);
    Ok(())
}

fn apply_definition(column: &mut Column, def: &ColumnDef, autoincrement: bool) -> CoreResult<()> {
    if def
        .comment
        .as_deref()
        .is_some_and(|comment| !comment.trim().is_empty())
    {
        return Err(CoreError::InvalidInput(
            "SQLite has no column comments".into(),
        ));
    }
    column.name = identifier_name(&def.name)?.to_string();
    let data_type = def.data_type.trim();
    if data_type.contains(';') || data_type.contains("--") {
        return Err(CoreError::InvalidInput(
            "the data type must not contain ; or comments".into(),
        ));
    }
    column.data_type = data_type.to_string();
    column.nullable = def.nullable;
    column.default = default_sql(&def.default, column.default.as_deref())?;
    column.autoincrement = autoincrement;
    Ok(())
}

fn table_options(table_sql: &str) -> String {
    let tail = table_sql
        .rfind(')')
        .map(|close| table_sql[close + 1..].trim())
        .unwrap_or_default();
    let allowed = tail
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|word| !word.is_empty())
        .all(|word| {
            matches!(
                word.to_ascii_uppercase().as_str(),
                "WITHOUT" | "ROWID" | "STRICT"
            )
        });
    if allowed && !tail.is_empty() {
        format!(" {tail}")
    } else {
        String::new()
    }
}

fn columns_list(names: &[String]) -> CoreResult<String> {
    if names.is_empty() {
        return Err(CoreError::InvalidInput(
            "a key needs at least one column".into(),
        ));
    }
    Ok(names
        .iter()
        .map(|name| identifier_name(name).map(|name| DIALECT.quote_ident(name)))
        .collect::<CoreResult<Vec<_>>>()?
        .join(", "))
}

pub(crate) fn statements(
    target: &TableTarget,
    design: &TableDesign,
    objects: &SqliteObjects,
    ops: &[AlterOp],
) -> CoreResult<Vec<String>> {
    target_names(target)?;
    let words = keywords(&objects.table_sql, DIALECT);
    if design.columns.iter().any(|column| column.generated)
        || words
            .iter()
            .any(|word| matches!(word.as_str(), "CHECK" | "COLLATE" | "GENERATED"))
    {
        return Err(CoreError::InvalidInput(
            "the table has CHECK constraints, collations or generated columns that Strata cannot carry over when it rebuilds the table, change it with SQL".into(),
        ));
    }
    let original_autoincrement = words.iter().any(|word| word == "AUTOINCREMENT");

    let mut columns: Vec<Column> = design
        .columns
        .iter()
        .map(|column| Column {
            old: Some(column.name.clone()),
            name: column.name.clone(),
            data_type: column.data_type.clone(),
            nullable: column.nullable,
            default: column.default.clone(),
            autoincrement: column.auto_increment && original_autoincrement,
        })
        .collect();
    let rename = |columns: &[Column], old: &str| {
        columns
            .iter()
            .find(|column| column.old.as_deref() == Some(old))
            .map(|column| column.name.clone())
    };

    let mut primary: Vec<String> = design
        .indexes
        .iter()
        .find(|index| index.primary)
        .map(|index| index.columns.clone())
        .unwrap_or_default();
    let mut primary_is_new = false;
    let mut unique: Vec<(String, Vec<String>)> = design
        .indexes
        .iter()
        .filter(|index| is_autoindex(index) && index.unique && !index.primary)
        .map(|index| (index.name.clone(), index.columns.clone()))
        .collect();
    let mut indexes: Vec<&IndexDesign> = design
        .indexes
        .iter()
        .filter(|index| !index.primary && !is_autoindex(index))
        .collect();
    let mut keys: Vec<(Option<String>, ForeignKey)> = design
        .foreign_keys
        .iter()
        .map(|key| {
            (
                Some(key.name.clone()),
                ForeignKey {
                    name: None,
                    columns: key.columns.clone(),
                    target: key.target.table.clone(),
                    target_columns: key.target_columns.clone(),
                    on_delete: key.on_delete,
                    on_update: key.on_update,
                },
            )
        })
        .collect();
    let mut added_indexes: Vec<String> = Vec::new();

    for op in ops {
        match op {
            AlterOp::DropColumn { name } => {
                let index = columns
                    .iter()
                    .position(|column| column.old.as_deref() == Some(name.as_str()))
                    .ok_or_else(|| CoreError::NotFound(format!("column {name} does not exist")))?;
                columns.remove(index);
            }
            AlterOp::ChangeColumn {
                name,
                column,
                position,
            } => {
                let index = columns
                    .iter()
                    .position(|candidate| candidate.old.as_deref() == Some(name.as_str()))
                    .ok_or_else(|| CoreError::NotFound(format!("column {name} does not exist")))?;
                let current = design
                    .columns
                    .iter()
                    .find(|current| current.name == *name)
                    .ok_or_else(|| CoreError::NotFound(format!("column {name} does not exist")))?;
                let autoincrement = if column.auto_increment == current.auto_increment {
                    columns[index].autoincrement
                } else {
                    column.auto_increment
                };
                apply_definition(&mut columns[index], column, autoincrement)?;
                if let Some(position) = position {
                    place(&mut columns, index, position)?;
                }
            }
            AlterOp::AddColumn { column, position } => {
                let mut added = Column {
                    old: None,
                    name: String::new(),
                    data_type: String::new(),
                    nullable: true,
                    default: None,
                    autoincrement: false,
                };
                apply_definition(&mut added, column, column.auto_increment)?;
                columns.push(added);
                if let Some(position) = position {
                    let last = columns.len() - 1;
                    place(&mut columns, last, position)?;
                }
            }
            AlterOp::DropIndex { name } => {
                let index = design
                    .indexes
                    .iter()
                    .find(|index| index.name == *name)
                    .ok_or_else(|| CoreError::NotFound(format!("index {name} does not exist")))?;
                if index.primary {
                    primary.clear();
                    primary_is_new = true;
                } else {
                    unique.retain(|(unique_name, _)| unique_name != name);
                    indexes.retain(|candidate| candidate.name != *name);
                }
            }
            AlterOp::AddPrimaryKey { columns: list } => {
                primary = list.clone();
                primary_is_new = true;
            }
            AlterOp::AddIndex {
                name,
                columns: list,
                unique: is_unique,
            } => {
                let unique_word = if *is_unique { "UNIQUE " } else { "" };
                added_indexes.push(format!(
                    "CREATE {unique_word}INDEX {}.{} ON {} ({})",
                    DIALECT.quote_ident(&target.database),
                    DIALECT.quote_ident(identifier_name(name)?),
                    DIALECT.quote_ident(&target.table),
                    columns_list(list)?
                ));
            }
            AlterOp::DropForeignKey { name } => {
                let before = keys.len();
                keys.retain(|(key_name, _)| key_name.as_deref() != Some(name.as_str()));
                if keys.len() == before {
                    return Err(CoreError::NotFound(format!(
                        "foreign key {name} does not exist"
                    )));
                }
            }
            AlterOp::AddForeignKey {
                name,
                columns: list,
                target_table,
                target_columns,
                on_delete,
                on_update,
            } => {
                if list.len() != target_columns.len() {
                    return Err(CoreError::InvalidInput(
                        "a foreign key needs as many referenced columns as columns".into(),
                    ));
                }
                keys.push((
                    None,
                    ForeignKey {
                        name: Some(identifier_name(name)?.to_string()),
                        columns: list.clone(),
                        target: identifier_name(target_table)?.to_string(),
                        target_columns: target_columns.clone(),
                        on_delete: *on_delete,
                        on_update: *on_update,
                    },
                ));
            }
        }
    }

    if columns.is_empty() {
        return Err(CoreError::InvalidInput(
            "a table needs at least one column".into(),
        ));
    }
    let current_name = |old: &str| rename(&columns, old);
    let map_old = |list: &[String], what: &str| -> CoreResult<Vec<String>> {
        list.iter()
            .map(|old| {
                current_name(old).ok_or_else(|| {
                    CoreError::InvalidInput(format!(
                        "column {old} is still used by {what}, remove that first"
                    ))
                })
            })
            .collect()
    };
    let primary = if primary_is_new {
        primary
    } else {
        map_old(&primary, "the primary key")?
    };
    for name in &primary {
        if !columns.iter().any(|column| column.name == *name) {
            return Err(CoreError::InvalidInput(format!(
                "the primary key column {name} is not part of the table"
            )));
        }
    }

    let mut lines = Vec::new();
    let inline: Vec<&Column> = columns
        .iter()
        .filter(|column| column.autoincrement)
        .collect();
    if inline.len() > 1
        || inline
            .first()
            .is_some_and(|column| primary != [column.name.clone()])
        || inline
            .first()
            .is_some_and(|column| !column.data_type.eq_ignore_ascii_case("integer"))
    {
        return Err(CoreError::InvalidInput(
            "SQLite only counts up a single INTEGER primary key column".into(),
        ));
    }
    for column in &columns {
        let mut parts = vec![DIALECT.quote_ident(&column.name)];
        if !column.data_type.is_empty() {
            parts.push(column.data_type.clone());
        }
        if column.autoincrement {
            parts.push("PRIMARY KEY AUTOINCREMENT".into());
        }
        if !column.nullable {
            parts.push("NOT NULL".into());
        }
        if let Some(default) = &column.default {
            parts.push(format!("DEFAULT {default}"));
        }
        lines.push(parts.join(" "));
    }
    if !primary.is_empty() && inline.is_empty() {
        lines.push(format!("PRIMARY KEY ({})", columns_list(&primary)?));
    }
    for (name, list) in &unique {
        let list = map_old(list, &format!("the unique constraint {name}"))?;
        lines.push(format!("UNIQUE ({})", columns_list(&list)?));
    }
    for (original, key) in &keys {
        let list = if original.is_some() {
            map_old(&key.columns, "a foreign key")?
        } else {
            key.columns.clone()
        };
        let constraint = key
            .name
            .as_deref()
            .map(|name| format!("CONSTRAINT {} ", DIALECT.quote_ident(name)))
            .unwrap_or_default();
        lines.push(format!(
            "{constraint}FOREIGN KEY ({}) REFERENCES {} ({}) ON DELETE {} ON UPDATE {}",
            columns_list(&list)?,
            DIALECT.quote_ident(&key.target),
            columns_list(&key.target_columns)?,
            rule(key.on_delete),
            rule(key.on_update)
        ));
    }

    let schema = DIALECT.quote_ident(&target.database);
    let table = DIALECT.quote_ident(&target.table);
    let temporary = DIALECT.quote_ident(&format!("strata_rebuild_{}", target.table));
    let copied: Vec<&Column> = columns
        .iter()
        .filter(|column| column.old.is_some())
        .collect();
    let mut out = vec![
        FOREIGN_KEYS_OFF.to_string(),
        format!(
            "CREATE TABLE {schema}.{temporary} (\n    {}\n){}",
            lines.join(",\n    "),
            table_options(&objects.table_sql)
        ),
    ];
    if !copied.is_empty() {
        out.push(format!(
            "INSERT INTO {schema}.{temporary} ({}) SELECT {} FROM {schema}.{table}",
            copied
                .iter()
                .map(|column| DIALECT.quote_ident(&column.name))
                .collect::<Vec<_>>()
                .join(", "),
            copied
                .iter()
                .map(|column| DIALECT.quote_ident(column.old.as_deref().unwrap_or_default()))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    out.push(format!("DROP TABLE {schema}.{table}"));
    out.push(format!(
        "ALTER TABLE {schema}.{temporary} RENAME TO {table}"
    ));
    for index in &indexes {
        if index.editable {
            let list = map_old(&index.columns, &format!("the index {}", index.name))?;
            let unique_word = if index.unique { "UNIQUE " } else { "" };
            out.push(format!(
                "CREATE {unique_word}INDEX {schema}.{} ON {table} ({})",
                DIALECT.quote_ident(&index.name),
                columns_list(&list)?
            ));
        } else if let Some((_, sql)) = objects.indexes.iter().find(|(name, _)| *name == index.name)
        {
            out.push(sql.clone());
        }
    }
    out.extend(added_indexes);
    out.extend(objects.triggers.iter().cloned());
    out.push(format!("{FOREIGN_KEY_CHECK}({table})"));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::{ColumnDesign, ForeignKeyDesign};

    fn column(name: &str, data_type: &str, nullable: bool) -> ColumnDesign {
        ColumnDesign {
            name: name.into(),
            data_type: data_type.into(),
            nullable,
            default: None,
            default_expression: false,
            auto_increment: false,
            generated: false,
            on_update: None,
            collation: None,
            comment: None,
        }
    }

    fn design() -> TableDesign {
        let mut id = column("id", "INTEGER", false);
        id.auto_increment = true;
        let mut price = column("preis", "REAL", true);
        price.default = Some("0".into());
        TableDesign {
            columns: vec![
                id,
                column("name", "TEXT", false),
                price,
                column("kunde", "INTEGER", true),
            ],
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
                    name: "sqlite_autoindex_artikel_1".into(),
                    columns: vec!["name".into()],
                    unique: true,
                    primary: false,
                    constraint: None,
                    editable: false,
                },
                IndexDesign {
                    name: "artikel_preis".into(),
                    columns: vec!["preis".into()],
                    unique: false,
                    primary: false,
                    constraint: None,
                    editable: true,
                },
            ],
            foreign_keys: vec![ForeignKeyDesign {
                name: "artikel_fk_0".into(),
                columns: vec!["kunde".into()],
                target: TableTarget {
                    database: "main".into(),
                    schema: None,
                    table: "kunde".into(),
                },
                target_columns: vec!["id".into()],
                on_delete: ForeignKeyRule::Cascade,
                on_update: ForeignKeyRule::NoAction,
            }],
        }
    }

    fn objects(table_sql: &str) -> SqliteObjects {
        SqliteObjects {
            table_sql: table_sql.into(),
            indexes: vec![(
                "artikel_preis".into(),
                "CREATE INDEX artikel_preis ON artikel (preis)".into(),
            )],
            triggers: vec!["CREATE TRIGGER t AFTER INSERT ON artikel BEGIN SELECT 1; END".into()],
        }
    }

    fn target() -> TableTarget {
        TableTarget {
            database: "main".into(),
            schema: None,
            table: "artikel".into(),
        }
    }

    fn def(name: &str, data_type: &str, nullable: bool, default: DefaultValue) -> ColumnDef {
        ColumnDef {
            name: name.into(),
            data_type: data_type.into(),
            nullable,
            default,
            auto_increment: false,
            comment: None,
        }
    }

    const TABLE: &str = "CREATE TABLE artikel (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, preis REAL DEFAULT 0, kunde INTEGER REFERENCES kunde (id) ON DELETE CASCADE)";

    #[test]
    fn only_unsupported_changes_need_a_rebuild() {
        let design = design();
        let rename = AlterOp::ChangeColumn {
            name: "name".into(),
            column: def("titel", "text", false, DefaultValue::Keep),
            position: None,
        };
        assert!(!needs_rebuild(&design, &[rename]));
        let retype = AlterOp::ChangeColumn {
            name: "preis".into(),
            column: def("preis", "NUMERIC", true, DefaultValue::Keep),
            position: None,
        };
        assert!(needs_rebuild(&design, &[retype]));
        let add = AlterOp::AddColumn {
            column: def("x", "TEXT", true, DefaultValue::None),
            position: None,
        };
        assert!(!needs_rebuild(&design, std::slice::from_ref(&add)));
        let required = AlterOp::AddColumn {
            column: def("x", "TEXT", false, DefaultValue::None),
            position: None,
        };
        assert!(needs_rebuild(&design, &[required]));
        assert!(needs_rebuild(
            &design,
            &[AlterOp::DropForeignKey {
                name: "artikel_fk_0".into()
            }]
        ));
        assert!(!needs_rebuild(
            &design,
            &[AlterOp::DropIndex {
                name: "artikel_preis".into()
            }]
        ));
    }

    #[test]
    fn rebuild_keeps_keys_indexes_and_triggers() {
        let statements = statements(
            &target(),
            &design(),
            &objects(TABLE),
            &[
                AlterOp::ChangeColumn {
                    name: "preis".into(),
                    column: def("betrag", "NUMERIC(10,2)", false, DefaultValue::Keep),
                    position: Some(ColumnPosition::After {
                        column: "id".into(),
                    }),
                },
                AlterOp::AddColumn {
                    column: def(
                        "neu",
                        "TEXT",
                        false,
                        DefaultValue::Text {
                            value: "it's".into(),
                        },
                    ),
                    position: None,
                },
            ],
        )
        .unwrap();
        assert_eq!(statements[0], FOREIGN_KEYS_OFF);
        assert_eq!(
            statements[1],
            "CREATE TABLE \"main\".\"strata_rebuild_artikel\" (\n    \"id\" INTEGER NOT NULL,\n    \"betrag\" NUMERIC(10,2) NOT NULL DEFAULT 0,\n    \"name\" TEXT NOT NULL,\n    \"kunde\" INTEGER,\n    \"neu\" TEXT NOT NULL DEFAULT 'it''s',\n    PRIMARY KEY (\"id\"),\n    UNIQUE (\"name\"),\n    FOREIGN KEY (\"kunde\") REFERENCES \"kunde\" (\"id\") ON DELETE CASCADE ON UPDATE NO ACTION\n)"
        );
        assert_eq!(
            statements[2],
            "INSERT INTO \"main\".\"strata_rebuild_artikel\" (\"id\", \"betrag\", \"name\", \"kunde\") SELECT \"id\", \"preis\", \"name\", \"kunde\" FROM \"main\".\"artikel\""
        );
        assert_eq!(statements[3], "DROP TABLE \"main\".\"artikel\"");
        assert_eq!(
            statements[4],
            "ALTER TABLE \"main\".\"strata_rebuild_artikel\" RENAME TO \"artikel\""
        );
        assert_eq!(
            statements[5],
            "CREATE INDEX \"main\".\"artikel_preis\" ON \"artikel\" (\"betrag\")"
        );
        assert!(statements[6].starts_with("CREATE TRIGGER t"));
        assert_eq!(statements[7], "PRAGMA foreign_key_check(\"artikel\")");
    }

    #[test]
    fn autoincrement_options_and_new_keys() {
        let sql = "CREATE TABLE artikel (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, preis REAL, kunde INTEGER) STRICT";
        let mut design = design();
        design.foreign_keys.clear();
        design.indexes.truncate(1);
        let statements = statements(
            &target(),
            &design,
            &objects(sql),
            &[
                AlterOp::ChangeColumn {
                    name: "kunde".into(),
                    column: def("kunde", "INTEGER", false, DefaultValue::Keep),
                    position: None,
                },
                AlterOp::AddForeignKey {
                    name: "artikel_kunde".into(),
                    columns: vec!["kunde".into()],
                    target_table: "kunde".into(),
                    target_columns: vec!["id".into()],
                    on_delete: ForeignKeyRule::Restrict,
                    on_update: ForeignKeyRule::Cascade,
                },
            ],
        )
        .unwrap();
        assert!(statements[1].contains("\"id\" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL"));
        assert!(!statements[1].contains("    PRIMARY KEY (\"id\")"));
        assert!(statements[1].contains("CONSTRAINT \"artikel_kunde\" FOREIGN KEY (\"kunde\") REFERENCES \"kunde\" (\"id\") ON DELETE RESTRICT ON UPDATE CASCADE"));
        assert!(statements[1].ends_with(") STRICT"), "{}", statements[1]);
    }

    #[test]
    fn refuses_what_cannot_be_carried_over() {
        let check = "CREATE TABLE artikel (id INTEGER PRIMARY KEY, preis REAL CHECK (preis > 0))";
        let error = statements(&target(), &design(), &objects(check), &[]).unwrap_err();
        assert!(error.to_string().contains("CHECK"));
        let dropped_key_column = statements(
            &target(),
            &design(),
            &objects(TABLE),
            &[AlterOp::DropColumn {
                name: "kunde".into(),
            }],
        )
        .unwrap_err();
        assert!(dropped_key_column.to_string().contains("foreign key"));
    }
}
