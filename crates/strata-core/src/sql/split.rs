use serde::Serialize;
use ts_rs::TS;

use super::Dialect;
use super::lexer::{Token, line_end, next_token};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SqlStatement {
    pub text: String,
    pub start: u32,
    pub end: u32,
    pub writes: bool,
}

pub fn split_statements(sql: &str, dialect: Dialect) -> Vec<SqlStatement> {
    let chars: Vec<char> = sql.chars().collect();
    let mut utf16 = Vec::with_capacity(chars.len() + 1);
    let mut offset = 0u32;
    utf16.push(0);
    for c in &chars {
        offset += c.len_utf16() as u32;
        utf16.push(offset);
    }

    let mut statements = Vec::new();
    let mut delimiter: Vec<char> = vec![';'];
    let mut start = 0usize;
    let mut has_code = false;
    let mut i = 0usize;

    while i < chars.len() {
        if dialect.is_mysql() && !has_code && starts_with_keyword(&chars, i, "DELIMITER") {
            let end = line_end(&chars, i);
            let value: String = chars[i + "DELIMITER".len()..end].iter().collect();
            let value = value.trim();
            if !value.is_empty() {
                delimiter = value.chars().collect();
            }
            i = end;
            start = i;
            continue;
        }
        if chars[i..].starts_with(&delimiter) {
            if has_code {
                statements.push(make_statement(&chars, &utf16, start, i, dialect));
            }
            i += delimiter.len();
            start = i;
            has_code = false;
            continue;
        }
        let (token, end) = next_token(&chars, i, dialect);
        if !matches!(token, Token::Whitespace | Token::Comment) {
            has_code = true;
        }
        i = end;
    }
    if has_code {
        statements.push(make_statement(&chars, &utf16, start, chars.len(), dialect));
    }
    statements
}

fn make_statement(
    chars: &[char],
    utf16: &[u32],
    mut start: usize,
    mut end: usize,
    dialect: Dialect,
) -> SqlStatement {
    while start < end && chars[start].is_whitespace() {
        start += 1;
    }
    while end > start && chars[end - 1].is_whitespace() {
        end -= 1;
    }
    let text: String = chars[start..end].iter().collect();
    let writes = is_write(&text, dialect);
    SqlStatement {
        text,
        start: utf16[start],
        end: utf16[end],
        writes,
    }
}

fn starts_with_keyword(chars: &[char], at: usize, keyword: &str) -> bool {
    let len = keyword.len();
    if at + len > chars.len() {
        return false;
    }
    let matches = chars[at..at + len]
        .iter()
        .zip(keyword.chars())
        .all(|(a, b)| a.eq_ignore_ascii_case(&b));
    matches && chars.get(at + len).is_none_or(|c| c.is_whitespace())
}

struct Word {
    text: String,
    call: bool,
}

fn words(text: &str, dialect: Dialect) -> Vec<Word> {
    let chars: Vec<char> = text.chars().collect();
    let mut words = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let (token, end) = next_token(&chars, i, dialect);
        if let Token::Word { start, end } = token {
            let mut after = end;
            while after < chars.len() && chars[after].is_whitespace() {
                after += 1;
            }
            words.push(Word {
                text: chars[start..end].iter().collect::<String>().to_uppercase(),
                call: chars.get(after) == Some(&'('),
            });
        }
        i = end;
    }
    words
}

const PURE_READ: &[&str] = &["SHOW", "DESCRIBE", "DESC", "HELP", "USE"];
const SCANNED_READ: &[&str] = &["SELECT", "WITH", "EXPLAIN", "VALUES", "TABLE"];
const WRITE_WORDS: &[&str] = &[
    "INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE", "INTO", "CREATE", "DROP", "ALTER",
    "TRUNCATE", "GRANT", "REVOKE", "CALL", "RENAME", "LOAD", "LOCK", "UPSERT",
];
const GLOBAL_SET: &[&str] = &["GLOBAL", "PERSIST", "PERSIST_ONLY", "PASSWORD"];

pub fn is_write(text: &str, dialect: Dialect) -> bool {
    let words = words(text, dialect);
    let Some(first) = words.first() else {
        return false;
    };
    let first = first.text.as_str();
    if PURE_READ.contains(&first) {
        return false;
    }
    if first == "SET" {
        return words
            .get(1)
            .is_some_and(|word| GLOBAL_SET.contains(&word.text.as_str()));
    }
    if SCANNED_READ.contains(&first) {
        return words
            .iter()
            .any(|word| !word.call && WRITE_WORDS.contains(&word.text.as_str()));
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(sql: &str, dialect: Dialect) -> Vec<String> {
        split_statements(sql, dialect)
            .into_iter()
            .map(|statement| statement.text)
            .collect()
    }

    #[test]
    fn splits_on_semicolons_and_skips_empty_statements() {
        assert_eq!(
            texts("SELECT 1;\n\n SELECT 2 ;;  -- trailing\n", Dialect::MYSQL),
            vec!["SELECT 1", "SELECT 2"]
        );
    }

    #[test]
    fn ignores_delimiters_inside_strings_identifiers_and_comments() {
        let sql = "SELECT 'a;b', \"c;d\", `e;f` -- x;y\n/* z; */ FROM t; SELECT 2";
        assert_eq!(
            texts(sql, Dialect::MYSQL),
            vec![
                "SELECT 'a;b', \"c;d\", `e;f` -- x;y\n/* z; */ FROM t",
                "SELECT 2"
            ]
        );
    }

    #[test]
    fn handles_backslash_and_doubled_quotes_in_mysql() {
        assert_eq!(
            texts(r"SELECT 'it\'s;', 'a''b;'; SELECT 3", Dialect::MYSQL),
            vec![r"SELECT 'it\'s;', 'a''b;'", "SELECT 3"]
        );
    }

    #[test]
    fn respects_disabled_backslash_escapes() {
        let dialect = Dialect::MySql {
            backslash_escapes: false,
        };
        assert_eq!(
            texts(r"SELECT 'a\'; SELECT 2", dialect),
            vec![r"SELECT 'a\'", "SELECT 2"]
        );
    }

    #[test]
    fn mysql_double_dash_needs_whitespace() {
        assert_eq!(
            texts("SELECT 1--1; SELECT 2", Dialect::MYSQL),
            vec!["SELECT 1--1", "SELECT 2"]
        );
        assert_eq!(
            texts("SELECT 1 --1; SELECT 2\n; SELECT 3", Dialect::POSTGRES),
            vec!["SELECT 1 --1; SELECT 2", "SELECT 3"]
        );
    }

    #[test]
    fn supports_mysql_delimiter_command() {
        let sql = "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END//\nDELIMITER ;\nCALL p();";
        assert_eq!(
            texts(sql, Dialect::MYSQL),
            vec![
                "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END",
                "CALL p()"
            ]
        );
    }

    #[test]
    fn supports_postgres_dollar_quotes_and_escape_strings() {
        let sql = "CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql;\nSELECT $$a;b$$, E'x\\';y', $1;";
        assert_eq!(
            texts(sql, Dialect::POSTGRES),
            vec![
                "CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql",
                "SELECT $$a;b$$, E'x\\';y', $1"
            ]
        );
    }

    #[test]
    fn postgres_block_comments_nest() {
        assert_eq!(
            texts("/* a /* b; */ c; */ SELECT 1; SELECT 2", Dialect::POSTGRES),
            vec!["/* a /* b; */ c; */ SELECT 1", "SELECT 2"]
        );
    }

    #[test]
    fn reports_utf16_offsets_of_trimmed_statements() {
        let sql = "SELECT '😀';\n  SELECT 2";
        let statements = split_statements(sql, Dialect::MYSQL);
        assert_eq!(statements[0].start, 0);
        assert_eq!(statements[0].end, 11);
        assert_eq!(statements[1].start, 15);
        assert_eq!(statements[1].end, 23);
    }

    #[test]
    fn classifies_reads_and_writes() {
        let reads = [
            "SELECT * FROM t",
            "select replace(name, 'a', 'b') from t",
            "SHOW CREATE TABLE t",
            "DESCRIBE t",
            "EXPLAIN SELECT 1",
            "WITH x AS (SELECT 1) SELECT * FROM x",
            "SET NAMES utf8mb4",
            "USE shop",
            "SELECT 'DELETE FROM t'",
            "SELECT updated_at FROM t",
        ];
        for sql in reads {
            assert!(!is_write(sql, Dialect::MYSQL), "{sql} should be a read");
        }
        let writes = [
            "INSERT INTO t VALUES (1)",
            "update t set a = 1",
            "DELETE FROM t",
            "DROP TABLE t",
            "CREATE TABLE t (a int)",
            "SELECT * INTO new_table FROM t",
            "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
            "EXPLAIN ANALYZE DELETE FROM t",
            "SET GLOBAL max_connections = 10",
            "TRUNCATE t",
            "CALL p()",
            "DO 1",
            "SELECT * FROM t FOR UPDATE",
        ];
        for sql in writes {
            assert!(is_write(sql, Dialect::POSTGRES), "{sql} should be a write");
        }
    }
}
