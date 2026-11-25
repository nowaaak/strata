# Strata

A fast, modern desktop client for MySQL, MariaDB and PostgreSQL. Built with Tauri 2, Rust and React.

## Features

- Connection profiles in collapsible groups, with color tags, TLS and a safety level per connection: normal, confirm before writing, or read-only (enforced by Strata and by the server session)
- Passwords live in the Windows Credential Manager, or are asked for on every connect
- Schema tree with databases, PostgreSQL schemas, tables and views, plus a filter
- SQL editor with syntax highlighting, schema-aware autocomplete, run statement at cursor (Ctrl+Enter) or the whole script (Ctrl+Shift+Enter), cancel (Ctrl+.) and the error position marked in the text
- Virtualized result grid that streams up to one million rows, range selection, copy as TSV, resizable columns
- Table view with WHERE filter, sorting, row limit, structure and DDL
- Inline editing with insert and delete. Changes are previewed as SQL and saved in one transaction that rolls back unless every statement hits exactly one row
- Export to CSV and JSON
- Command palette (Ctrl+K) for tables, connections and actions
- Settings (Ctrl+,): theme, accent color, interface zoom, editor font size and line wrapping, grid row height, default row limit, German or English interface

## Development

Requirements: Rust 1.99, Node 26, Docker for the integration tests.

```sh
npm install
npm run app
```

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
cargo test -p strata-core --test databases -- --ignored
docker compose -f docker-compose.test.yml down -v
```

`npm run bindings` regenerates the TypeScript types in `src/bindings` from the Rust sources.

See [docs/architecture.md](docs/architecture.md) for the structure.
