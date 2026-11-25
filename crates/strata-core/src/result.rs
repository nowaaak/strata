use std::sync::RwLock;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::driver::{ColumnMeta, Row};

pub struct ResultSet {
    columns: Vec<ColumnMeta>,
    rows: RwLock<Vec<Row>>,
    truncated: AtomicBool,
}

impl ResultSet {
    pub fn new(columns: Vec<ColumnMeta>) -> Self {
        Self {
            columns,
            rows: RwLock::new(Vec::new()),
            truncated: AtomicBool::new(false),
        }
    }

    pub fn columns(&self) -> &[ColumnMeta] {
        &self.columns
    }

    pub fn append(&self, rows: &mut Vec<Row>) {
        self.write().append(rows);
    }

    pub fn len(&self) -> usize {
        self.read().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn slice(&self, offset: usize, limit: usize) -> Vec<Row> {
        let rows = self.read();
        let start = offset.min(rows.len());
        let end = start.saturating_add(limit).min(rows.len());
        rows[start..end].to_vec()
    }

    pub fn with_rows<T>(&self, f: impl FnOnce(&[Row]) -> T) -> T {
        f(&self.read())
    }

    pub fn mark_truncated(&self) {
        self.truncated.store(true, Ordering::Relaxed);
    }

    pub fn is_truncated(&self) -> bool {
        self.truncated.load(Ordering::Relaxed)
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, Vec<Row>> {
        self.rows
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write(&self) -> std::sync::RwLockWriteGuard<'_, Vec<Row>> {
        self.rows
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slices_are_clamped_to_available_rows() {
        let set = ResultSet::new(Vec::new());
        let mut rows: Vec<Row> = (0..5).map(|i| vec![Some(i.to_string())]).collect();
        set.append(&mut rows);
        assert!(rows.is_empty());
        assert_eq!(set.len(), 5);
        assert_eq!(set.slice(3, 10).len(), 2);
        assert!(set.slice(10, 10).is_empty());
        assert_eq!(set.slice(1, 1), vec![vec![Some("1".to_string())]]);
    }
}
