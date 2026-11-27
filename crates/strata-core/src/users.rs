use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::driver::Row;
use crate::sql::Dialect;
use crate::{CoreError, CoreResult};

pub const MASK: &str = "••••••";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UserRef {
    pub name: String,
    pub host: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UserAccount {
    pub name: String,
    pub host: Option<String>,
    pub can_login: bool,
    pub superuser: bool,
    pub attributes: Vec<RoleAttribute>,
    pub member_of: Vec<String>,
    pub valid_until: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RoleAttribute {
    Superuser,
    CreateDb,
    CreateRole,
    Replication,
}

impl RoleAttribute {
    fn keyword(self, enabled: bool) -> &'static str {
        match (self, enabled) {
            (Self::Superuser, true) => "SUPERUSER",
            (Self::Superuser, false) => "NOSUPERUSER",
            (Self::CreateDb, true) => "CREATEDB",
            (Self::CreateDb, false) => "NOCREATEDB",
            (Self::CreateRole, true) => "CREATEROLE",
            (Self::CreateRole, false) => "NOCREATEROLE",
            (Self::Replication, true) => "REPLICATION",
            (Self::Replication, false) => "NOREPLICATION",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum GrantScope {
    Global,
    Database {
        database: String,
    },
    Schema {
        schema: String,
    },
    AllTables {
        schema: String,
    },
    Table {
        database: String,
        schema: Option<String>,
        table: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GrantEntry {
    pub scope: GrantScope,
    pub privileges: Vec<String>,
    pub grantable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UserDetail {
    pub account: UserAccount,
    pub grants: Vec<GrantEntry>,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "action", rename_all = "snake_case")]
#[ts(export)]
pub enum UserAction {
    Create {
        user: UserRef,
        password: Option<String>,
        can_login: bool,
    },
    Drop {
        user: UserRef,
    },
    SetPassword {
        user: UserRef,
        password: String,
    },
    SetLogin {
        user: UserRef,
        enabled: bool,
    },
    SetAttribute {
        user: UserRef,
        attribute: RoleAttribute,
        enabled: bool,
    },
    Grant {
        user: UserRef,
        scope: GrantScope,
        privileges: Vec<String>,
        grant_option: bool,
    },
    Revoke {
        user: UserRef,
        scope: GrantScope,
        privileges: Vec<String>,
    },
    AddMember {
        user: UserRef,
        role: String,
    },
    RemoveMember {
        user: UserRef,
        role: String,
    },
}

impl UserAction {
    pub fn user(&self) -> &UserRef {
        match self {
            Self::Create { user, .. }
            | Self::Drop { user }
            | Self::SetPassword { user, .. }
            | Self::SetLogin { user, .. }
            | Self::SetAttribute { user, .. }
            | Self::Grant { user, .. }
            | Self::Revoke { user, .. }
            | Self::AddMember { user, .. }
            | Self::RemoveMember { user, .. } => user,
        }
    }

    pub fn secret(&self) -> Option<&str> {
        match self {
            Self::Create { password, .. } => password.as_deref(),
            Self::SetPassword { password, .. } => Some(password.as_str()),
            _ => None,
        }
        .filter(|password| !password.is_empty())
    }
}

pub struct UserSql {
    pub statements: Vec<String>,
    pub preview: Vec<String>,
}

fn unsupported() -> CoreError {
    CoreError::InvalidInput("a SQLite file has no users".into())
}

fn name(value: &str, what: &str) -> CoreResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CoreError::InvalidInput(format!(
            "the {what} must not be empty"
        )));
    }
    if trimmed.chars().count() > 128 || trimmed.chars().any(char::is_control) {
        return Err(CoreError::InvalidInput(format!(
            "the {what} must be at most 128 characters without control characters"
        )));
    }
    Ok(trimmed.to_string())
}

fn privilege(value: &str) -> CoreResult<String> {
    let upper = value.trim().to_ascii_uppercase();
    let valid = !upper.is_empty()
        && upper.len() <= 64
        && upper.starts_with(|c: char| c.is_ascii_uppercase())
        && upper
            .chars()
            .all(|c| c.is_ascii_uppercase() || c == '_' || c == ' ');
    if !valid {
        return Err(CoreError::InvalidInput(format!(
            "{value:?} is not a privilege name"
        )));
    }
    Ok(upper.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn privileges(values: &[String]) -> CoreResult<String> {
    if values.is_empty() {
        return Err(CoreError::InvalidInput(
            "choose at least one privilege".into(),
        ));
    }
    let list = values
        .iter()
        .map(|value| privilege(value))
        .collect::<CoreResult<Vec<_>>>()?;
    Ok(list.join(", "))
}

pub fn account(dialect: Dialect, user: &UserRef) -> CoreResult<String> {
    let user_name = name(&user.name, "user name")?;
    Ok(match dialect {
        Dialect::MySql { .. } => {
            let host = match user.host.as_deref() {
                Some(host) => name(host, "host")?,
                None => "%".to_string(),
            };
            format!(
                "{}@{}",
                dialect.quote_literal(&user_name),
                dialect.quote_literal(&host)
            )
        }
        Dialect::Postgres { .. } => dialect.quote_ident(&user_name),
        Dialect::Sqlite => return Err(unsupported()),
    })
}

fn object(dialect: Dialect, scope: &GrantScope) -> CoreResult<String> {
    let q = |value: &str, what: &str| name(value, what).map(|value| dialect.quote_ident(&value));
    Ok(match (dialect, scope) {
        (Dialect::MySql { .. }, GrantScope::Global) => "*.*".into(),
        (Dialect::MySql { .. }, GrantScope::Database { database }) => {
            format!("{}.*", q(database, "database")?)
        }
        (
            Dialect::MySql { .. },
            GrantScope::Table {
                database, table, ..
            },
        ) => {
            format!("{}.{}", q(database, "database")?, q(table, "table")?)
        }
        (Dialect::MySql { .. }, _) => {
            return Err(CoreError::InvalidInput(
                "MySQL and MariaDB have no schemas inside a database".into(),
            ));
        }
        (Dialect::Postgres { .. }, GrantScope::Global) => {
            return Err(CoreError::InvalidInput(
                "PostgreSQL has no global privileges, use the role attributes".into(),
            ));
        }
        (Dialect::Postgres { .. }, GrantScope::Database { database }) => {
            format!("DATABASE {}", q(database, "database")?)
        }
        (Dialect::Postgres { .. }, GrantScope::Schema { schema }) => {
            format!("SCHEMA {}", q(schema, "schema")?)
        }
        (Dialect::Postgres { .. }, GrantScope::AllTables { schema }) => {
            format!("ALL TABLES IN SCHEMA {}", q(schema, "schema")?)
        }
        (Dialect::Postgres { .. }, GrantScope::Table { schema, table, .. }) => format!(
            "TABLE {}.{}",
            q(schema.as_deref().unwrap_or("public"), "schema")?,
            q(table, "table")?
        ),
        (Dialect::Sqlite, _) => return Err(unsupported()),
    })
}

fn password_clause(dialect: Dialect, password: &str) -> String {
    match dialect {
        Dialect::MySql { .. } => format!("IDENTIFIED BY {}", dialect.quote_literal(password)),
        _ => format!("PASSWORD {}", dialect.quote_literal(password)),
    }
}

fn both(statements: &mut Vec<String>, preview: &mut Vec<String>, sql: String) {
    preview.push(sql.clone());
    statements.push(sql);
}

pub fn user_sql(dialect: Dialect, action: &UserAction) -> CoreResult<UserSql> {
    let target = account(dialect, action.user())?;
    let mysql = dialect.is_mysql();
    let mut statements: Vec<String> = Vec::new();
    let mut preview: Vec<String> = Vec::new();
    match action {
        UserAction::Create {
            password,
            can_login,
            ..
        } => {
            let password = password.as_deref().filter(|value| !value.is_empty());
            let (real, masked) = match password {
                Some(password) => (
                    format!(" {}", password_clause(dialect, password)),
                    format!(" {}", password_clause(dialect, MASK)),
                ),
                None => (String::new(), String::new()),
            };
            let (head, tail) = if mysql {
                (format!("CREATE USER {target}"), String::new())
            } else {
                let login = if *can_login { "LOGIN" } else { "NOLOGIN" };
                (format!("CREATE ROLE {target} {login}"), String::new())
            };
            statements.push(format!("{head}{real}{tail}"));
            preview.push(format!("{head}{masked}{tail}"));
            if mysql && !can_login {
                both(
                    &mut statements,
                    &mut preview,
                    format!("ALTER USER {target} ACCOUNT LOCK"),
                );
            }
        }
        UserAction::Drop { .. } => {
            if mysql {
                both(&mut statements, &mut preview, format!("DROP USER {target}"));
            } else {
                for sql in [
                    format!("REASSIGN OWNED BY {target} TO CURRENT_USER"),
                    format!("DROP OWNED BY {target}"),
                    format!("DROP ROLE {target}"),
                ] {
                    both(&mut statements, &mut preview, sql);
                }
            }
        }
        UserAction::SetPassword { password, .. } => {
            if password.is_empty() {
                return Err(CoreError::InvalidInput(
                    "the new password must not be empty".into(),
                ));
            }
            let head = if mysql { "ALTER USER" } else { "ALTER ROLE" };
            statements.push(format!(
                "{head} {target} {}",
                password_clause(dialect, password)
            ));
            preview.push(format!(
                "{head} {target} {}",
                password_clause(dialect, MASK)
            ));
        }
        UserAction::SetLogin { enabled, .. } => both(
            &mut statements,
            &mut preview,
            match (mysql, enabled) {
                (true, true) => format!("ALTER USER {target} ACCOUNT UNLOCK"),
                (true, false) => format!("ALTER USER {target} ACCOUNT LOCK"),
                (false, true) => format!("ALTER ROLE {target} LOGIN"),
                (false, false) => format!("ALTER ROLE {target} NOLOGIN"),
            },
        ),
        UserAction::SetAttribute {
            attribute, enabled, ..
        } => {
            if mysql {
                return Err(CoreError::InvalidInput(
                    "role attributes only exist in PostgreSQL, use global privileges".into(),
                ));
            }
            both(
                &mut statements,
                &mut preview,
                format!("ALTER ROLE {target} {}", attribute.keyword(*enabled)),
            );
        }
        UserAction::Grant {
            scope,
            privileges: list,
            grant_option,
            ..
        } => {
            let option = if *grant_option {
                " WITH GRANT OPTION"
            } else {
                ""
            };
            both(
                &mut statements,
                &mut preview,
                format!(
                    "GRANT {} ON {} TO {target}{option}",
                    privileges(list)?,
                    object(dialect, scope)?
                ),
            );
        }
        UserAction::Revoke {
            scope,
            privileges: list,
            ..
        } => both(
            &mut statements,
            &mut preview,
            format!(
                "REVOKE {} ON {} FROM {target}",
                privileges(list)?,
                object(dialect, scope)?
            ),
        ),
        UserAction::AddMember { role, .. } => {
            let role = role_name(dialect, role)?;
            both(
                &mut statements,
                &mut preview,
                format!("GRANT {role} TO {target}"),
            );
        }
        UserAction::RemoveMember { role, .. } => {
            let role = role_name(dialect, role)?;
            both(
                &mut statements,
                &mut preview,
                format!("REVOKE {role} FROM {target}"),
            );
        }
    }
    Ok(UserSql {
        statements,
        preview,
    })
}

fn role_name(dialect: Dialect, role: &str) -> CoreResult<String> {
    if dialect.is_mysql() {
        return Err(CoreError::InvalidInput(
            "role membership is only managed for PostgreSQL".into(),
        ));
    }
    Ok(dialect.quote_ident(&name(role, "role")?))
}

pub fn mask_identified(statement: &str) -> String {
    let upper = statement.to_ascii_uppercase();
    let Some(start) = upper.find(" IDENTIFIED ") else {
        return statement.to_string();
    };
    let Some(open) = statement[start..].find('\'').map(|offset| start + offset) else {
        return statement.to_string();
    };
    let mut close = None;
    let mut chars = statement[open + 1..].char_indices().peekable();
    while let Some((index, c)) = chars.next() {
        if c == '\\' {
            chars.next();
        } else if c == '\'' {
            if chars.peek().is_some_and(|(_, next)| *next == '\'') {
                chars.next();
            } else {
                close = Some(open + 1 + index);
                break;
            }
        }
    }
    match close {
        Some(close) => format!("{}{MASK}{}", &statement[..=open], &statement[close..]),
        None => format!("{}{MASK}'", &statement[..=open]),
    }
}

pub fn mask_secret(text: &str, secret: Option<&str>) -> String {
    match secret.filter(|secret| !secret.is_empty()) {
        Some(secret) => text.replace(secret, MASK),
        None => text.to_string(),
    }
}

pub(crate) fn list_sql(dialect: Dialect, mariadb: bool) -> CoreResult<&'static str> {
    Ok(match dialect {
        Dialect::MySql { .. } if mariadb => {
            "SELECT u.User, u.Host, CASE WHEN JSON_VALUE(g.Priv, '$.account_locked') IN ('true', '1') THEN 'N' ELSE 'Y' END, CASE WHEN u.Super_priv = 'Y' THEN 'Y' ELSE 'N' END, NULL, NULL, NULL FROM mysql.user u LEFT JOIN mysql.global_priv g ON g.User = u.User AND g.Host = u.Host ORDER BY u.User, u.Host"
        }
        Dialect::MySql { .. } => {
            "SELECT User, Host, CASE WHEN account_locked = 'Y' THEN 'N' ELSE 'Y' END, CASE WHEN Super_priv = 'Y' THEN 'Y' ELSE 'N' END, NULL, NULL, NULL FROM mysql.user ORDER BY User, Host"
        }
        Dialect::Postgres { .. } => {
            "SELECT r.rolname, NULL, CASE WHEN r.rolcanlogin THEN 'Y' ELSE 'N' END, CASE WHEN r.rolsuper THEN 'Y' ELSE 'N' END, concat_ws(',', CASE WHEN r.rolcreatedb THEN 'create_db' END, CASE WHEN r.rolcreaterole THEN 'create_role' END, CASE WHEN r.rolreplication THEN 'replication' END), (SELECT string_agg(g.rolname, ',' ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid), r.rolvaliduntil::text FROM pg_roles r WHERE r.rolname !~ '^pg_' ORDER BY r.rolname"
        }
        Dialect::Sqlite => return Err(unsupported()),
    })
}

fn cell(row: &Row, index: usize) -> Option<String> {
    row.get(index)
        .cloned()
        .flatten()
        .filter(|value| !value.is_empty())
}

fn split_list(value: Option<String>) -> Vec<String> {
    value
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn parse_users(rows: Vec<Row>) -> Vec<UserAccount> {
    rows.iter()
        .filter_map(|row| {
            let attributes = split_list(cell(row, 4))
                .into_iter()
                .filter_map(|value| match value.as_str() {
                    "create_db" => Some(RoleAttribute::CreateDb),
                    "create_role" => Some(RoleAttribute::CreateRole),
                    "replication" => Some(RoleAttribute::Replication),
                    _ => None,
                })
                .collect();
            Some(UserAccount {
                name: row.first().cloned().flatten()?,
                host: cell(row, 1),
                can_login: cell(row, 2).as_deref() == Some("Y"),
                superuser: cell(row, 3).as_deref() == Some("Y"),
                attributes,
                member_of: split_list(cell(row, 5)),
                valid_until: cell(row, 6).filter(|value| value != "infinity"),
            })
        })
        .collect()
}

pub(crate) fn grants_sql(dialect: Dialect, user: &UserRef) -> CoreResult<String> {
    match dialect {
        Dialect::MySql { .. } => {
            let grantee = dialect.quote_literal(&account(dialect, user)?);
            Ok(format!(
                "SELECT 'global', NULL, NULL, NULL, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = {grantee} AND PRIVILEGE_TYPE <> 'USAGE' \
                 UNION ALL SELECT 'database', TABLE_SCHEMA, NULL, NULL, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = {grantee} \
                 UNION ALL SELECT 'table', TABLE_SCHEMA, NULL, TABLE_NAME, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = {grantee} \
                 ORDER BY 1, 2, 4, 5"
            ))
        }
        Dialect::Postgres { .. } => {
            let role = dialect.quote_literal(&name(&user.name, "user name")?);
            let oid = format!("(SELECT oid FROM pg_roles WHERE rolname = {role})");
            Ok(format!(
                "SELECT 'database', d.datname, NULL, NULL, a.privilege_type, CASE WHEN a.is_grantable THEN 'YES' ELSE 'NO' END FROM pg_database d, aclexplode(d.datacl) a WHERE a.grantee = {oid} \
                 UNION ALL SELECT 'schema', current_database(), n.nspname, NULL, a.privilege_type, CASE WHEN a.is_grantable THEN 'YES' ELSE 'NO' END FROM pg_namespace n, aclexplode(n.nspacl) a WHERE a.grantee = {oid} AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' \
                 UNION ALL SELECT 'table', current_database(), n.nspname, c.relname, a.privilege_type, CASE WHEN a.is_grantable THEN 'YES' ELSE 'NO' END FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a WHERE a.grantee = {oid} AND c.relkind IN ('r', 'p', 'v', 'm', 'f') \
                 ORDER BY 1, 2, 3, 4, 5"
            ))
        }
        Dialect::Sqlite => Err(unsupported()),
    }
}

pub(crate) fn parse_grants(rows: Vec<Row>) -> Vec<GrantEntry> {
    let mut entries: Vec<GrantEntry> = Vec::new();
    for row in &rows {
        let (Some(level), Some(privilege)) = (cell(row, 0), cell(row, 4)) else {
            continue;
        };
        let database = cell(row, 1);
        let schema = cell(row, 2);
        let scope = match level.as_str() {
            "global" => GrantScope::Global,
            "database" => GrantScope::Database {
                database: database.unwrap_or_default(),
            },
            "schema" => GrantScope::Schema {
                schema: schema.unwrap_or_default(),
            },
            _ => GrantScope::Table {
                database: database.unwrap_or_default(),
                schema,
                table: cell(row, 3).unwrap_or_default(),
            },
        };
        let grantable = cell(row, 5).as_deref() == Some("YES");
        match entries
            .iter_mut()
            .find(|entry| entry.scope == scope && entry.grantable == grantable)
        {
            Some(entry) => {
                if !entry.privileges.contains(&privilege) {
                    entry.privileges.push(privilege);
                }
            }
            None => entries.push(GrantEntry {
                scope,
                privileges: vec![privilege],
                grantable,
            }),
        }
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(name: &str, host: Option<&str>) -> UserRef {
        UserRef {
            name: name.into(),
            host: host.map(str::to_string),
        }
    }

    #[test]
    fn mysql_create_masks_the_password_in_the_preview() {
        let sql = user_sql(
            Dialect::MYSQL,
            &UserAction::Create {
                user: user("app", Some("10.0.%")),
                password: Some("ge'heim".into()),
                can_login: false,
            },
        )
        .unwrap();
        assert_eq!(
            sql.statements,
            [
                "CREATE USER 'app'@'10.0.%' IDENTIFIED BY 'ge''heim'",
                "ALTER USER 'app'@'10.0.%' ACCOUNT LOCK"
            ]
        );
        assert_eq!(
            sql.preview[0],
            format!("CREATE USER 'app'@'10.0.%' IDENTIFIED BY '{MASK}'")
        );
        assert!(!sql.preview.join(" ").contains("heim"));
    }

    #[test]
    fn postgres_roles_quote_names_and_mask_passwords() {
        let sql = user_sql(
            Dialect::POSTGRES,
            &UserAction::Create {
                user: user("Le\"ser", None),
                password: Some("pw".into()),
                can_login: true,
            },
        )
        .unwrap();
        assert_eq!(
            sql.statements,
            ["CREATE ROLE \"Le\"\"ser\" LOGIN PASSWORD 'pw'"]
        );
        assert_eq!(
            sql.preview,
            [format!("CREATE ROLE \"Le\"\"ser\" LOGIN PASSWORD '{MASK}'")]
        );
        let none = user_sql(
            Dialect::POSTGRES,
            &UserAction::Create {
                user: user("gruppe", None),
                password: None,
                can_login: false,
            },
        )
        .unwrap();
        assert_eq!(none.statements, ["CREATE ROLE \"gruppe\" NOLOGIN"]);
    }

    #[test]
    fn grants_per_scope_and_dialect() {
        let grant = |dialect, scope, list: &[&str], option| {
            user_sql(
                dialect,
                &UserAction::Grant {
                    user: user("app", None),
                    scope,
                    privileges: list.iter().map(|value| (*value).to_string()).collect(),
                    grant_option: option,
                },
            )
            .map(|sql| sql.statements.join(""))
        };
        assert_eq!(
            grant(
                Dialect::MYSQL,
                GrantScope::Global,
                &["process", "show databases"],
                false
            )
            .unwrap(),
            "GRANT PROCESS, SHOW DATABASES ON *.* TO 'app'@'%'"
        );
        assert_eq!(
            grant(
                Dialect::MYSQL,
                GrantScope::Table {
                    database: "shop".into(),
                    schema: None,
                    table: "kunden".into()
                },
                &["SELECT"],
                true
            )
            .unwrap(),
            "GRANT SELECT ON `shop`.`kunden` TO 'app'@'%' WITH GRANT OPTION"
        );
        assert_eq!(
            grant(
                Dialect::POSTGRES,
                GrantScope::AllTables {
                    schema: "public".into()
                },
                &["SELECT", "UPDATE"],
                false
            )
            .unwrap(),
            "GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA \"public\" TO \"app\""
        );
        assert_eq!(
            grant(
                Dialect::POSTGRES,
                GrantScope::Database {
                    database: "shop".into()
                },
                &["CONNECT"],
                false
            )
            .unwrap(),
            "GRANT CONNECT ON DATABASE \"shop\" TO \"app\""
        );
        assert!(grant(Dialect::POSTGRES, GrantScope::Global, &["SELECT"], false).is_err());
        assert!(
            grant(
                Dialect::MYSQL,
                GrantScope::Schema { schema: "x".into() },
                &["SELECT"],
                false
            )
            .is_err()
        );
        assert!(grant(Dialect::MYSQL, GrantScope::Global, &["SELECT; DROP"], false).is_err());
        assert!(grant(Dialect::MYSQL, GrantScope::Global, &[], false).is_err());
    }

    #[test]
    fn attributes_membership_and_unsupported_cases() {
        let pg = |action| user_sql(Dialect::POSTGRES, &action).map(|sql| sql.statements.join(""));
        assert_eq!(
            pg(UserAction::SetAttribute {
                user: user("app", None),
                attribute: RoleAttribute::CreateDb,
                enabled: false
            })
            .unwrap(),
            "ALTER ROLE \"app\" NOCREATEDB"
        );
        assert_eq!(
            pg(UserAction::AddMember {
                user: user("app", None),
                role: "leser".into()
            })
            .unwrap(),
            "GRANT \"leser\" TO \"app\""
        );
        assert!(
            user_sql(
                Dialect::MYSQL,
                &UserAction::SetAttribute {
                    user: user("app", None),
                    attribute: RoleAttribute::Superuser,
                    enabled: true
                }
            )
            .is_err()
        );
        assert!(
            user_sql(
                Dialect::Sqlite,
                &UserAction::Drop {
                    user: user("app", None)
                }
            )
            .is_err()
        );
        assert!(
            user_sql(
                Dialect::MYSQL,
                &UserAction::Drop {
                    user: user(" ", None)
                }
            )
            .is_err()
        );
    }

    #[test]
    fn secrets_are_masked_in_messages() {
        let action = UserAction::SetPassword {
            user: user("app", None),
            password: "s3cr3t".into(),
        };
        assert_eq!(action.secret(), Some("s3cr3t"));
        assert_eq!(
            mask_secret("near 's3cr3t' at line 1", action.secret()),
            format!("near '{MASK}' at line 1")
        );
        assert_eq!(mask_secret("plain", None), "plain");
    }

    #[test]
    fn password_hashes_in_show_grants_are_masked() {
        assert_eq!(
            mask_identified(
                "GRANT USAGE ON *.* TO `app`@`%` IDENTIFIED BY PASSWORD '*94BDCEBE19083CE2A1F959FD02F964C7AF4CFC29' WITH GRANT OPTION"
            ),
            format!(
                "GRANT USAGE ON *.* TO `app`@`%` IDENTIFIED BY PASSWORD '{MASK}' WITH GRANT OPTION"
            )
        );
        assert_eq!(
            mask_identified("GRANT SELECT ON `shop`.* TO `app`@`%`"),
            "GRANT SELECT ON `shop`.* TO `app`@`%`"
        );
    }

    #[test]
    fn parses_users_and_grouped_grants() {
        let row = |values: &[Option<&str>]| -> Row {
            values
                .iter()
                .map(|value| value.map(str::to_string))
                .collect()
        };
        let users = parse_users(vec![row(&[
            Some("app"),
            None,
            Some("Y"),
            Some("N"),
            Some("create_db,replication"),
            Some("leser,schreiber"),
            Some("infinity"),
        ])]);
        assert_eq!(
            users[0].attributes,
            [RoleAttribute::CreateDb, RoleAttribute::Replication]
        );
        assert_eq!(users[0].member_of, ["leser", "schreiber"]);
        assert_eq!(users[0].valid_until, None);
        assert!(users[0].can_login);

        let grants = parse_grants(vec![
            row(&[
                Some("database"),
                Some("shop"),
                None,
                None,
                Some("SELECT"),
                Some("NO"),
            ]),
            row(&[
                Some("database"),
                Some("shop"),
                None,
                None,
                Some("INSERT"),
                Some("NO"),
            ]),
            row(&[
                Some("table"),
                Some("shop"),
                Some("public"),
                Some("k"),
                Some("SELECT"),
                Some("YES"),
            ]),
        ]);
        assert_eq!(grants.len(), 2);
        assert_eq!(grants[0].privileges, ["SELECT", "INSERT"]);
        assert!(grants[1].grantable);
    }
}
