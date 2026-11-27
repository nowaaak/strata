# Strata

A fast, modern desktop client for MySQL, MariaDB, PostgreSQL and SQLite. Built with Tauri 2, Rust and React.

## Features

- Connection profiles in collapsible groups (drag and drop to move them), with color tags, TLS and a safety level per connection: normal, confirm before writing, or read-only (enforced by Strata and by the server session)
- Passwords live in the system password store (Windows Credential Manager, macOS Keychain, Secret Service on Linux), or are asked for on every connect
- SQLite files: open an existing file or create a new one, with foreign keys switched on. Process list, server databases and schema changes that SQLite cannot do in place are left out
- SSH tunnel per connection with password or key file (with optional passphrase). The server key is confirmed on first use and a changed key blocks the connection
- Schema tree with databases, PostgreSQL schemas, tables and views, plus functions, procedures, triggers, events (MySQL, MariaDB) and sequences (PostgreSQL). A click opens their DDL in a new query, and they can be deleted from the context menu
- SQL editor with syntax highlighting, schema-aware autocomplete, run statement at cursor (Ctrl+Enter) or the whole script (Ctrl+Shift+Enter), cancel (Ctrl+.), the error position marked in the text and a SQL formatter for the selection or the whole script (Shift+Alt+F)
- Virtualized result grid that streams up to one million rows, range selection, copy as TSV, resizable columns
- Table view with WHERE filter, sorting, row limit, structure and DDL
- Inline editing with insert and delete. Changes are previewed as SQL and saved in one transaction that rolls back unless every statement hits exactly one row
- JSON in the cell editor: highlighted, formatted or compact, checked while typing. Numbers and strings are never rewritten, and a value stored compact is saved compact again
- Process list per connection with auto refresh, cancel a running query or end a connection
- Server variables and status values per connection, searchable, with changed PostgreSQL settings marked. Variables can be changed with `SET GLOBAL` or `SET PERSIST` (MySQL) and `ALTER SYSTEM` (PostgreSQL), settings that need a restart are marked
- Users and privileges: create, lock and delete users or roles, change passwords, PostgreSQL role attributes and memberships, and grant or revoke privileges globally, per database, schema or table. Passwords are masked in the SQL preview, the history and the log
- Table designer: add, rename, retype, reorder (MySQL, MariaDB) and drop columns, change NULL, defaults, auto increment and comments, change the primary key, add and drop indexes and foreign keys (also to tables in another schema or database), or create a new table with its primary key. Everything is shown as SQL before it runs
- Create, rename, empty and delete databases, PostgreSQL schemas, tables and views from the schema tree. Every change shows the exact SQL first, deleting a database asks for its name, and a new table starts from a SQL template
- Export to CSV and JSON, either the loaded rows or the complete result streamed straight to the file, with progress and cancel
- CSV import into a table with column mapping, delimiter and encoding detection (UTF-8, Windows-1252), decimal comma conversion and one transaction for all rows
- Foreign key navigation: right click a cell to open the referenced row
- Command palette (Ctrl+K) for tables, connections and actions
- ER diagram of a database or schema with keys and foreign keys, search, a compact key view, drag, zoom and a minimap. A double click opens the table
- Saved snippets (Ctrl+Shift+S), insertable from the palette into any query
- Execution plans as a readable tree with warnings for full scans, filesorts and misestimates, plus ANALYZE on PostgreSQL
- Find and replace in table data as reviewable pending changes
- SQL dump of a database or schema with structure, data, routines and triggers, which loads again with Strata or the command line client
- Plain language explanations for common database errors, independent of the server language
- Configurable keyboard shortcuts in the settings
- Searchable query history (Ctrl+H) and tabs with SQL drafts that survive a restart
- Settings (Ctrl+,): theme, accent color, interface zoom, editor font size and line wrapping, grid row height, default row limit, German or English interface

## Development

Requirements: Rust 1.99, Node 26, Docker for the integration tests.

```sh
npm install
npm run app
```

`npm run app` starts "Strata Dev" with the identifier `nd.strata.dev`. It has its own data folder and its own entries in the system password store, so development never touches the connections of the installed app. A debug build refuses to start with the release identifier, so plain `npm run tauri dev` fails on purpose.

## Releases

The installed app checks GitHub Releases for updates every six hours and on demand in Settings, About. Updates are signed, and the app only installs a build whose signature matches the public key in `src-tauri/tauri.conf.json`.

To publish a version:

1. Raise `version` in `package.json`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin master v0.2.0`.

The release workflow checks that the tag matches the version and builds Windows, macOS (Apple silicon and Intel) and Linux in parallel into a draft release. Each build signs its update and adds itself to `latest.json`. A last job publishes the release only when every platform succeeded, so the updater never sees a half finished `latest.json`. It needs the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

The first install uses the setup `.exe` on Windows, the `.dmg` on macOS and the `.AppImage`, `.deb` or `.rpm` on Linux. Only the AppImage updates itself on Linux, `.deb` and `.rpm` are updated by installing the new package.

The macOS builds are not signed with an Apple developer certificate. On the first start macOS blocks the app, open it with right click, Open, or allow it in System Settings, Privacy & Security. Updates are still verified with the Strata update key.

## Checks

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run typecheck
npm run lint
npm run format:check
npm test
```

Integration tests run against real servers:

```sh
docker compose -f docker-compose.test.yml up -d --wait
cargo test -p strata-core --tests -- --ignored
docker compose -f docker-compose.test.yml down -v
```

`npm run bindings` regenerates the TypeScript types in `src/bindings` from the Rust sources.

See [docs/architecture.md](docs/architecture.md) for the structure.
