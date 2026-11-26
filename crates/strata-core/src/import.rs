use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::schema::TableTarget;
use crate::sql::{Dialect, identifier_name};
use crate::{CoreError, CoreResult};

pub const PREVIEW_ROWS: usize = 50;
pub const BATCH_ROWS: usize = 500;
const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const DELIMITERS: [char; 4] = [',', ';', '\t', '|'];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CsvOptions {
    pub delimiter: Option<String>,
    pub header: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CsvPreview {
    pub encoding: String,
    pub delimiter: String,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ColumnMapping {
    pub column: String,
    pub source: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CsvImport {
    pub path: String,
    pub options: CsvOptions,
    pub target: TableTarget,
    pub mapping: Vec<ColumnMapping>,
    pub empty_as_null: bool,
    pub decimal_comma: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportSummary {
    pub rows: u32,
}

pub struct ParsedCsv {
    pub encoding: &'static str,
    pub delimiter: char,
    pub records: Vec<Vec<String>>,
}

fn decode_windows_1252(bytes: &[u8]) -> String {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž',
        '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}',
        'ž', 'Ÿ',
    ];
    bytes
        .iter()
        .map(|&byte| match byte {
            0x80..=0x9f => HIGH[usize::from(byte - 0x80)],
            other => char::from(other),
        })
        .collect()
}

pub fn decode(bytes: &[u8]) -> (String, &'static str) {
    let bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_string(), "utf-8"),
        Err(_) => (decode_windows_1252(bytes), "windows-1252"),
    }
}

pub fn detect_delimiter(text: &str) -> char {
    let mut counts = [0usize; DELIMITERS.len()];
    let mut quoted = false;
    let mut lines = 0;
    for c in text.chars() {
        match c {
            '"' => quoted = !quoted,
            '\n' if !quoted => {
                lines += 1;
                if lines >= 5 {
                    break;
                }
            }
            _ if !quoted => {
                if let Some(index) = DELIMITERS.iter().position(|d| *d == c) {
                    counts[index] += 1;
                }
            }
            _ => {}
        }
    }
    counts
        .iter()
        .enumerate()
        .max_by_key(|(index, count)| (**count, usize::MAX - index))
        .filter(|(_, count)| **count > 0)
        .map_or(',', |(index, _)| DELIMITERS[index])
}

pub fn parse_records(text: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' if field.is_empty() => quoted = true,
            '\r' if chars.peek() == Some(&'\n') => {}
            '\n' | '\r' => {
                record.push(std::mem::take(&mut field));
                records.push(std::mem::take(&mut record));
            }
            c if c == delimiter => record.push(std::mem::take(&mut field)),
            c => field.push(c),
        }
    }
    if !field.is_empty() || !record.is_empty() {
        record.push(field);
        records.push(record);
    }
    records.retain(|record| !(record.len() == 1 && record[0].is_empty()));
    records
}

fn delimiter_option(options: &CsvOptions) -> CoreResult<Option<char>> {
    match options.delimiter.as_deref() {
        None | Some("") => Ok(None),
        Some(value) => {
            let mut chars = value.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Ok(Some(c)),
                _ => Err(CoreError::InvalidInput(
                    "the delimiter must be a single character".into(),
                )),
            }
        }
    }
}

pub fn read_csv(path: &Path, options: &CsvOptions) -> CoreResult<ParsedCsv> {
    let size = std::fs::metadata(path)
        .map_err(|err| CoreError::io(path, err))?
        .len();
    if size > MAX_FILE_BYTES {
        return Err(CoreError::InvalidInput(
            "the file is larger than 1 GB, split it before importing".into(),
        ));
    }
    let bytes = std::fs::read(path).map_err(|err| CoreError::io(path, err))?;
    let (text, encoding) = decode(&bytes);
    let delimiter = delimiter_option(options)?.unwrap_or_else(|| detect_delimiter(&text));
    Ok(ParsedCsv {
        encoding,
        delimiter,
        records: parse_records(&text, delimiter),
    })
}

pub fn preview(path: PathBuf, options: &CsvOptions) -> CoreResult<CsvPreview> {
    let parsed = read_csv(&path, options)?;
    let width = parsed
        .records
        .iter()
        .take(PREVIEW_ROWS + 1)
        .map(Vec::len)
        .max()
        .unwrap_or(0);
    let mut records = parsed.records.into_iter();
    let headers = if options.header {
        records.next().unwrap_or_default()
    } else {
        Vec::new()
    };
    let headers = (0..width.max(headers.len()))
        .map(|index| {
            headers
                .get(index)
                .filter(|name| !name.trim().is_empty())
                .cloned()
                .unwrap_or_else(|| format!("#{}", index + 1))
        })
        .collect();
    let rows: Vec<Vec<String>> = records.collect();
    Ok(CsvPreview {
        encoding: parsed.encoding.into(),
        delimiter: parsed.delimiter.to_string(),
        headers,
        total_rows: u32::try_from(rows.len()).unwrap_or(u32::MAX),
        rows: rows.into_iter().take(PREVIEW_ROWS).collect(),
    })
}

pub fn is_numeric_type(data_type: &str) -> bool {
    let lower = data_type.to_ascii_lowercase();
    [
        "int", "decimal", "numeric", "float", "double", "real", "money",
    ]
    .iter()
    .any(|word| lower.contains(word))
}

pub fn insert_statements(
    dialect: Dialect,
    import: &CsvImport,
    numeric: &[bool],
    records: &[Vec<String>],
) -> CoreResult<Vec<(usize, String)>> {
    if import.mapping.is_empty() {
        return Err(CoreError::InvalidInput(
            "map at least one column before importing".into(),
        ));
    }
    let columns = import
        .mapping
        .iter()
        .map(|mapping| identifier_name(&mapping.column).map(|name| dialect.quote_ident(name)))
        .collect::<CoreResult<Vec<_>>>()?
        .join(", ");
    let table = import.target.qualified(dialect);
    let value = |record: &Vec<String>, index: usize, mapping: &ColumnMapping| -> String {
        match record.get(mapping.source as usize) {
            None => "NULL".to_string(),
            Some(field) if field.is_empty() && import.empty_as_null => "NULL".to_string(),
            Some(field) => {
                if import.decimal_comma
                    && field.contains(',')
                    && numeric.get(index).copied().unwrap_or(false)
                {
                    dialect.quote_literal(&field.replace('.', "").replace(',', "."))
                } else {
                    dialect.quote_literal(field)
                }
            }
        }
    };
    Ok(records
        .chunks(BATCH_ROWS)
        .enumerate()
        .map(|(batch, chunk)| {
            let rows = chunk
                .iter()
                .map(|record| {
                    let values = import
                        .mapping
                        .iter()
                        .enumerate()
                        .map(|(index, mapping)| value(record, index, mapping))
                        .collect::<Vec<_>>()
                        .join(", ");
                    format!("({values})")
                })
                .collect::<Vec<_>>()
                .join(",\n");
            (
                batch * BATCH_ROWS,
                format!("INSERT INTO {table} ({columns}) VALUES\n{rows}"),
            )
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quotes_newlines_and_crlf() {
        let records = parse_records(
            "id;name;note\r\n1;\"Käse; mild\";\"zwei\nZeilen\"\r\n2;\"sagt \"\"hallo\"\"\";\r\n\r\n",
            ';',
        );
        assert_eq!(
            records,
            vec![
                vec!["id", "name", "note"],
                vec!["1", "Käse; mild", "zwei\nZeilen"],
                vec!["2", "sagt \"hallo\"", ""],
            ]
        );
    }

    #[test]
    fn detects_delimiters_outside_quotes() {
        assert_eq!(detect_delimiter("a;b;c\n1;2;3\n"), ';');
        assert_eq!(detect_delimiter("\"a,b\"\t\"c,d\"\n1\t2\n"), '\t');
        assert_eq!(detect_delimiter("a,b\n1,2\n"), ',');
        assert_eq!(detect_delimiter("single\n"), ',');
    }

    #[test]
    fn decodes_utf8_bom_and_windows_1252() {
        assert_eq!(decode(b"\xef\xbb\xbfK\xc3\xa4se"), ("Käse".into(), "utf-8"));
        assert_eq!(
            decode(b"K\xe4se \x80 \x84Gru\xdf\x93"),
            ("Käse € „Gruß“".into(), "windows-1252")
        );
    }

    fn import(mapping: Vec<(&str, u32)>, empty_as_null: bool, decimal_comma: bool) -> CsvImport {
        CsvImport {
            path: String::new(),
            options: CsvOptions {
                delimiter: None,
                header: true,
            },
            target: TableTarget {
                database: "shop".into(),
                schema: None,
                table: "orders".into(),
            },
            mapping: mapping
                .into_iter()
                .map(|(column, source)| ColumnMapping {
                    column: column.into(),
                    source,
                })
                .collect(),
            empty_as_null,
            decimal_comma,
        }
    }

    #[test]
    fn builds_batched_inserts_with_quoting() {
        let records = vec![
            vec!["1".into(), "it's".into(), "1.234,5".into()],
            vec!["2".into(), String::new()],
            vec!["3".into(), "x".into(), "1.5".into()],
        ];
        let statements = insert_statements(
            Dialect::MYSQL,
            &import(vec![("id", 0), ("name", 1), ("price", 2)], true, true),
            &[true, false, true],
            &records,
        )
        .unwrap();
        assert_eq!(
            statements,
            vec![(
                0,
                "INSERT INTO `shop`.`orders` (`id`, `name`, `price`) VALUES\n('1', 'it''s', '1234.5'),\n('2', NULL, NULL),\n('3', 'x', '1.5')".into()
            )]
        );
        let many: Vec<Vec<String>> = (0..1001).map(|i| vec![i.to_string()]).collect();
        let batches = insert_statements(
            Dialect::POSTGRES,
            &import(vec![("id", 0)], false, false),
            &[true],
            &many,
        )
        .unwrap();
        assert_eq!(batches.len(), 3);
        assert_eq!(batches[2].0, 1000);
    }

    #[test]
    fn keeps_empty_strings_when_asked() {
        let statements = insert_statements(
            Dialect::POSTGRES,
            &import(vec![("name", 0)], false, false),
            &[false],
            &[vec![String::new()]],
        )
        .unwrap();
        assert!(statements[0].1.ends_with("('')"));
        let empty = insert_statements(Dialect::POSTGRES, &import(vec![], false, false), &[], &[]);
        assert_eq!(empty.unwrap_err().kind(), "invalid_input");
    }
}
