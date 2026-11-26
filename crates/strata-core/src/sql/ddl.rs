use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Dialect;
use crate::schema::{ObjectKind, TableTarget};
use crate::{CoreError, CoreResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "action", rename_all = "snake_case")]
#[ts(export)]
pub enum DdlAction {
    CreateDatabase {
        name: String,
    },
    RenameDatabase {
        database: String,
        to: String,
    },
    DropDatabase {
        database: String,
    },
    CreateSchema {
        database: String,
        name: String,
    },
    RenameSchema {
        database: String,
        schema: String,
        to: String,
    },
    DropSchema {
        database: String,
        schema: String,
        cascade: bool,
    },
    RenameObject {
        target: TableTarget,
        kind: ObjectKind,
        to: String,
    },
    TruncateTable {
        target: TableTarget,
    },
    DropObject {
        target: TableTarget,
        kind: ObjectKind,
    },
}

impl DdlAction {
    pub fn affected_database(&self) -> Option<&str> {
        match self {
            Self::RenameDatabase { database, .. } | Self::DropDatabase { database } => {
                Some(database)
            }
            _ => None,
        }
    }

    pub fn working_database(&self) -> Option<&str> {
        match self {
            Self::CreateDatabase { .. }
            | Self::RenameDatabase { .. }
            | Self::DropDatabase { .. } => None,
            Self::CreateSchema { database, .. }
            | Self::RenameSchema { database, .. }
            | Self::DropSchema { database, .. } => Some(database),
            Self::RenameObject { target, .. }
            | Self::TruncateTable { target }
            | Self::DropObject { target, .. } => Some(&target.database),
        }
    }
}

fn name(value: &str) -> CoreResult<&str> {
    if value.trim().is_empty() {
        return Err(CoreError::InvalidInput("the name must not be empty".into()));
    }
    if value.trim() != value {
        return Err(CoreError::InvalidInput(
            "the name must not start or end with a space".into(),
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(CoreError::InvalidInput(
            "the name must not contain control characters".into(),
        ));
    }
    Ok(value)
}

fn postgres_only(dialect: Dialect, what: &str) -> CoreResult<()> {
    if dialect.is_mysql() {
        return Err(CoreError::InvalidInput(format!(
            "MySQL and MariaDB do not support {what}"
        )));
    }
    Ok(())
}

fn target_names(target: &TableTarget) -> CoreResult<()> {
    name(&target.database)?;
    name(&target.table)?;
    if let Some(schema) = &target.schema {
        name(schema)?;
    }
    Ok(())
}

fn object_word(kind: ObjectKind) -> &'static str {
    match kind {
        ObjectKind::Table => "TABLE",
        ObjectKind::View => "VIEW",
    }
}

pub fn ddl_statement(dialect: Dialect, action: &DdlAction) -> CoreResult<String> {
    let q = |ident: &str| dialect.quote_ident(ident);
    Ok(match action {
        DdlAction::CreateDatabase { name: db } => format!("CREATE DATABASE {}", q(name(db)?)),
        DdlAction::RenameDatabase { database, to } => {
            postgres_only(dialect, "renaming databases")?;
            format!(
                "ALTER DATABASE {} RENAME TO {}",
                q(name(database)?),
                q(name(to)?)
            )
        }
        DdlAction::DropDatabase { database } => format!("DROP DATABASE {}", q(name(database)?)),
        DdlAction::CreateSchema {
            database,
            name: schema,
        } => {
            postgres_only(dialect, "schemas inside a database")?;
            name(database)?;
            format!("CREATE SCHEMA {}", q(name(schema)?))
        }
        DdlAction::RenameSchema {
            database,
            schema,
            to,
        } => {
            postgres_only(dialect, "schemas inside a database")?;
            name(database)?;
            format!(
                "ALTER SCHEMA {} RENAME TO {}",
                q(name(schema)?),
                q(name(to)?)
            )
        }
        DdlAction::DropSchema {
            database,
            schema,
            cascade,
        } => {
            postgres_only(dialect, "schemas inside a database")?;
            name(database)?;
            let mode = if *cascade { "CASCADE" } else { "RESTRICT" };
            format!("DROP SCHEMA {} {mode}", q(name(schema)?))
        }
        DdlAction::RenameObject { target, kind, to } => {
            target_names(target)?;
            let to = name(to)?;
            match dialect {
                Dialect::MySql { .. } => format!(
                    "RENAME TABLE {} TO {}",
                    target.qualified(dialect),
                    dialect.qualified(&[&target.database, to])
                ),
                Dialect::Postgres { .. } => format!(
                    "ALTER {} {} RENAME TO {}",
                    object_word(*kind),
                    target.qualified(dialect),
                    q(to)
                ),
            }
        }
        DdlAction::TruncateTable { target } => {
            target_names(target)?;
            format!("TRUNCATE TABLE {}", target.qualified(dialect))
        }
        DdlAction::DropObject { target, kind } => {
            target_names(target)?;
            format!("DROP {} {}", object_word(*kind), target.qualified(dialect))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(schema: Option<&str>, table: &str) -> TableTarget {
        TableTarget {
            database: "shop".into(),
            schema: schema.map(str::to_string),
            table: table.into(),
        }
    }

    fn mysql(action: DdlAction) -> String {
        ddl_statement(Dialect::MYSQL, &action).unwrap()
    }

    fn pg(action: DdlAction) -> String {
        ddl_statement(Dialect::POSTGRES, &action).unwrap()
    }

    #[test]
    fn database_statements_quote_names() {
        assert_eq!(
            mysql(DdlAction::CreateDatabase {
                name: "we`ird".into()
            }),
            "CREATE DATABASE `we``ird`"
        );
        assert_eq!(
            pg(DdlAction::DropDatabase {
                database: "Kunden \"alt\"".into()
            }),
            "DROP DATABASE \"Kunden \"\"alt\"\"\""
        );
        assert_eq!(
            pg(DdlAction::RenameDatabase {
                database: "a".into(),
                to: "b".into()
            }),
            "ALTER DATABASE \"a\" RENAME TO \"b\""
        );
    }

    #[test]
    fn mysql_refuses_postgres_only_actions() {
        for action in [
            DdlAction::RenameDatabase {
                database: "a".into(),
                to: "b".into(),
            },
            DdlAction::CreateSchema {
                database: "a".into(),
                name: "s".into(),
            },
            DdlAction::DropSchema {
                database: "a".into(),
                schema: "s".into(),
                cascade: false,
            },
        ] {
            let err = ddl_statement(Dialect::MYSQL, &action).unwrap_err();
            assert_eq!(err.kind(), "invalid_input");
        }
    }

    #[test]
    fn schema_statements() {
        assert_eq!(
            pg(DdlAction::CreateSchema {
                database: "shop".into(),
                name: "archiv".into()
            }),
            "CREATE SCHEMA \"archiv\""
        );
        assert_eq!(
            pg(DdlAction::RenameSchema {
                database: "shop".into(),
                schema: "archiv".into(),
                to: "alt".into()
            }),
            "ALTER SCHEMA \"archiv\" RENAME TO \"alt\""
        );
        assert_eq!(
            pg(DdlAction::DropSchema {
                database: "shop".into(),
                schema: "alt".into(),
                cascade: false
            }),
            "DROP SCHEMA \"alt\" RESTRICT"
        );
        assert_eq!(
            pg(DdlAction::DropSchema {
                database: "shop".into(),
                schema: "alt".into(),
                cascade: true
            }),
            "DROP SCHEMA \"alt\" CASCADE"
        );
    }

    #[test]
    fn object_statements_are_qualified() {
        assert_eq!(
            mysql(DdlAction::RenameObject {
                target: target(None, "orders"),
                kind: ObjectKind::Table,
                to: "orders_old".into()
            }),
            "RENAME TABLE `shop`.`orders` TO `shop`.`orders_old`"
        );
        assert_eq!(
            pg(DdlAction::RenameObject {
                target: target(Some("public"), "v_orders"),
                kind: ObjectKind::View,
                to: "v_alt".into()
            }),
            "ALTER VIEW \"public\".\"v_orders\" RENAME TO \"v_alt\""
        );
        assert_eq!(
            mysql(DdlAction::TruncateTable {
                target: target(None, "orders")
            }),
            "TRUNCATE TABLE `shop`.`orders`"
        );
        assert_eq!(
            pg(DdlAction::DropObject {
                target: target(Some("public"), "orders"),
                kind: ObjectKind::Table
            }),
            "DROP TABLE \"public\".\"orders\""
        );
        assert_eq!(
            mysql(DdlAction::DropObject {
                target: target(None, "v"),
                kind: ObjectKind::View
            }),
            "DROP VIEW `shop`.`v`"
        );
    }

    #[test]
    fn rejects_bad_names() {
        for bad in ["", "   ", " lead", "trail ", "new\nline"] {
            let err = ddl_statement(
                Dialect::POSTGRES,
                &DdlAction::CreateDatabase { name: bad.into() },
            )
            .unwrap_err();
            assert_eq!(err.kind(), "invalid_input", "{bad:?}");
        }
        let err = ddl_statement(
            Dialect::MYSQL,
            &DdlAction::RenameObject {
                target: target(None, "orders"),
                kind: ObjectKind::Table,
                to: String::new(),
            },
        )
        .unwrap_err();
        assert_eq!(err.kind(), "invalid_input");
    }

    #[test]
    fn working_database_targets_the_maintenance_connection_for_database_actions() {
        let drop = DdlAction::DropDatabase {
            database: "shop".into(),
        };
        assert_eq!(drop.working_database(), None);
        assert_eq!(drop.affected_database(), Some("shop"));
        let truncate = DdlAction::TruncateTable {
            target: target(None, "orders"),
        };
        assert_eq!(truncate.working_database(), Some("shop"));
        assert_eq!(truncate.affected_database(), None);
    }
}
