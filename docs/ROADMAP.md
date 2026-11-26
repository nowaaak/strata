# Roadmap

Effort: S is up to a day, M a few days, L a week or more.

## Later

| Item                          | Why                           | Effort |
| ----------------------------- | ----------------------------- | ------ |
| SQLite support                | Local files without a server. | L      |
| ER diagram of a schema        | Overview of larger databases. | L      |
| User and privilege management | Admin tasks HeidiSQL covers.  | L      |
| macOS and Linux builds        | Only Windows has been run.    | M      |

## Done

- Routines, events and triggers in the SQL dump, table designer with primary key, column order (MySQL, MariaDB), comments and foreign keys, server variables and status, and a split frontend bundle. Tested against MySQL, MariaDB and PostgreSQL 17 and 18.
- SQL dump with restore tested on MySQL, MariaDB and PostgreSQL, error explanations by error code, drag and drop into groups, snippets, execution plans, find and replace in table data and configurable shortcuts.
- Functions, procedures, triggers, events and sequences in the schema tree with DDL and delete, foreign key navigation from a cell, full export without the row buffer limit, and CSV import with column mapping. Tested against MySQL, MariaDB and PostgreSQL 17 and 18.
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
