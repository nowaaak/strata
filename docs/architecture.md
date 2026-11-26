# Architecture

Strata is a desktop database client built with Tauri 2, a Rust backend and a React frontend. Its look and project conventions follow Orrery.

## Layers

- `crates/strata-core` holds all logic: drivers, sessions, SQL handling, schema queries, profiles, secrets, export and settings. It has no Tauri dependency, so it can be tested on its own.
- `src-tauri` is a thin shell. It registers commands, maps `CoreError` to `CommandError { kind, message }` and manages state. Commands live in one file per domain under `src-tauri/src/commands/`.
- `src` is the React frontend. `src/api` wraps `invoke()` with one typed module per domain. `src/features/<domain>` holds components, hooks, stores and tests.

## Types across the boundary

Rust types that cross IPC derive `ts_rs::TS` with `#[ts(export)]`. `npm run bindings` writes them to `src/bindings`. The folder is generated. Never edit it by hand.

`CoreError::kind()` returns stable strings such as `database`, `connection` or `read_only`. The frontend turns them into German messages in `src/api/errors.ts`.

## Drivers

Both drivers use the text protocol: `query_iter` for MySQL and MariaDB, `simple_query_raw` for PostgreSQL. Every value therefore arrives exactly as the server formats it. `DECIMAL`, 64 bit integers, dates with time zones, JSON and arrays never pass through a lossy numeric or date type, and JavaScript never sees a number that exceeds 53 bits.

PostgreSQL's simple protocol does not report column types. Strata prepares the statement first to read the types for alignment and labels. A failed prepare is ignored because the real execution reports the error anyway.

MySQL connections use `CLIENT_FOUND_ROWS`, so an `UPDATE` reports matched rows instead of changed rows. The edit transaction relies on that.

`sql_mode` (`NO_BACKSLASH_ESCAPES`) and `standard_conforming_strings` are read on connect. String literals are escaped to match.

## Sessions and tabs

A session is one open connection profile. It keeps metadata connections for the schema tree (one for MySQL, one per database for PostgreSQL, because a PostgreSQL connection is bound to one database). A lost metadata connection is reopened once automatically.

Every tab gets its own connection, so transactions, `USE` and session variables stay inside the tab and a cancel only hits that tab. A tab runs one execution at a time. A second request gets `busy`.

Cancel uses `KILL QUERY` over a second connection for MySQL and the cancel token for PostgreSQL. Remaining statements of a script are skipped.

## Results

Rows stay in Rust memory (`ResultSet`). They are streamed into the buffer in batches and the frontend is told about progress over a Tauri channel. The grid asks for the rows it shows with `fetch_rows`, 250 rows per page. This keeps the WebView light even for one million rows, which is the cap per result.

The table view asks the server for `limit + 1` rows and keeps `limit`. A truncated result therefore means that more rows exist.

## Statement splitting and write detection

`sql::split_statements` is a small lexer instead of a full parser, so vendor syntax never breaks splitting. It handles quotes, backslash escapes per dialect, MySQL comments and `DELIMITER`, nested PostgreSQL block comments, dollar quoting and `E''` strings. Offsets are UTF-16 code units, which is what the editor uses.

`sql::is_write` is deliberately conservative. Statements starting with `SHOW`, `DESCRIBE`, `HELP` or `USE` are reads. `SELECT`, `WITH`, `EXPLAIN`, `VALUES` and `TABLE` are reads unless a write keyword appears outside strings and function calls (`SELECT ... FOR UPDATE` and `SELECT ... INTO` count as writes). Everything else is a write.

Read-only profiles are enforced twice: Strata refuses write statements, and the server session is read-only (`SET SESSION TRANSACTION READ ONLY` for MySQL, `default_transaction_read_only` for PostgreSQL). The "confirm" level only asks in the UI. Integration tests confirm that MySQL, MariaDB and PostgreSQL refuse `INSERT`, `CREATE`, `ALTER`, `TRUNCATE` and `DROP` in such a session.

## TLS

`Required` encrypts without verifying the certificate, like libpq's `require`. It is meant for servers with self-signed certificates. `VerifyFull` checks the certificate chain and host name against the Windows certificate store. Both use `native-tls`, so Windows trust settings apply. PostgreSQL errors include their cause chain, so a server without TLS reports "server does not support TLS" instead of a bare handshake error.

## SSH tunnel

A profile can carry an `SshConfig`. `strata_core::ssh` uses `russh` with the `ring` backend, so no OpenSSL or system `ssh` is needed. On connect Strata opens the SSH session, binds a listener on `127.0.0.1` with a random port and forwards every accepted socket through a `direct-tcpip` channel to the database host and port as seen from the SSH server. The driver then connects to the local port. For TLS the original host name is still passed to the driver (`tls_server_name`), so certificate host name checks use the real host and not `127.0.0.1`. `Required` through the tunnel is covered by the integration tests. The tunnel lives inside the session and closes with it. If the SSH connection drops, the next socket reconnects it.

Host keys follow trust on first use. The profile stores the SHA256 fingerprint of the trusted key. Without one the connect fails with `ssh_host_key_unknown` and the fingerprint in `detail`, and the UI asks the user to trust it. A different key fails with `ssh_host_key_changed` and is never accepted automatically. The user has to forget the stored key in the connection dialog first. Changing the SSH host or port in the dialog also forgets it.

The SSH password or key passphrase is a second keyring entry (`{profile id}#ssh`), separate from the database password. Key files are read from disk on every connect and never copied. Integration tests in `crates/strata-core/tests/ssh.rs` run against the `ssh` service from `docker-compose.test.yml`.

## Structure changes

`DdlAction` describes one change: create, rename or drop a database or PostgreSQL schema, rename or drop a table or view, or truncate a table. `sql::ddl_statement` turns it into exactly one statement with quoted identifiers and rejects empty names, names with leading or trailing spaces and control characters. The dialog asks the backend for this statement as a preview, and `run_ddl` generates it again from the same action, so the SQL shown is the SQL that runs. MySQL cannot rename databases and has no schemas inside a database, so those actions fail with `invalid_input`.

Changes run on the metadata connection, never in a tab, so they cannot end up inside an open transaction of a query tab. Read-only profiles are refused before anything is sent. PostgreSQL cannot drop or rename a database while it is in use, so Strata first closes its own idle connections to that database and runs the statement from another one: the session database, or `postgres` (`template1` when the target is `postgres`). Connections of other clients still block it, and the server error says so. Every change is written to the query history.

New tables are created in the table designer. A `CREATE TABLE` template in a query tab stays available for everything the designer does not cover.

## Table designer

`design.rs` reads the full column and index definitions (`table_design`) and turns a list of `AlterOp`s or a `NewTable` into SQL. The backend reads the current structure itself for every preview and run, so the frontend only describes what changes.

MySQL and MariaDB need the complete column definition in `CHANGE COLUMN`. Anything left out is reset silently, so Strata adds the current collation (for text types), `ON UPDATE`, `AUTO_INCREMENT` and the comment from `information_schema`. A default the user did not touch is `DefaultValue::Keep` and is rebuilt from the catalog: MariaDB reports defaults as SQL and they are reused as they are, MySQL reports plain literals (quoted again) and, for expression defaults, backslash escaped text that is unescaped and wrapped in parentheses. Text defaults on `TEXT`, `BLOB`, `JSON` and geometry columns are written as `('value')`, because MySQL only accepts expressions there. All MySQL changes go into one `ALTER TABLE`.

On PostgreSQL only what changed is emitted (rename, `TYPE ... USING col::type`, `SET`/`DROP NOT NULL`, `SET`/`DROP DEFAULT`, identity) and all statements run in one transaction on the metadata connection, so a failing step changes nothing. Indexes backed by a constraint are dropped with `DROP CONSTRAINT`.

The primary key is set with the PK column. When its columns change, the old key is dropped and `ADD PRIMARY KEY` follows, and the primary index can no longer be deleted from the index list, so both ways cannot collide. Renaming a key column alone keeps the key. Comments go inline on MySQL and as `COMMENT ON COLUMN` on PostgreSQL. An empty comment removes it. Foreign keys are listed with their `ON DELETE` and `ON UPDATE` rules, dropped first and added last, and always point to a table in the same database or schema.

Only MySQL and MariaDB can reorder columns. The frontend sends the column operations in the new order and gives a column a position (`FIRST` or `AFTER`) when its predecessor differs from the original one, also when the original predecessor is dropped. Both servers apply the clauses of one `ALTER TABLE` in order and resolve `AFTER` against the names after renames and against columns added by an earlier clause, so the result is the order shown in the designer. Each placed column stays next to its predecessor, because a later move only inserts a column after its own predecessor.

Data types and default expressions are SQL fragments by design. They are rejected when they contain `;` or comment markers. Generated columns can only be dropped, and expression or partial indexes only deleted. Every change is written to the query history.

## Routines, triggers, events and sequences

`routines.rs` lists functions and procedures (`information_schema.ROUTINES`, `pg_proc` without extension members), triggers, MySQL events and PostgreSQL sequences in one query per schema. DDL comes from `SHOW CREATE ...` on MySQL and from `pg_get_functiondef`, `pg_get_triggerdef` and `pg_sequences` on PostgreSQL. PostgreSQL functions can be overloaded, so they are identified by name plus `pg_get_function_identity_arguments`, both for the DDL lookup and for `DROP FUNCTION name(args)`. The arguments come from the server but still pass the same fragment check as other SQL pieces.

## Foreign key navigation

`describe_table` also returns the foreign keys of a table, with their target table and columns. The grid marks those columns and offers "go to" in the cell context menu. The filter for the target table is built in the backend by `equality_filter`, so values are quoted with the rules of the session (backslash escapes, standard strings). The table tab then opens or refreshes with that filter.

## Full export

A full export runs the statement again on its own connection and streams every row into the file through a `RowSink`, so the one million row buffer does not apply and memory stays flat. Only a single reading statement is accepted, because the statement runs a second time. The file is written to `<name>.tmp` and renamed at the end. Cancelling sets a flag that stops the sink and sends a server side cancel, and the partial file is removed.

## CSV import

`import.rs` reads the file, strips a UTF-8 BOM and falls back to Windows-1252 when the bytes are not valid UTF-8, which is what Excel writes on German Windows. The delimiter is detected from the first lines outside quotes. The parser follows RFC 4180 (quotes, doubled quotes, line breaks inside fields). Rows are inserted in batches of 500 as literal values quoted for the session dialect, all inside one transaction on a separate connection. If a batch fails, everything is rolled back and the error names the row range. Empty fields can become NULL, and in number columns a decimal comma (`1.234,5`) can be converted. The conversion only touches values that contain a comma, so `1.5` stays `1.5`.

## SQL dump

`Session::dump` writes the selected tables and views of a database (MySQL, MariaDB) or schema (PostgreSQL) into one SQL file, streamed through a temporary file and renamed at the end, with progress and cancel like the full export. Data is written as batched `INSERT` statements with literals quoted for the dialect. MySQL binary values are written as hex literals.

On MySQL the DDL comes from `SHOW CREATE TABLE` on a connection whose current database is the dumped one, because MySQL then leaves out the database name. Otherwise view definitions would point back to the source database. The `DEFINER` clause is removed so the file loads as another user. Foreign key checks are switched off while loading.

On PostgreSQL the table DDL is built like the DDL tab, but foreign keys are written as `ALTER TABLE ... ADD CONSTRAINT` at the end of the file, so the table order does not matter. Sequences of `serial` columns are created before their table and attached with `OWNED BY`, and after the data every serial or identity sequence is set to the highest value, so new rows continue after the restored ones. On PostgreSQL the file starts with `SET check_function_bodies = false` and the functions and procedures of the schema follow right after the header, so table defaults and views can use them and SQL functions may reference tables that come later. On MySQL routines and events come after the tables and before the views, inside a `DELIMITER ;;` block, because views check the functions they call. Triggers of the selected tables are written after all data, so restoring does not fire them. With "drop existing" MySQL routines get `DROP ... IF EXISTS`, PostgreSQL functions rely on `CREATE OR REPLACE`. Standalone PostgreSQL sequences are not dumped.

## Execution plans

`explain` runs `EXPLAIN FORMAT=JSON` (MySQL, MariaDB) or `EXPLAIN (FORMAT JSON)` (PostgreSQL) for exactly one statement on a separate connection. `ANALYZE` actually runs the statement, so it is only offered for reading statements on PostgreSQL. The frontend turns both JSON formats into one tree and marks full scans of at least 1000 rows, filesorts, temporary tables, on disk sorts and estimates that are off by a factor of ten or more.

## Error explanations

PostgreSQL errors carry their SQLSTATE in the message (`ERROR 42P01: ...`), MySQL and MariaDB errors their error number (`ERROR 1146 (42S02): ...`). `lib/dbErrors.ts` maps these codes, and a few connection error patterns, to a plain language explanation that is shown above the original message. Because the codes do not depend on the server language, this also works with a German PostgreSQL.

## Snippets and shortcuts

Snippets live in `snippets.json` in the app data folder and are global, not bound to a connection. Shortcuts are stored as overrides in the settings and merged with the defaults in `lib/shortcuts.ts`. A combination needs Ctrl or Alt, or a function key, and may not be used by another action. The SQL editor rebuilds its keymap through a CodeMirror compartment when the shortcuts change.

## Server variables and status

`server_info` reads `SHOW GLOBAL VARIABLES` and `SHOW GLOBAL STATUS` on MySQL and MariaDB. On PostgreSQL variables come from `pg_settings` with category and description, and a setting counts as changed when its source is neither the default nor a value Strata or the server set for its own connection. PostgreSQL has no status list like MySQL, so Strata builds one from the version, uptime, connections and `pg_stat_database` of the current database. The view is read only.

## Process list

`list_processes` reads `information_schema.PROCESSLIST` on MySQL and MariaDB and `pg_stat_activity` (client backends only) on PostgreSQL, through the metadata connection. That connection marks itself as `own`, so the UI can label it and refuse to stop it. `kill_process` only accepts a numeric id and builds `KILL QUERY`, `KILL CONNECTION`, `pg_cancel_backend` or `pg_terminate_backend` from it. Read-only profiles can view the list but not stop anything. On PostgreSQL a `false` result means the process was not stopped and becomes an error. An interrupted `SLEEP()` ends without an error on MySQL and with error 1317 on MariaDB, both count as stopped.

## SQL formatting and JSON values

The editor formats with `sql-formatter` in the dialect of the session (MySQL, MariaDB or PostgreSQL): uppercase keywords and data types, four spaces. Without a selection it formats the whole script, otherwise only the selection, as one undoable change.

JSON in the cell editor is never passed through `JSON.parse` and `JSON.stringify` for display or saving, because that would round large integers and drop trailing zeros such as `1.10`. `lib/json.ts` reformats on the token level and copies numbers, strings and escapes verbatim. `JSON.parse` only checks validity. A value that was stored on one line is saved on one line again, and a value whose JSON did not change counts as unchanged. JSON columns block invalid JSON, text columns only warn.

## Editing

Edits are only possible when the table has a primary key or a unique key without nullable columns. Rows are identified by the original key values. The backend validates that every change uses exactly that key, generates literal SQL with dialect escaping and runs everything in one transaction. Each statement must affect exactly one row, otherwise everything is rolled back. The SQL shown in the review dialog is the SQL that runs.

The table filter is user SQL by design. It is placed on its own lines, so a trailing `--` comment cannot swallow `ORDER BY` or `LIMIT`. The final statement must split into exactly one read statement, which blocks attempts to append further statements.

## Settings, profiles and secrets

Settings and profiles are JSON files in the app local data directory. Writes go to a temporary file first and are then renamed, so a crash cannot leave a half written file. Passwords never touch these files. They are stored with `keyring` in the Windows Credential Manager under the app identifier.

## Settings and language

Settings are validated in the backend (zoom 70 to 150 percent, editor font 10 to 24 px, row limit up to one million). Out of range values in an existing file are repaired on load instead of failing the start.

Accent colors are CSS variable overrides selected by `data-accent` on the root element, tuned separately for light and dark. Light accents in dark mode switch the button text to dark for contrast. Zoom uses the WebView zoom, so pixel based sizes such as grid rows scale too.

All interface text lives in `src/i18n/modules`. The English messages are typed against the German ones, so a missing key fails the type check. A test also compares the key structure, which covers dynamic tables like the error messages. Components call `useT()`, code outside React calls `getT()`. Query tab titles are derived from a stored number at render time so they follow a language switch. Backend error messages stay English and are shown after a translated explanation.

## Connection groups

A group is an optional name on the profile, not a separate entity. Renaming or dissolving a group rewrites the profiles in one atomic file write. Collapsed groups are a per user convenience kept in `localStorage`.

## Workspace persistence

Open tabs, SQL drafts, the active tab and the query counter are saved to `workspace.json` in the app data folder, 400 ms after the last change and whenever the window loses focus or unloads. A file is used instead of `localStorage` because drafts can be large. Saving only starts after the file was loaded, so a failed load can never overwrite it. An unreadable file is renamed to `workspace.json.corrupt` and the app starts empty.

Tabs store the profile, not the session. After a restart or a disconnect they are detached, show their draft read-only and offer to connect. When the profile connects, every tab of that profile is attached to the new session, and no extra query tab is opened.

## Query history

The backend records every editor execution after it finished, so a crash in the UI cannot lose entries and table views do not pollute the history. Entries hold the SQL, database, duration, status, row counts and the first error, truncated to 500 characters. Running the newest statement of a connection again only bumps its run counter.

The file `history.jsonl` is append only: one JSON line per entry or deletion. A torn last line after a crash is skipped on load. The file is compacted when obsolete lines outnumber live entries, and only the newest 5,000 entries are kept. SQL larger than 100 KB is not recorded. History can be disabled in the settings, because SQL is stored unencrypted.

## Channels and updates

A debug build is the dev channel, a release build is the release channel. The dev channel must run with an identifier ending in `.dev` (`src-tauri/tauri.dev.conf.json`), otherwise setup fails before any file is touched. Because the data folder and the keyring service both derive from the identifier, the dev and the installed app never share profiles, passwords, history or tabs.

Updates use `tauri-plugin-updater` from Rust. `check_for_update` asks the endpoint in `tauri.conf.json` and keeps the found update in memory. `install_update` downloads it, reports progress through the `update:progress` event, runs the NSIS installer in passive mode and restarts. The dev channel never checks or installs updates. The install button is disabled while a query runs.

## Logging

Logs go to stdout and to a daily rotating file in the app log folder, seven files are kept. Commands log their outcome with counts and durations, never SQL text or passwords. Database errors are logged by kind only, because servers often quote parts of the statement in their message. Connecting, testing, the schema tree, table descriptions, DDL, completion and table loads write a `command timing` line with the command name, the duration and whether it succeeded, so slow steps can be found in the log of the installed app.

## Bundle

Dialogs that open on request (designer, import, dump, explain, snippets, server variables, process list, structure, settings, history) are loaded with `lazy` the first time their request is set, through `OnDemand`. Query and table tabs are loaded lazily too, which keeps CodeMirror and the grid out of the first chunk. The start loads about 700 KB of JavaScript instead of 1.5 MB.

## Frontend state

Zustand stores hold the workspace (sessions, tabs) and query runs. A run is reduced from channel events by the pure function `reduceRun`. TanStack Query caches schema metadata with keys of the form `[kind, sessionId, ...]`, so disconnecting removes all of a session's data at once. After a WebView reload the frontend asks the backend for open sessions and restores them.

## Code style

Code contains no comments. Reasons for non obvious decisions belong in this file.
