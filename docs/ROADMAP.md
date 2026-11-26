# Roadmap

Effort: S is up to a day, M a few days, L a week or more.

## 1. Core database work

Goal: the everyday HeidiSQL tasks work without falling back to another tool.

| Item                                                             | Why                                                                      | Effort |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| Schema editor with generated `ALTER TABLE` and preview           | Adding a column or index is a common task and easy to get wrong by hand. | L      |
| Views, routines, triggers and events in the tree, with their DDL | The tree only shows tables and views.                                    | M      |
| Foreign key navigation from a cell to the referenced row         | Speeds up exploring related data.                                        | M      |
| Import CSV into a table with column mapping                      | Common data task, HeidiSQL has it.                                       | M      |
| SQL dump export of tables or a database                          | Backups and moving data between servers.                                 | L      |
| Export the full query result, not only the buffered rows         | Exports stop at the one million row buffer.                              | M      |
| SQL formatter in the editor                                      | Makes long queries readable.                                             | S      |
| Process list with kill                                           | Finding and stopping slow queries on a server.                           | S      |

## 2. Comfort

| Item                                                | Why                                          | Effort |
| --------------------------------------------------- | -------------------------------------------- | ------ |
| Drag and drop connections into groups               | Faster than the context menu.                | S      |
| Saved snippets                                      | Reuse frequent queries across connections.   | M      |
| `EXPLAIN` output as a readable plan                 | Understanding slow queries.                  | M      |
| Find and replace in result data                     | Bulk edits without writing `UPDATE` by hand. | M      |
| Keyboard shortcut settings                          | Personal muscle memory from other tools.     | M      |
| Translated database error messages for common cases | The raw server text is usually English.      | S      |

## 3. Later

| Item                          | Why                                                                             | Effort |
| ----------------------------- | ------------------------------------------------------------------------------- | ------ |
| SQLite support                | Local files without a server.                                                   | L      |
| ER diagram of a schema        | Overview of larger databases.                                                   | L      |
| User and privilege management | Admin tasks HeidiSQL covers.                                                    | L      |
| Server variables and status   | Tuning and diagnosis.                                                           | M      |
| Split the frontend bundle     | The bundle is about 1 MB. Fine locally, but it delays the first paint a little. | S      |
| macOS and Linux builds        | Only Windows has been run.                                                      | M      |

## Done

- First commit and a CI workflow (fmt, clippy, tests, typecheck, lint, bindings diff). It runs once the repository is on GitHub.
- Open tabs and SQL drafts survive a restart and a disconnect. They reattach when their connection opens again.
- Searchable query history per connection or across all connections (Ctrl+H), with reuse in the editor or a new tab. It can be turned off in the settings.
- Daily rotating log file in the app data folder, kept for 7 days, without SQL text or passwords.
- Installer build: `npm run tauri build` produces an MSI and an NSIS setup, and the release build was checked in the running app.
- Create, rename, empty and delete databases, PostgreSQL schemas, tables and views from the schema tree, with SQL preview, typed confirmation for deleting databases and an entry in the query history. Tested against MySQL, MariaDB and PostgreSQL.
- SSH tunnel per connection with password or key file, trust on first use for server keys and a hard stop on changed keys. Tested against MySQL and PostgreSQL, including TLS and query cancel through the tunnel.
- Verified against real servers: TLS in all three modes for MySQL, MariaDB and PostgreSQL, server side read-only sessions block inserts and DDL on all three, password prompt on connect, MariaDB through the UI, copy to clipboard. The native save dialog is still only exercised by hand.

## Known limitations

- `SELECT ... FOR UPDATE` and `SELECT ... INTO` count as writes. They trigger the confirmation and are blocked on read-only connections.
- For PostgreSQL Strata prepares each statement before running it to read column types. Inside an explicit transaction, a statement that fails to prepare aborts the transaction even if the simple protocol would have run it. This should be rare.
- A result keeps at most one million rows in memory.
