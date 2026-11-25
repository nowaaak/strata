mod edit;
mod lexer;
mod quote;
mod split;
mod table;

pub use edit::{CellValue, RowChange, change_statement};
pub use split::{SqlStatement, is_write, split_statements};
pub use table::{SortSpec, TableQuery, select_statement};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    MySql { backslash_escapes: bool },
    Postgres { standard_strings: bool },
}

impl Dialect {
    pub const MYSQL: Self = Self::MySql {
        backslash_escapes: true,
    };
    pub const POSTGRES: Self = Self::Postgres {
        standard_strings: true,
    };

    pub fn is_mysql(self) -> bool {
        matches!(self, Self::MySql { .. })
    }
}
