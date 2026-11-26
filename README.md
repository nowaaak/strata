# Strata

A fast, modern desktop client for MySQL, MariaDB and PostgreSQL. Built with Tauri 2, Rust and React.

## Features

- Connection profiles in collapsible groups, with color tags, TLS and a safety level per connection: normal, confirm before writing, or read-only (enforced by Strata and by the server session)
- Passwords live in the Windows Credential Manager, or are asked for on every connect
- SSH tunnel per connection with password or key file (with optional passphrase). The server key is confirmed on first use and a changed key blocks the connection
- Schema tree with databases, PostgreSQL schemas, tables and views, plus a filter
- SQL editor with syntax highlighting, schema-aware autocomplete, run statement at cursor (Ctrl+Enter) or the whole script (Ctrl+Shift+Enter), cancel (Ctrl+.), the error position marked in the text and a SQL formatter for the selection or the whole script (Shift+Alt+F)
- Virtualized result grid that streams up to one million rows, range selection, copy as TSV, resizable columns
- Table view with WHERE filter, sorting, row limit, structure and DDL
- Inline editing with insert and delete. Changes are previewed as SQL and saved in one transaction that rolls back unless every statement hits exactly one row
- JSON in the cell editor: highlighted, formatted or compact, checked while typing. Numbers and strings are never rewritten, and a value stored compact is saved compact again
- Process list per connection with auto refresh, cancel a running query or end a connection
- Table designer: add, rename, retype and drop columns, change NULL, defaults and auto increment, add and drop indexes, or create a new table with its primary key. Everything is shown as SQL before it runs
- Create, rename, empty and delete databases, PostgreSQL schemas, tables and views from the schema tree. Every change shows the exact SQL first, deleting a database asks for its name, and a new table starts from a SQL template
- Export to CSV and JSON
- Command palette (Ctrl+K) for tables, connections and actions
- Searchable query history (Ctrl+H) and tabs with SQL drafts that survive a restart
- Settings (Ctrl+,): theme, accent color, interface zoom, editor font size and line wrapping, grid row height, default row limit, German or English interface

## Development

Requirements: Rust 1.99, Node 26, Docker for the integration tests.

```sh
npm install
npm run app
```

`npm run app` starts "Strata Dev" with the identifier `nd.strata.dev`. It has its own data folder and its own entries in the Windows Credential Manager, so development never touches the connections of the installed app. A debug build refuses to start with the release identifier, so plain `npm run tauri dev` fails on purpose.

## Releases

The installed app checks GitHub Releases for updates every six hours and on demand in Settings, About. Updates are signed, and the app only installs a build whose signature matches the public key in `src-tauri/tauri.conf.json`.

To publish a version:

1. Raise `version` in `package.json`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin master v0.2.0`.

The release workflow checks that the tag matches the version, builds the Windows installers, signs the update and publishes the release with `latest.json`. It needs the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

The first install uses `Strata_<version>_x64-setup.exe` from the release.

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
