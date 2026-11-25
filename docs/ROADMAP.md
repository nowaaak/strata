# Roadmap

Effort: S is up to a day, M a few days, L a week or more.

## 1. Stabilize (next)

Goal: Strata is safe to use every day and nothing gets lost.

| Item | Why | Effort |
| --- | --- | --- |
| First commit and CI (fmt, clippy, tests, typecheck, lint, bindings diff) | Nothing is under version control yet. CI keeps the checks honest. | S |
| Restore open tabs and SQL drafts after a restart | Closing the app currently loses every unsaved query. | M |
| Query history per connection, searchable | Finding an old statement again is a daily need. | M |
| Log file in the app data folder | Errors outside the UI leave no trace today. | S |
| Verify the untested paths: TLS against a TLS server, password prompt on connect, MariaDB through the UI, copy to clipboard, native save dialog | These run in code but were never exercised end to end. | S |
| Check that MySQL read-only sessions also block DDL | `SET SESSION TRANSACTION READ ONLY` may not stop `CREATE` or `DROP`. Strata's own write check covers it, the server side is unconfirmed. | S |
| Installer build with `npm run tauri build` | Only the dev build has been run so far. | S |

## 2. Core database work

Goal: the everyday HeidiSQL tasks work without falling back to another tool.

| Item | Why | Effort |
| --- | --- | --- |
| SSH tunnel per connection | Most remote databases are only reachable through SSH. | L |
| Create, rename, truncate and drop databases and tables, each with a confirmation and SQL preview | Today this needs hand written SQL. | M |
| Schema editor with generated `ALTER TABLE` and preview | Adding a column or index is a common task and easy to get wrong by hand. | L |
| Views, routines, triggers and events in the tree, with their DDL | The tree only shows tables and views. | M |
| Foreign key navigation from a cell to the referenced row | Speeds up exploring related data. | M |
| Import CSV into a table with column mapping | Common data task, HeidiSQL has it. | M |
| SQL dump export of tables or a database | Backups and moving data between servers. | L |
| Export the full query result, not only the buffered rows | Exports stop at the one million row buffer. | M |
| SQL formatter in the editor | Makes long queries readable. | S |
| Process list with kill | Finding and stopping slow queries on a server. | S |

## 3. Comfort

| Item | Why | Effort |
| --- | --- | --- |
| Drag and drop connections into groups | Faster than the context menu. | S |
| Saved snippets | Reuse frequent queries across connections. | M |
| `EXPLAIN` output as a readable plan | Understanding slow queries. | M |
| Find and replace in result data | Bulk edits without writing `UPDATE` by hand. | M |
| Keyboard shortcut settings | Personal muscle memory from other tools. | M |
| Translated database error messages for common cases | The raw server text is usually English. | S |

## 4. Later

| Item | Why | Effort |
| --- | --- | --- |
| SQLite support | Local files without a server. | L |
| ER diagram of a schema | Overview of larger databases. | L |
| User and privilege management | Admin tasks HeidiSQL covers. | L |
| Server variables and status | Tuning and diagnosis. | M |
| Split the frontend bundle | The bundle is about 1 MB. Fine locally, but it delays the first paint a little. | S |
| macOS and Linux builds | Only Windows has been run. | M |

## Known limitations

- `SELECT ... FOR UPDATE` and `SELECT ... INTO` count as writes. They trigger the confirmation and are blocked on read-only connections.
- For PostgreSQL Strata prepares each statement before running it to read column types. Inside an explicit transaction, a statement that fails to prepare aborts the transaction even if the simple protocol would have run it. This should be rare.
- A result keeps at most one million rows in memory.
