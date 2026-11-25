use super::Dialect;

pub(super) enum Token {
    Code,
    Word { start: usize, end: usize },
    Quoted,
    Comment,
    Whitespace,
}

pub(super) fn next_token(chars: &[char], at: usize, dialect: Dialect) -> (Token, usize) {
    let mysql = dialect.is_mysql();
    let c = chars[at];
    let next = chars.get(at + 1).copied();

    if c.is_whitespace() {
        let mut end = at + 1;
        while end < chars.len() && chars[end].is_whitespace() {
            end += 1;
        }
        return (Token::Whitespace, end);
    }
    if c == '-' && next == Some('-') {
        let after = chars.get(at + 2).copied();
        if !mysql || after.is_none_or(char::is_whitespace) {
            return (Token::Comment, line_end(chars, at));
        }
    }
    if c == '#' && mysql {
        return (Token::Comment, line_end(chars, at));
    }
    if c == '/' && next == Some('*') {
        return (Token::Comment, block_comment_end(chars, at, !mysql));
    }
    if c == '\'' || c == '"' {
        let backslash = match dialect {
            Dialect::MySql { backslash_escapes } => backslash_escapes,
            Dialect::Postgres { standard_strings } => {
                c == '\'' && (!standard_strings || is_escape_string_prefix(chars, at))
            }
        };
        return (Token::Quoted, quoted_end(chars, at, backslash));
    }
    if c == '`' && mysql {
        return (Token::Quoted, quoted_end(chars, at, false));
    }
    if c == '$'
        && !mysql
        && let Some(end) = dollar_quote_end(chars, at)
    {
        return (Token::Quoted, end);
    }
    if is_word_start(c) {
        let mut end = at + 1;
        while end < chars.len() && is_word_char(chars[end]) {
            end += 1;
        }
        return (Token::Word { start: at, end }, end);
    }
    (Token::Code, at + 1)
}

pub(super) fn line_end(chars: &[char], from: usize) -> usize {
    let mut end = from;
    while end < chars.len() && chars[end] != '\n' {
        end += 1;
    }
    end
}

fn block_comment_end(chars: &[char], from: usize, nested: bool) -> usize {
    let mut depth = 0usize;
    let mut i = from;
    while i < chars.len() {
        if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
            if depth == 0 || nested {
                depth += 1;
            }
            i += 2;
        } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
            depth -= 1;
            i += 2;
            if depth == 0 {
                return i;
            }
        } else {
            i += 1;
        }
    }
    chars.len()
}

fn quoted_end(chars: &[char], from: usize, backslash: bool) -> usize {
    let quote = chars[from];
    let mut i = from + 1;
    while i < chars.len() {
        let c = chars[i];
        if backslash && c == '\\' {
            i += 2;
        } else if c == quote {
            if chars.get(i + 1) == Some(&quote) {
                i += 2;
            } else {
                return i + 1;
            }
        } else {
            i += 1;
        }
    }
    chars.len()
}

fn is_escape_string_prefix(chars: &[char], quote_at: usize) -> bool {
    if quote_at == 0 || !matches!(chars[quote_at - 1], 'E' | 'e') {
        return false;
    }
    quote_at < 2 || !is_word_char(chars[quote_at - 2])
}

fn dollar_quote_end(chars: &[char], from: usize) -> Option<usize> {
    if from > 0 && is_word_char(chars[from - 1]) {
        return None;
    }
    let mut i = from + 1;
    if let Some(&first) = chars.get(i)
        && first != '$'
        && !is_word_start(first)
    {
        return None;
    }
    while i < chars.len() && chars[i] != '$' {
        if !is_word_char(chars[i]) {
            return None;
        }
        i += 1;
    }
    if i >= chars.len() {
        return None;
    }
    let tag = &chars[from..=i];
    let mut j = i + 1;
    while j + tag.len() <= chars.len() {
        if &chars[j..j + tag.len()] == tag {
            return Some(j + tag.len());
        }
        j += 1;
    }
    Some(chars.len())
}

fn is_word_start(c: char) -> bool {
    c.is_alphabetic() || c == '_'
}

pub(super) fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}
