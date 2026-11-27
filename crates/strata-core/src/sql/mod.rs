mod ddl;
mod edit;
mod lexer;
mod quote;
mod split;
mod table;

pub use ddl::{DdlAction, ddl_statement};
pub(crate) use ddl::{name as identifier_name, target_names};
pub use edit::{CellValue, RowChange, change_statement};
pub(crate) use split::keywords;
pub use split::{SqlStatement, is_write, split_statements};
pub use table::{SortSpec, TableQuery, select_statement};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    MySql { backslash_escapes: bool },
    Postgres { standard_strings: bool },
    Sqlite,
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

    pub fn is_postgres(self) -> bool {
        matches!(self, Self::Postgres { .. })
    }

    pub fn is_sqlite(self) -> bool {
        matches!(self, Self::Sqlite)
    }
}
