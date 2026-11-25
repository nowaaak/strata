use super::Dialect;

impl Dialect {
    pub fn quote_ident(self, ident: &str) -> String {
        match self {
            Self::MySql { .. } => format!("`{}`", ident.replace('`', "``")),
            Self::Postgres { .. } => format!("\"{}\"", ident.replace('"', "\"\"")),
        }
    }

    pub fn qualified(self, parts: &[&str]) -> String {
        parts
            .iter()
            .map(|part| self.quote_ident(part))
            .collect::<Vec<_>>()
            .join(".")
    }

    pub fn quote_literal(self, value: &str) -> String {
        match self {
            Self::MySql {
                backslash_escapes: true,
            } => {
                let mut out = String::with_capacity(value.len() + 2);
                out.push('\'');
                for c in value.chars() {
                    match c {
                        '\\' => out.push_str("\\\\"),
                        '\'' => out.push_str("''"),
                        '\0' => out.push_str("\\0"),
                        '\u{1a}' => out.push_str("\\Z"),
                        other => out.push(other),
                    }
                }
                out.push('\'');
                out
            }
            Self::MySql {
                backslash_escapes: false,
            }
            | Self::Postgres {
                standard_strings: true,
            } => format!("'{}'", value.replace('\'', "''")),
            Self::Postgres {
                standard_strings: false,
            } => format!("E'{}'", value.replace('\\', "\\\\").replace('\'', "''")),
        }
    }

    pub fn literal_or_null(self, value: Option<&str>) -> String {
        value.map_or_else(|| "NULL".to_string(), |value| self.quote_literal(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_identifiers_per_dialect() {
        assert_eq!(Dialect::MYSQL.quote_ident("we`ird"), "`we``ird`");
        assert_eq!(Dialect::POSTGRES.quote_ident("we\"ird"), "\"we\"\"ird\"");
        assert_eq!(
            Dialect::MYSQL.qualified(&["shop", "orders"]),
            "`shop`.`orders`"
        );
    }

    #[test]
    fn escapes_mysql_literals() {
        assert_eq!(Dialect::MYSQL.quote_literal("a'b\\c\0d"), "'a''b\\\\c\\0d'");
        let plain = Dialect::MySql {
            backslash_escapes: false,
        };
        assert_eq!(plain.quote_literal("a'b\\c"), "'a''b\\c'");
    }

    #[test]
    fn escapes_postgres_literals() {
        assert_eq!(Dialect::POSTGRES.quote_literal("a'b\\c"), "'a''b\\c'");
        let legacy = Dialect::Postgres {
            standard_strings: false,
        };
        assert_eq!(legacy.quote_literal("a'b\\c"), "E'a''b\\\\c'");
        assert_eq!(Dialect::POSTGRES.literal_or_null(None), "NULL");
    }
}
