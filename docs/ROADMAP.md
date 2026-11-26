# Roadmap

Effort: S is up to a day, M a few days, L a week or more.

## 1. Core database work

Goal: the everyday HeidiSQL tasks work without falling back to another tool.

| Item                                                             | Why                                         | Effort |
| ---------------------------------------------------------------- | ------------------------------------------- | ------ |
| Views, routines, triggers and events in the tree, with their DDL | The tree only shows tables and views.       | M      |
| Foreign key navigation from a cell to the referenced row         | Speeds up exploring related data.           | M      |
| Import CSV into a table with column mapping                      | Common data task, HeidiSQL has it.          | M      |
| SQL dump export of tables or a database                          | Backups and moving data between servers.    | L      |
| Export the full query result, not only the buffered rows         | Exports stop at the one million row buffer. | M      |

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

| Item                                                                            | Why                                                                             | Effort |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| Table designer: change the primary key, column order, comments and foreign keys | The first version covers columns, defaults and plain indexes.                   | M      |
| SQLite support                                                                  | Local files without a server.                                                   | L      |
| ER diagram of a schema                                                          | Overview of larger databases.                                                   | L      |
| User and privilege management                                                   | Admin tasks HeidiSQL covers.                                                    | L      |
| Server variables and status                                                     | Tuning and diagnosis.                                                           | M      |
| Split the frontend bundle                                                       | The bundle is about 1 MB. Fine locally, but it delays the first paint a little. | S      |
| macOS and Linux builds                                                          | Only Windows has been run.                                                      | M      |

## Done

- Table designer for columns, defaults, auto increment and indexes, and for new tables with a primary key. MySQL keeps collation, comment and `ON UPDATE`, PostgreSQL runs everything in one transaction. Tested against MySQL, MariaDB and PostgreSQL 17 and 18.
- SQL formatter (Shift+Alt+F), process list with cancel and end connection, and a JSON view in the cell editor that never rewrites numbers or strings.
- Integration tests also run against PostgreSQL 18.
- Command durations in the log, to find slow steps in the installed app.
- CI workflow on GitHub (fmt, clippy, tests, typecheck, lint, bindings diff) and a release workflow for signed Windows builds.
- Open tabs and SQL drafts survive a restart and a disconnect. They reattach when their connection opens again.
- Searchable query history per connection or across all connections (Ctrl+H), with reuse in the editor or a new tab. It can be turned off in the settings.
- Daily rotating log file in the app data folder, kept for 7 days, without SQL text or passwords.
- Separate dev app ("Strata Dev", own data and credentials) and signed self updates of the installed app through GitHub Releases.
- Installer build: `npm run tauri build` produces an MSI and an NSIS setup, and the release build was checked in the running app.
- Create, rename, empty and delete databases, PostgreSQL schemas, tables and views from the schema tree, with SQL preview, typed confirmation for deleting databases and an entry in the query history. Tested against MySQL, MariaDB and PostgreSQL.
- SSH tunnel per connection with password or key file, trust on first use for server keys and a hard stop on changed keys. Tested against MySQL and PostgreSQL, including TLS and query cancel through the tunnel.
- Verified against real servers: TLS in all three modes for MySQL, MariaDB and PostgreSQL, server side read-only sessions block inserts and DDL on all three, password prompt on connect, MariaDB through the UI, copy to clipboard. The native save dialog is still only exercised by hand.

## Known limitations

- `SELECT ... FOR UPDATE` and `SELECT ... INTO` count as writes. They trigger the confirmation and are blocked on read-only connections.
- For PostgreSQL Strata prepares each statement before running it to read column types. Inside an explicit transaction, a statement that fails to prepare aborts the transaction even if the simple protocol would have run it. This should be rare.
- A result keeps at most one million rows in memory.
