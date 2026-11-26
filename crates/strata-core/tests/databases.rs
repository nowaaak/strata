use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use strata_core::design::{
    AlterOp, ColumnDef, ColumnPosition, DefaultValue, ForeignKeyRule, NewTable,
};
use strata_core::driver::ColumnKind;
use strata_core::dump::DumpOptions;
use strata_core::export::{ExportFormat, ExportSource};
use strata_core::import::{ColumnMapping, CsvImport, CsvOptions};
use strata_core::processes::KillMode;
use strata_core::profiles::{
    ConnectionProfile, Engine, PasswordUpdate, ProfileColor, ProfileStore, Safety, TlsMode,
};
use strata_core::routines::{RoutineKind, RoutineTarget};
use strata_core::schema::{ObjectKind, TableTarget};
use strata_core::secrets::MemorySecretStore;
use strata_core::server::ServerInfoKind;
use strata_core::session::{QUERY_ROW_CAP, QueryEvent, Session, SessionManager, StatementOutcome};
use strata_core::sql::{CellValue, DdlAction, RowChange, SortSpec, TableQuery};

#[derive(Clone, Copy)]
struct Server {
    engine: Engine,
    port: u16,
    user: &'static str,
}

const MYSQL: Server = Server {
    engine: Engine::Mysql,
    port: 33306,
    user: "root",
};
const MARIADB: Server = Server {
    engine: Engine::Mysql,
    port: 33307,
    user: "root",
};
const POSTGRES: Server = Server {
    engine: Engine::Postgres,
    port: 55432,
    user: "postgres",
};
const POSTGRES_18: Server = Server {
    engine: Engine::Postgres,
    port: 55418,
    user: "postgres",
};

struct Harness {
    _dir: tempfile::TempDir,
    manager: SessionManager,
    session: Arc<Session>,
}

async fn open(server: Server, safety: Safety) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let profiles = Arc::new(
        ProfileStore::load(
            dir.path().join("profiles.json"),
            Arc::new(MemorySecretStore::default()),
        )
        .await
        .unwrap(),
    );
    let profile = profiles
        .save(
            ConnectionProfile {
                id: String::new(),
                name: "it".into(),
                engine: server.engine,
                host: "127.0.0.1".into(),
                port: server.port,
                user: server.user.into(),
                database: Some("strata".into()),
                tls: TlsMode::Disabled,
                color: ProfileColor::None,
                safety,
                ask_password: false,
                group: None,
                ssh: None,
            },
            PasswordUpdate::Set {
                value: "strata".into(),
            },
            PasswordUpdate::Keep,
        )
        .await
        .unwrap();
    let manager = SessionManager::new(profiles);
    let info = manager.open(&profile.id, None).await.unwrap();
    let session = manager.get(&info.session_id).unwrap();
    Harness {
        _dir: dir,
        manager,
        session,
    }
}

async fn run(session: &Session, tab: &str, sql: &str, limit: usize) -> Vec<QueryEvent> {
    let events = Mutex::new(Vec::new());
    let emit = |event: QueryEvent| events.lock().unwrap().push(event);
    session
        .execute(tab, Some("strata"), sql, limit, &emit)
        .await
        .unwrap();
    events.into_inner().unwrap()
}

fn outcomes(events: &[QueryEvent]) -> Vec<StatementOutcome> {
    events
        .iter()
        .filter_map(|event| match event {
            QueryEvent::StatementFinished { outcome, .. } => Some(outcome.clone()),
            _ => None,
        })
        .collect()
}

fn failure(events: &[QueryEvent]) -> Option<(String, Option<u32>, bool)> {
    events.iter().find_map(|event| match event {
        QueryEvent::StatementFailed {
            message,
            error_at,
            cancelled,
            ..
        } => Some((message.clone(), *error_at, *cancelled)),
        _ => None,
    })
}

fn target(server: Server, table: &str) -> TableTarget {
    TableTarget {
        database: "strata".into(),
        schema: (server.engine == Engine::Postgres).then(|| "public".into()),
        table: table.into(),
    }
}

fn cell(column: &str, value: Option<&str>) -> CellValue {
    CellValue {
        column: column.into(),
        value: value.map(str::to_string),
    }
}

async fn exercise(server: Server, table: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;

    let setup = if postgres {
        format!(
            "DROP TABLE IF EXISTS public.{table};
             CREATE TABLE public.{table} (id integer PRIMARY KEY, amount numeric(38,10), big bigint, created timestamptz, doc jsonb, data bytea, label varchar(50), note text, flag boolean, tags int[]);
             INSERT INTO public.{table} VALUES (1, '12345678901234567890.0123456789', 9223372036854775807, '2024-02-29 13:14:15.123456+00', '{{\"a\": [1, 2]}}', '\\x00ff10', 'Grüße 😀', NULL, true, '{{1,2,3}}')"
        )
    } else {
        format!(
            "DROP TABLE IF EXISTS strata.{table};
             CREATE TABLE strata.{table} (id INT PRIMARY KEY, amount DECIMAL(38,10), big BIGINT UNSIGNED, created DATETIME(6), doc JSON, data BLOB, label VARCHAR(50) CHARACTER SET utf8mb4, note TEXT NULL);
             INSERT INTO strata.{table} VALUES (1, '12345678901234567890.0123456789', 18446744073709551615, '2024-02-29 13:14:15.123456', '{{\"a\": [1, 2]}}', X'00FF10', 'Grüße 😀', NULL)"
        )
    };
    let events = run(session, "setup", &setup, QUERY_ROW_CAP).await;
    assert_eq!(failure(&events), None, "setup failed");
    assert_eq!(
        outcomes(&events).last(),
        Some(&StatementOutcome::Affected { rows: 1 })
    );

    let events = run(
        session,
        "query",
        &format!("SELECT * FROM {table} ORDER BY id"),
        QUERY_ROW_CAP,
    )
    .await;
    let columns = events
        .iter()
        .find_map(|event| match event {
            QueryEvent::Columns { columns, .. } => Some(columns.clone()),
            _ => None,
        })
        .expect("columns event");
    assert_eq!(columns[1].kind, ColumnKind::Number);
    assert_eq!(columns[3].kind, ColumnKind::Temporal);
    assert_eq!(columns[5].kind, ColumnKind::Binary);
    let rows = session.fetch_rows("query", 0, 0, 10).unwrap();
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row[1].as_deref(), Some("12345678901234567890.0123456789"));
    assert_eq!(row[4].as_deref(), Some("{\"a\": [1, 2]}"));
    assert_eq!(row[6].as_deref(), Some("Grüße 😀"));
    assert_eq!(row[7], None);
    if postgres {
        assert_eq!(row[2].as_deref(), Some("9223372036854775807"));
        assert_eq!(row[3].as_deref(), Some("2024-02-29 13:14:15.123456+00"));
        assert_eq!(row[5].as_deref(), Some("\\x00ff10"));
        assert_eq!(row[8].as_deref(), Some("t"));
        assert_eq!(row[9].as_deref(), Some("{1,2,3}"));
        assert_eq!(columns[4].kind, ColumnKind::Json);
        assert_eq!(columns[8].kind, ColumnKind::Boolean);
    } else {
        assert_eq!(row[2].as_deref(), Some("18446744073709551615"));
        assert_eq!(row[3].as_deref(), Some("2024-02-29 13:14:15.123456"));
        assert_eq!(row[5].as_deref(), Some("0x00FF10"));
    }

    let databases = session.list_databases().await.unwrap();
    assert!(databases.contains(&"strata".to_string()), "{databases:?}");
    if postgres {
        let schemas = session.list_schemas("strata").await.unwrap();
        assert!(schemas.contains(&"public".to_string()), "{schemas:?}");
    }
    let objects = session
        .list_objects("strata", postgres.then_some("public"))
        .await
        .unwrap();
    assert!(
        objects
            .iter()
            .any(|object| object.name == table && object.kind == ObjectKind::Table)
    );

    let target = target(server, table);
    let info = session.describe_table(&target).await.unwrap();
    assert_eq!(info.columns.len(), if postgres { 10 } else { 8 });
    assert_eq!(info.editable_key, Some(vec!["id".to_string()]));
    assert!(!info.columns[0].nullable);
    let ddl = session.table_ddl(&target).await.unwrap();
    assert!(ddl.starts_with("CREATE TABLE"), "{ddl}");
    assert!(ddl.contains("PRIMARY KEY"), "{ddl}");

    let completion = session.completion("strata").await.unwrap();
    assert!(
        completion
            .iter()
            .any(|entry| entry.table == table && entry.columns.contains(&"amount".to_string()))
    );

    let changes = vec![
        RowChange::Update {
            key: vec![cell("id", Some("1"))],
            values: vec![
                cell("label", Some("O'Neil \\ neu")),
                cell("note", Some("x")),
            ],
        },
        RowChange::Insert {
            values: vec![cell("id", Some("2")), cell("label", Some("zwei"))],
        },
    ];
    let preview = session.preview_changes(&target, &changes).await.unwrap();
    assert_eq!(preview.len(), 2);
    assert_eq!(
        session
            .apply_changes("edit", &target, &changes)
            .await
            .unwrap(),
        2
    );
    let failing = vec![
        RowChange::Update {
            key: vec![cell("id", Some("1"))],
            values: vec![cell("label", Some("must roll back"))],
        },
        RowChange::Delete {
            key: vec![cell("id", Some("999"))],
        },
    ];
    let err = session
        .apply_changes("edit", &target, &failing)
        .await
        .unwrap_err();
    assert_eq!(err.kind(), "database", "{err}");
    let wrong_key = vec![RowChange::Delete {
        key: vec![cell("label", Some("zwei"))],
    }];
    assert_eq!(
        session
            .apply_changes("edit", &target, &wrong_key)
            .await
            .unwrap_err()
            .kind(),
        "invalid_input"
    );

    let load = |query: TableQuery| {
        let target = target.clone();
        async move {
            let events = Mutex::new(Vec::new());
            let emit = |event: QueryEvent| events.lock().unwrap().push(event);
            session
                .load_table("table", &target, &query, &emit)
                .await
                .unwrap();
            events.into_inner().unwrap()
        }
    };
    let events = load(TableQuery {
        filter: Some("id > 0".into()),
        sort: Some(SortSpec {
            column: "id".into(),
            descending: true,
        }),
        limit: 1,
    })
    .await;
    assert_eq!(
        outcomes(&events),
        vec![StatementOutcome::Rows {
            result: 0,
            rows: 1,
            truncated: true
        }]
    );
    let rows = session.fetch_rows("table", 0, 0, 10).unwrap();
    assert_eq!(rows[0][0].as_deref(), Some("2"));
    let rows = run(
        session,
        "query",
        &format!("SELECT label, note FROM {table} WHERE id = 1"),
        QUERY_ROW_CAP,
    )
    .await;
    assert_eq!(failure(&rows), None);
    let edited = session.fetch_rows("query", 0, 0, 1).unwrap();
    assert_eq!(edited[0][0].as_deref(), Some("O'Neil \\ neu"));
    assert_eq!(edited[0][1].as_deref(), Some("x"));

    let script = if postgres {
        "SELECT 1;\nSELEC 2"
    } else {
        "SELECT 1;\nSELECT *\nFROM WHERE"
    };
    let events = run(session, "query", script, QUERY_ROW_CAP).await;
    let (message, error_at, cancelled) = failure(&events).expect("syntax error");
    assert!(!cancelled);
    assert!(!message.is_empty());
    let expected = if postgres { 10 } else { 19 };
    assert_eq!(error_at, Some(expected), "{message}");

    let big = if postgres {
        "SELECT g, md5(g::text) FROM generate_series(1, 1000000) g".to_string()
    } else {
        let digits = "(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)";
        format!(
            "SELECT a.n + b.n * 10 + c.n * 100 + d.n * 1000 + e.n * 10000 AS n, MD5(a.n + b.n * 10) FROM {digits} a CROSS JOIN {digits} b CROSS JOIN {digits} c CROSS JOIN {digits} d CROSS JOIN {digits} e"
        )
    };
    let expected_rows: u32 = if postgres { 1_000_000 } else { 100_000 };
    let started = Instant::now();
    let events = run(session, "big", &big, QUERY_ROW_CAP).await;
    let elapsed = started.elapsed();
    assert_eq!(
        outcomes(&events),
        vec![StatementOutcome::Rows {
            result: 0,
            rows: expected_rows,
            truncated: false
        }]
    );
    let progress = events
        .iter()
        .filter(|event| matches!(event, QueryEvent::Progress { .. }))
        .count();
    assert!(progress > 1, "rows should stream in batches");
    let tail = session
        .fetch_rows("big", 0, expected_rows - 10, 100)
        .unwrap();
    assert_eq!(tail.len(), 10);
    eprintln!("{expected_rows} rows streamed in {elapsed:?} with {progress} progress events");

    let events = run(session, "big", &big, 1_000).await;
    assert_eq!(
        outcomes(&events),
        vec![StatementOutcome::Rows {
            result: 0,
            rows: 1_000,
            truncated: true
        }]
    );

    session.close_tab("big").await.unwrap();
    assert!(session.fetch_rows("big", 0, 0, 1).is_err());
    harness
        .manager
        .close(&session.info().session_id)
        .await
        .unwrap();
}

async fn cancel(server: Server) {
    let harness = open(server, Safety::Normal).await;
    let session = harness.session.clone();
    let sql = if server.engine == Engine::Postgres {
        "SELECT pg_sleep(30); SELECT 2"
    } else {
        "SELECT SLEEP(30); SELECT 2"
    };
    let running = tokio::spawn({
        let session = session.clone();
        async move { run(&session, "sleepy", sql, QUERY_ROW_CAP).await }
    });
    tokio::time::sleep(Duration::from_millis(800)).await;
    let busy = session
        .execute("sleepy", None, "SELECT 1", QUERY_ROW_CAP, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(busy.kind(), "busy");
    let started = Instant::now();
    session.cancel("sleepy").await.unwrap();
    let events = tokio::time::timeout(Duration::from_secs(10), running)
        .await
        .expect("query should stop after cancel")
        .unwrap();
    assert!(started.elapsed() < Duration::from_secs(10));
    let finished = events.iter().find_map(|event| match event {
        QueryEvent::Finished { cancelled, .. } => Some(*cancelled),
        _ => None,
    });
    assert_eq!(finished, Some(true));
    let ran_second = events
        .iter()
        .any(|event| matches!(event, QueryEvent::StatementStarted { index: 1 }));
    assert!(
        !ran_second,
        "the second statement must not run after cancel"
    );

    let events = run(&session, "sleepy", "SELECT 3", QUERY_ROW_CAP).await;
    assert_eq!(failure(&events), None, "tab must be usable after cancel");
}

async fn read_only(server: Server, table: &str) {
    let writer = open(server, Safety::Normal).await;
    let create = if server.engine == Engine::Postgres {
        format!(
            "DROP TABLE IF EXISTS public.{table}; CREATE TABLE public.{table} (id int PRIMARY KEY); CREATE SEQUENCE IF NOT EXISTS {table}_seq"
        )
    } else {
        format!("DROP TABLE IF EXISTS {table}; CREATE TABLE {table} (id int PRIMARY KEY)")
    };
    assert_eq!(
        failure(&run(&writer.session, "w", &create, QUERY_ROW_CAP).await),
        None
    );

    let harness = open(server, Safety::ReadOnly).await;
    let session = &harness.session;
    assert!(session.info().read_only);
    let err = session
        .execute(
            "ro",
            None,
            &format!("INSERT INTO {table} VALUES (1)"),
            QUERY_ROW_CAP,
            &|_| {},
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind(), "read_only");
    let changes = vec![RowChange::Insert {
        values: vec![cell("id", Some("1"))],
    }];
    assert_eq!(
        session
            .apply_changes("ro", &target(server, table), &changes)
            .await
            .unwrap_err()
            .kind(),
        "read_only"
    );
    let events = run(
        session,
        "ro",
        &format!("SELECT * FROM {table}"),
        QUERY_ROW_CAP,
    )
    .await;
    assert_eq!(failure(&events), None);
    if server.engine == Engine::Postgres {
        let events = run(
            session,
            "ro",
            &format!("SELECT nextval('{table}_seq')"),
            QUERY_ROW_CAP,
        )
        .await;
        let (message, _, _) = failure(&events).expect("server must enforce read-only");
        assert!(message.contains("read-only"), "{message}");
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_roundtrip() {
    exercise(MYSQL, "it_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_roundtrip() {
    exercise(MARIADB, "it_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_roundtrip() {
    exercise(POSTGRES, "it_postgres").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_cancel() {
    cancel(MYSQL).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_cancel() {
    cancel(MARIADB).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_cancel() {
    cancel(POSTGRES).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_read_only() {
    read_only(MYSQL, "it_ro_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_read_only() {
    read_only(POSTGRES, "it_ro_postgres").await;
}

async fn run_in(session: &Session, tab: &str, database: &str, sql: &str) -> Vec<QueryEvent> {
    let events = Mutex::new(Vec::new());
    let emit = |event: QueryEvent| events.lock().unwrap().push(event);
    session
        .execute(tab, Some(database), sql, QUERY_ROW_CAP, &emit)
        .await
        .unwrap();
    let events = events.into_inner().unwrap();
    assert_eq!(failure(&events), None, "{sql}");
    events
}

async fn object_names(session: &Session, database: &str, schema: Option<&str>) -> Vec<String> {
    session
        .list_objects(database, schema)
        .await
        .unwrap()
        .into_iter()
        .map(|object| object.name)
        .collect()
}

async fn structure(server: Server, prefix: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;
    let database = format!("{prefix} neu");
    let _ = session
        .run_ddl(&DdlAction::DropDatabase {
            database: database.clone(),
        })
        .await;

    session
        .run_ddl(&DdlAction::CreateDatabase {
            name: database.clone(),
        })
        .await
        .unwrap();
    assert!(session.list_databases().await.unwrap().contains(&database));

    let schema = if postgres {
        session
            .run_ddl(&DdlAction::CreateSchema {
                database: database.clone(),
                name: "archiv".into(),
            })
            .await
            .unwrap();
        Some("archiv".to_string())
    } else {
        None
    };
    let table = |name: &str| TableTarget {
        database: database.clone(),
        schema: schema.clone(),
        table: name.into(),
    };
    let prefix_sql = if postgres { "archiv." } else { "" };
    run_in(
        session,
        "ddl",
        &database,
        &format!(
            "CREATE TABLE {prefix_sql}orders (id int PRIMARY KEY); INSERT INTO {prefix_sql}orders VALUES (1), (2); CREATE VIEW {prefix_sql}v_orders AS SELECT id FROM {prefix_sql}orders"
        ),
    )
    .await;
    assert_eq!(
        object_names(session, &database, schema.as_deref()).await,
        ["orders", "v_orders"]
    );

    let sql = session
        .run_ddl(&DdlAction::TruncateTable {
            target: table("orders"),
        })
        .await
        .unwrap();
    assert!(sql.starts_with("TRUNCATE TABLE"), "{sql}");
    run_in(
        session,
        "count",
        &database,
        &format!("SELECT COUNT(*) FROM {prefix_sql}orders"),
    )
    .await;
    assert_eq!(
        session.fetch_rows("count", 0, 0, 1).unwrap()[0][0].as_deref(),
        Some("0")
    );

    session
        .run_ddl(&DdlAction::RenameObject {
            target: table("v_orders"),
            kind: ObjectKind::View,
            to: "Bestellungen Ansicht".into(),
        })
        .await
        .unwrap();
    session
        .run_ddl(&DdlAction::DropObject {
            target: table("Bestellungen Ansicht"),
            kind: ObjectKind::View,
        })
        .await
        .unwrap();
    session
        .run_ddl(&DdlAction::RenameObject {
            target: table("orders"),
            kind: ObjectKind::Table,
            to: "orders_alt".into(),
        })
        .await
        .unwrap();
    assert_eq!(
        object_names(session, &database, schema.as_deref()).await,
        ["orders_alt"]
    );
    session
        .run_ddl(&DdlAction::DropObject {
            target: table("orders_alt"),
            kind: ObjectKind::Table,
        })
        .await
        .unwrap();
    assert!(
        object_names(session, &database, schema.as_deref())
            .await
            .is_empty()
    );

    let final_name = if postgres {
        session
            .run_ddl(&DdlAction::RenameSchema {
                database: database.clone(),
                schema: "archiv".into(),
                to: "alt".into(),
            })
            .await
            .unwrap();
        assert!(
            session
                .list_schemas(&database)
                .await
                .unwrap()
                .contains(&"alt".to_string())
        );
        session
            .run_ddl(&DdlAction::DropSchema {
                database: database.clone(),
                schema: "alt".into(),
                cascade: false,
            })
            .await
            .unwrap();
        let renamed = format!("{prefix} umbenannt");
        let _ = session
            .run_ddl(&DdlAction::DropDatabase {
                database: renamed.clone(),
            })
            .await;
        session
            .run_ddl(&DdlAction::RenameDatabase {
                database: database.clone(),
                to: renamed.clone(),
            })
            .await
            .unwrap();
        run_in(session, "ddl", &renamed, "SELECT 1").await;
        renamed
    } else {
        let err = session
            .run_ddl(&DdlAction::RenameDatabase {
                database: database.clone(),
                to: "x".into(),
            })
            .await
            .unwrap_err();
        assert_eq!(err.kind(), "invalid_input");
        database.clone()
    };

    session
        .run_ddl(&DdlAction::DropDatabase {
            database: final_name.clone(),
        })
        .await
        .unwrap();
    let databases = session.list_databases().await.unwrap();
    assert!(!databases.contains(&final_name), "{databases:?}");
    assert!(!databases.contains(&database), "{databases:?}");

    let reader = open(server, Safety::ReadOnly).await;
    let err = reader
        .session
        .run_ddl(&DdlAction::CreateDatabase {
            name: format!("{prefix} nie"),
        })
        .await
        .unwrap_err();
    assert_eq!(err.kind(), "read_only");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_structure() {
    structure(MYSQL, "it_ddl_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_structure() {
    structure(MARIADB, "it_ddl_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_structure() {
    structure(POSTGRES, "it_ddl_postgres").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_roundtrip() {
    exercise(POSTGRES_18, "it_postgres").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_cancel() {
    cancel(POSTGRES_18).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_read_only() {
    read_only(POSTGRES_18, "it_ro_postgres").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_structure() {
    structure(POSTGRES_18, "it_ddl_postgres").await;
}

async fn processes(server: Server) {
    let harness = open(server, Safety::Normal).await;
    let session = harness.session.clone();
    let marker = "strata_process_probe";
    let sql = if server.engine == Engine::Postgres {
        format!("SELECT pg_sleep(30) AS {marker}")
    } else {
        format!("SELECT SLEEP(30) AS {marker}")
    };
    let running = tokio::spawn({
        let session = session.clone();
        async move { run(&session, "probe", &sql, QUERY_ROW_CAP).await }
    });
    tokio::time::sleep(Duration::from_millis(800)).await;

    let list = session.list_processes().await.unwrap();
    assert!(list.iter().any(|process| process.own), "{list:?}");
    let probe = list
        .iter()
        .find(|process| {
            process
                .query
                .as_deref()
                .is_some_and(|query| query.contains(marker))
        })
        .unwrap_or_else(|| panic!("the running query must be listed: {list:?}"))
        .clone();
    assert!(probe.active);
    assert!(!probe.own);
    assert!(probe.seconds.is_some());

    let reader = open(server, Safety::ReadOnly).await;
    assert_eq!(
        reader
            .session
            .kill_process(&probe.id, KillMode::Query)
            .await
            .unwrap_err()
            .kind(),
        "read_only"
    );

    let started = Instant::now();
    session
        .kill_process(&probe.id, KillMode::Query)
        .await
        .unwrap();
    let events = tokio::time::timeout(Duration::from_secs(10), running)
        .await
        .expect("the query must stop after it was killed")
        .unwrap();
    assert!(started.elapsed() < Duration::from_secs(10));
    if server.engine == Engine::Postgres {
        assert!(failure(&events).is_some(), "the killed query must fail");
    } else if let Some((message, _, _)) = failure(&events) {
        assert!(message.contains("interrupted"), "{message}");
    } else {
        assert_eq!(
            session.fetch_rows("probe", 0, 0, 1).unwrap()[0][0].as_deref(),
            Some("1"),
            "MySQL ends an interrupted SLEEP with 1"
        );
    }

    assert_eq!(
        session
            .kill_process("999999999", KillMode::Query)
            .await
            .unwrap_err()
            .kind(),
        "database"
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_processes() {
    processes(MYSQL).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_processes() {
    processes(MARIADB).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_processes() {
    processes(POSTGRES).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_processes() {
    processes(POSTGRES_18).await;
}

fn column_def(name: &str, data_type: &str, nullable: bool, default: DefaultValue) -> ColumnDef {
    ColumnDef {
        comment: None,
        name: name.into(),
        data_type: data_type.into(),
        nullable,
        default,
        auto_increment: false,
    }
}

async fn designer(server: Server, table: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;
    let target = target(server, table);
    let prefix = if postgres { "public." } else { "strata." };
    run(
        session,
        "d",
        &format!("DROP TABLE IF EXISTS {prefix}{table}"),
        QUERY_ROW_CAP,
    )
    .await;

    let statements = session
        .apply_create(&NewTable {
            target: target.clone(),
            columns: vec![
                ColumnDef {
                    comment: None,
                    auto_increment: true,
                    ..column_def(
                        "id",
                        if postgres { "bigint" } else { "int" },
                        false,
                        DefaultValue::None,
                    )
                },
                column_def(
                    "label",
                    "varchar(50)",
                    false,
                    DefaultValue::Text {
                        value: "neu".into(),
                    },
                ),
            ],
            primary_key: vec!["id".into()],
        })
        .await
        .unwrap();
    assert!(statements[0].starts_with("CREATE TABLE"), "{statements:?}");

    if !postgres {
        run_in(
            session,
            "d",
            "strata",
            &format!(
                "ALTER TABLE {table} MODIFY label varchar(50) COLLATE utf8mb4_german2_ci NOT NULL DEFAULT 'neu' COMMENT 'Bezeichnung', ADD COLUMN changed timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
            ),
        )
        .await;
    }
    run_in(
        session,
        "d",
        "strata",
        &format!("INSERT INTO {prefix}{table} (label) VALUES ('Käse'), ('abc')"),
    )
    .await;

    let design = session.table_design(&target).await.unwrap();
    assert!(design.columns[0].auto_increment, "{design:?}");
    assert!(
        design
            .indexes
            .iter()
            .any(|index| index.primary && index.columns == ["id"])
    );

    let ops = vec![
        AlterOp::ChangeColumn {
            position: None,
            name: "label".into(),
            column: column_def("title", "varchar(120)", false, DefaultValue::Keep),
        },
        AlterOp::AddColumn {
            position: None,
            column: column_def(
                "note",
                "text",
                true,
                DefaultValue::Text {
                    value: "it's".into(),
                },
            ),
        },
        AlterOp::AddIndex {
            name: format!("{table}_title"),
            columns: vec!["title".into()],
            unique: false,
        },
    ];
    let preview = session.preview_alter(&target, &ops).await.unwrap();
    let applied = session.apply_alter(&target, &ops).await.unwrap();
    assert_eq!(preview, applied);

    let design = session.table_design(&target).await.unwrap();
    let title = design
        .columns
        .iter()
        .find(|column| column.name == "title")
        .unwrap_or_else(|| panic!("{design:?}"));
    assert!(title.data_type.contains("120"), "{}", title.data_type);
    assert!(!title.nullable);
    assert!(
        title
            .default
            .as_deref()
            .is_some_and(|value| value.contains("neu")),
        "{:?}",
        title.default
    );
    if !postgres {
        assert_eq!(title.collation.as_deref(), Some("utf8mb4_german2_ci"));
        assert_eq!(title.comment.as_deref(), Some("Bezeichnung"));
        let changed = design
            .columns
            .iter()
            .find(|column| column.name == "changed")
            .unwrap();
        assert!(changed.on_update.is_some(), "{changed:?}");
    }
    assert!(
        design
            .indexes
            .iter()
            .any(|index| index.name == format!("{table}_title"))
    );

    run_in(
        session,
        "d",
        "strata",
        &format!("SELECT title, note FROM {prefix}{table} ORDER BY id"),
    )
    .await;
    let rows = session.fetch_rows("d", 0, 0, 10).unwrap();
    assert_eq!(rows[0][0].as_deref(), Some("Käse"));
    assert_eq!(rows[0][1].as_deref(), Some("it's"));

    if postgres {
        let failing = vec![
            AlterOp::AddColumn {
                position: None,
                column: column_def("extra", "int", true, DefaultValue::None),
            },
            AlterOp::ChangeColumn {
                position: None,
                name: "title".into(),
                column: column_def("title", "integer", false, DefaultValue::Keep),
            },
        ];
        let err = session.apply_alter(&target, &failing).await.unwrap_err();
        assert_eq!(err.kind(), "database", "{err}");
        let design = session.table_design(&target).await.unwrap();
        assert!(
            design.columns.iter().all(|column| column.name != "extra"),
            "a failed change must roll back completely"
        );
    }

    session
        .apply_alter(
            &target,
            &[AlterOp::ChangeColumn {
                position: None,
                name: "note".into(),
                column: column_def("note", "text", false, DefaultValue::Keep),
            }],
        )
        .await
        .unwrap();
    run_in(
        session,
        "d",
        "strata",
        &format!("INSERT INTO {prefix}{table} (title) VALUES ('kept default')"),
    )
    .await;
    run_in(
        session,
        "d",
        "strata",
        &format!("SELECT note FROM {prefix}{table} WHERE title = 'kept default'"),
    )
    .await;
    assert_eq!(
        session.fetch_rows("d", 0, 0, 1).unwrap()[0][0].as_deref(),
        Some("it's"),
        "an unchanged default must survive a column change"
    );

    session
        .apply_alter(
            &target,
            &[
                AlterOp::DropIndex {
                    name: format!("{table}_title"),
                },
                AlterOp::DropColumn {
                    name: "note".into(),
                },
            ],
        )
        .await
        .unwrap();
    let design = session.table_design(&target).await.unwrap();
    assert!(design.columns.iter().all(|column| column.name != "note"));
    assert!(
        design
            .indexes
            .iter()
            .all(|index| index.name != format!("{table}_title"))
    );

    let reader = open(server, Safety::ReadOnly).await;
    assert_eq!(
        reader
            .session
            .apply_alter(
                &target,
                &[AlterOp::DropColumn {
                    name: "title".into()
                }]
            )
            .await
            .unwrap_err()
            .kind(),
        "read_only"
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_designer() {
    designer(MYSQL, "it_design_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_designer() {
    designer(MARIADB, "it_design_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_designer() {
    designer(POSTGRES, "it_design_postgres").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_designer() {
    designer(POSTGRES_18, "it_design_postgres").await;
}

async fn designer_keys(server: Server, prefix: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;
    let schema = if postgres { "public." } else { "" };
    let parent = format!("{prefix}_parent");
    let child = format!("{prefix}_child");
    run_in(
        session,
        "k",
        "strata",
        &format!(
            "DROP TABLE IF EXISTS {schema}{child}; DROP TABLE IF EXISTS {schema}{parent};
             CREATE TABLE {schema}{parent} (code INT PRIMARY KEY);
             CREATE TABLE {schema}{child} (id INT NOT NULL, label VARCHAR(20), ref INT);
             INSERT INTO {schema}{parent} VALUES (1), (2);
             INSERT INTO {schema}{child} VALUES (1, 'a', 1), (2, 'b', 2)"
        ),
    )
    .await;
    let target = target(server, &child);

    let mut label = column_def("label", "varchar(20)", true, DefaultValue::Keep);
    label.comment = Some("Bezeichnung für Menschen".into());
    let mut ops = vec![
        AlterOp::ChangeColumn {
            name: "label".into(),
            column: label,
            position: (!postgres).then_some(ColumnPosition::First),
        },
        AlterOp::AddPrimaryKey {
            columns: vec!["id".into()],
        },
        AlterOp::AddForeignKey {
            name: format!("{child}_ref"),
            columns: vec!["ref".into()],
            target_table: parent.clone(),
            target_columns: vec!["code".into()],
            on_delete: ForeignKeyRule::Cascade,
            on_update: ForeignKeyRule::NoAction,
        },
    ];
    if !postgres {
        ops.push(AlterOp::AddColumn {
            column: column_def("first", "int", true, DefaultValue::None),
            position: Some(ColumnPosition::After {
                column: "label".into(),
            }),
        });
    }
    let statements = session.apply_alter(&target, &ops).await.unwrap();
    println!("KEYS {prefix}: {statements:?}");

    let design = session.table_design(&target).await.unwrap();
    let names: Vec<&str> = design
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect();
    if postgres {
        assert_eq!(names, ["id", "label", "ref"]);
    } else {
        assert_eq!(names, ["label", "first", "id", "ref"]);
    }
    let label = design
        .columns
        .iter()
        .find(|column| column.name == "label")
        .unwrap();
    assert_eq!(label.comment.as_deref(), Some("Bezeichnung für Menschen"));
    assert!(
        design
            .indexes
            .iter()
            .any(|index| index.primary && index.columns == ["id"]),
        "{design:?}"
    );
    let key = &design.foreign_keys[0];
    assert_eq!(key.name, format!("{child}_ref"));
    assert_eq!(key.columns, ["ref"]);
    assert_eq!(key.target.table, parent);
    assert_eq!(key.target_columns, ["code"]);
    assert_eq!(key.on_delete, ForeignKeyRule::Cascade);
    assert_eq!(key.on_update, ForeignKeyRule::NoAction);

    run_in(
        session,
        "k",
        "strata",
        &format!("DELETE FROM {schema}{parent} WHERE code = 1"),
    )
    .await;
    run_in(
        session,
        "k",
        "strata",
        &format!("SELECT COUNT(*) FROM {schema}{child}"),
    )
    .await;
    assert_eq!(
        session.fetch_rows("k", 0, 0, 1).unwrap()[0][0].as_deref(),
        Some("1"),
        "ON DELETE CASCADE must remove the child row"
    );

    let primary = design
        .indexes
        .iter()
        .find(|index| index.primary)
        .unwrap()
        .name
        .clone();
    let mut label = column_def("label", "varchar(20)", false, DefaultValue::Keep);
    label.comment = Some(String::new());
    session
        .apply_alter(
            &target,
            &[
                AlterOp::DropForeignKey {
                    name: format!("{child}_ref"),
                },
                AlterOp::DropIndex { name: primary },
                AlterOp::ChangeColumn {
                    name: "label".into(),
                    column: label,
                    position: None,
                },
                AlterOp::AddPrimaryKey {
                    columns: vec!["id".into(), "label".into()],
                },
            ],
        )
        .await
        .unwrap();
    let design = session.table_design(&target).await.unwrap();
    assert!(design.foreign_keys.is_empty(), "{design:?}");
    assert!(
        design
            .indexes
            .iter()
            .any(|index| index.primary && index.columns == ["id", "label"]),
        "{design:?}"
    );
    let label = design
        .columns
        .iter()
        .find(|column| column.name == "label")
        .unwrap();
    assert_eq!(label.comment, None);

    if postgres {
        let error = session
            .preview_alter(
                &target,
                &[AlterOp::ChangeColumn {
                    name: "ref".into(),
                    column: column_def("ref", "integer", true, DefaultValue::Keep),
                    position: Some(ColumnPosition::First),
                }],
            )
            .await
            .unwrap_err();
        assert_eq!(error.kind(), "invalid_input");
    }

    run_in(
        session,
        "k",
        "strata",
        &format!("DROP TABLE {schema}{child}; DROP TABLE {schema}{parent}"),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_designer_keys() {
    designer_keys(MYSQL, "it_keys_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_designer_keys() {
    designer_keys(MARIADB, "it_keys_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_designer_keys() {
    designer_keys(POSTGRES, "it_keys_pg").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_designer_keys() {
    designer_keys(POSTGRES_18, "it_keys_pg18").await;
}

async fn routines(server: Server, prefix: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;
    let table = format!("{prefix}_t");
    let setup = if postgres {
        format!(
            "DROP TABLE IF EXISTS public.{table} CASCADE; DROP FUNCTION IF EXISTS public.{prefix}_f(integer); DROP PROCEDURE IF EXISTS public.{prefix}_p(); DROP FUNCTION IF EXISTS public.{prefix}_tf() CASCADE; DROP SEQUENCE IF EXISTS public.{prefix}_s;
             CREATE TABLE public.{table} (v integer);
             CREATE FUNCTION public.{prefix}_f(a integer) RETURNS integer LANGUAGE sql AS 'SELECT a + 1';
             CREATE PROCEDURE public.{prefix}_p() LANGUAGE sql AS 'SELECT 1';
             CREATE FUNCTION public.{prefix}_tf() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
             CREATE TRIGGER {prefix}_tr BEFORE INSERT ON public.{table} FOR EACH ROW EXECUTE FUNCTION public.{prefix}_tf();
             CREATE SEQUENCE public.{prefix}_s START 5 INCREMENT 2"
        )
    } else {
        format!(
            "DROP TABLE IF EXISTS {table}; DROP FUNCTION IF EXISTS {prefix}_f; DROP PROCEDURE IF EXISTS {prefix}_p; DROP EVENT IF EXISTS {prefix}_e;
             CREATE TABLE {table} (v INT);
             CREATE FUNCTION {prefix}_f(a INT) RETURNS INT DETERMINISTIC NO SQL RETURN a + 1;
             CREATE PROCEDURE {prefix}_p() SELECT 1;
             CREATE TRIGGER {prefix}_tr BEFORE INSERT ON {table} FOR EACH ROW SET NEW.v = NEW.v + 0;
             CREATE EVENT {prefix}_e ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1"
        )
    };
    run_in(session, "r", "strata", &setup).await;

    let schema = postgres.then_some("public");
    let listed = session.list_routines("strata", schema).await.unwrap();
    let find = |kind: RoutineKind, name: &str| {
        listed
            .iter()
            .find(|routine| routine.kind == kind && routine.name == name)
            .unwrap_or_else(|| panic!("{kind:?} {name} missing in {listed:?}"))
            .clone()
    };
    let mut expected = vec![
        find(RoutineKind::Function, &format!("{prefix}_f")),
        find(RoutineKind::Procedure, &format!("{prefix}_p")),
        find(RoutineKind::Trigger, &format!("{prefix}_tr")),
    ];
    if postgres {
        expected.push(find(RoutineKind::Sequence, &format!("{prefix}_s")));
        assert_eq!(expected[0].arguments.as_deref(), Some("a integer"));
    } else {
        expected.push(find(RoutineKind::Event, &format!("{prefix}_e")));
    }
    assert_eq!(expected[2].table.as_deref(), Some(table.as_str()));

    for routine in &expected {
        let target = RoutineTarget {
            database: "strata".into(),
            schema: schema.map(str::to_string),
            routine: routine.clone(),
        };
        let ddl = session.routine_ddl(&target).await.unwrap();
        assert!(ddl.contains(&routine.name), "{ddl}");
        assert!(ddl.to_uppercase().contains("CREATE"), "{ddl}");
        if routine.kind == RoutineKind::Sequence {
            assert!(ddl.contains("START WITH 5"), "{ddl}");
            assert!(ddl.contains("INCREMENT BY 2"), "{ddl}");
        }
    }

    for routine in &expected {
        session
            .run_ddl(&DdlAction::DropRoutine {
                target: RoutineTarget {
                    database: "strata".into(),
                    schema: schema.map(str::to_string),
                    routine: routine.clone(),
                },
            })
            .await
            .unwrap();
    }
    let remaining = session.list_routines("strata", schema).await.unwrap();
    for routine in &expected {
        assert!(
            !remaining
                .iter()
                .any(|other| other.kind == routine.kind && other.name == routine.name),
            "{routine:?} should be gone"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_routines() {
    routines(MYSQL, "it_rt_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_routines() {
    routines(MARIADB, "it_rt_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_routines() {
    routines(POSTGRES, "it_rt_pg").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_routines() {
    routines(POSTGRES_18, "it_rt_pg").await;
}

async fn foreign_keys(server: Server, prefix: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;
    let schema = if postgres { "public." } else { "" };
    let parent = format!("{prefix}_parent");
    let child = format!("{prefix}_child");
    run_in(
        session,
        "f",
        "strata",
        &format!(
            "DROP TABLE IF EXISTS {schema}{child}; DROP TABLE IF EXISTS {schema}{parent};
             CREATE TABLE {schema}{parent} (region VARCHAR(10), id INT, name VARCHAR(40), PRIMARY KEY (region, id));
             CREATE TABLE {schema}{child} (cid INT PRIMARY KEY, region VARCHAR(10), parent_id INT, CONSTRAINT {child}_fk FOREIGN KEY (region, parent_id) REFERENCES {schema}{parent} (region, id));
             INSERT INTO {schema}{parent} VALUES ('süd', 1, 'Käse'), ('nord', 1, 'Brot');
             INSERT INTO {schema}{child} VALUES (10, 'süd', 1)"
        ),
    )
    .await;

    let info = session
        .describe_table(&target(server, &child))
        .await
        .unwrap();
    assert_eq!(info.foreign_keys.len(), 1, "{info:?}");
    let key = &info.foreign_keys[0];
    assert_eq!(key.columns, ["region", "parent_id"]);
    assert_eq!(key.target_columns, ["region", "id"]);
    assert_eq!(key.target.table, parent);
    assert_eq!(key.target.database, "strata");
    assert_eq!(key.target.schema.as_deref(), postgres.then_some("public"));

    let filter = session
        .equality_filter(&key.target_columns, &[Some("süd".into()), Some("1".into())])
        .unwrap();
    session
        .load_table(
            "fk",
            &key.target,
            &TableQuery {
                filter: Some(filter),
                sort: None,
                limit: 100,
            },
            &|_| {},
        )
        .await
        .unwrap();
    let rows = session.fetch_rows("fk", 0, 0, 10).unwrap();
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert_eq!(rows[0][2].as_deref(), Some("Käse"));

    let tricky = session
        .equality_filter(&["name".into()], &[Some(r"it's \ done".into())])
        .unwrap();
    run_in(
        session,
        "f",
        "strata",
        &format!("SELECT COUNT(*) FROM {schema}{parent} WHERE {tricky}"),
    )
    .await;
    assert_eq!(
        session.fetch_rows("f", 0, 0, 1).unwrap()[0][0].as_deref(),
        Some("0")
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_foreign_keys() {
    foreign_keys(MYSQL, "it_fk_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_foreign_keys() {
    foreign_keys(MARIADB, "it_fk_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_foreign_keys() {
    foreign_keys(POSTGRES, "it_fk_pg").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_foreign_keys() {
    foreign_keys(POSTGRES_18, "it_fk_pg").await;
}

fn big_query(server: Server) -> String {
    if server.engine == Engine::Postgres {
        "SELECT v, 'Zeile ' || v AS label FROM generate_series(1, 1200000) AS v".into()
    } else {
        "WITH d AS (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) SELECT a.n + 10 * b.n + 100 * c.n + 1000 * e.n + 10000 * f.n + 100000 * g.n + 1000000 * h.n + 1 AS v, 'Zeile' AS label FROM d a, d b, d c, d e, d f, d g, d h LIMIT 1200000".into()
    }
}

async fn full_export(server: Server, prefix: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let dir = tempfile::tempdir().unwrap();

    let csv = dir.path().join(format!("{prefix}.csv"));
    let reported = Arc::new(Mutex::new(Vec::new()));
    let summary = session
        .export_full(
            "big",
            &ExportSource::Query {
                database: Some("strata".into()),
                sql: big_query(server),
            },
            ExportFormat::Csv,
            csv.clone(),
            Box::new({
                let reported = reported.clone();
                move |rows| reported.lock().unwrap().push(rows)
            }),
        )
        .await
        .unwrap();
    assert_eq!(summary.rows, 1_200_000);
    assert!(!summary.cancelled);
    let text = std::fs::read_to_string(&csv).unwrap();
    assert_eq!(text.lines().count(), 1_200_001);
    assert!(text.starts_with("\u{feff}v,label\r\n"), "{}", &text[..40]);
    assert!(reported.lock().unwrap().contains(&1_000_000));
    assert!(!dir.path().join(format!("{prefix}.csv.tmp")).exists());

    let postgres = server.engine == Engine::Postgres;
    let table = format!("{prefix}_t");
    let schema = if postgres { "public." } else { "" };
    run_in(
        session,
        "x",
        "strata",
        &format!(
            "DROP TABLE IF EXISTS {schema}{table}; CREATE TABLE {schema}{table} (id INT PRIMARY KEY, name VARCHAR(20)); INSERT INTO {schema}{table} VALUES (1, 'Käse'), (2, NULL), (3, 'Brot')"
        ),
    )
    .await;
    let json = dir.path().join(format!("{prefix}.json"));
    let summary = session
        .export_full(
            "table",
            &ExportSource::Table {
                target: target(server, &table),
                filter: Some("id >= 2".into()),
                sort: Some(SortSpec {
                    column: "id".into(),
                    descending: true,
                }),
            },
            ExportFormat::Json,
            json.clone(),
            Box::new(|_| {}),
        )
        .await
        .unwrap();
    assert_eq!(summary.rows, 2);
    let parsed: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&json).unwrap()).unwrap();
    assert_eq!(
        parsed,
        serde_json::json!([{"id": "3", "name": "Brot"}, {"id": "2", "name": null}])
    );

    let refused = session
        .export_full(
            "write",
            &ExportSource::Query {
                database: Some("strata".into()),
                sql: format!("DELETE FROM {schema}{table}"),
            },
            ExportFormat::Csv,
            dir.path().join("never.csv"),
            Box::new(|_| {}),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert!(!dir.path().join("never.csv").exists());

    let cancelled_path = dir.path().join(format!("{prefix}_cancel.csv"));
    let running = tokio::spawn({
        let session = harness.session.clone();
        let path = cancelled_path.clone();
        let sql = big_query(server);
        async move {
            session
                .export_full(
                    "cancel",
                    &ExportSource::Query {
                        database: Some("strata".into()),
                        sql,
                    },
                    ExportFormat::Csv,
                    path,
                    Box::new(|_| {}),
                )
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(150)).await;
    session.cancel_export("cancel");
    let summary = tokio::time::timeout(Duration::from_secs(15), running)
        .await
        .expect("a cancelled export must stop")
        .unwrap()
        .unwrap();
    assert!(summary.cancelled, "{summary:?}");
    assert!(summary.rows < 1_200_000, "{summary:?}");
    assert!(!cancelled_path.exists());
    assert!(!dir.path().join(format!("{prefix}_cancel.csv.tmp")).exists());
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_full_export() {
    full_export(MYSQL, "it_exp_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_full_export() {
    full_export(MARIADB, "it_exp_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_full_export() {
    full_export(POSTGRES, "it_exp_pg").await;
}

async fn csv_import(server: Server, prefix: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;
    let schema = if postgres { "public." } else { "" };
    let table = format!("{prefix}_t");
    run_in(
        session,
        "i",
        "strata",
        &format!(
            "DROP TABLE IF EXISTS {schema}{table}; CREATE TABLE {schema}{table} (id INT PRIMARY KEY, name VARCHAR(40), price DECIMAL(10,2), note TEXT)"
        ),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("excel.csv");
    let mut bytes = b"Nummer;Bezeichnung;Preis;Bemerkung\r\n".to_vec();
    bytes.extend_from_slice(b"1;K\xe4se;1.234,50;\"zwei\r\nZeilen\"\r\n");
    bytes.extend_from_slice(b"2;\x84Gru\xdf\x93;0,99;\r\n");
    bytes.extend_from_slice(b"3;;;\"sagt \"\"hallo\"\"\"\r\n");
    std::fs::write(&path, &bytes).unwrap();

    let mapping = |pairs: &[(&str, u32)]| {
        pairs
            .iter()
            .map(|(column, source)| ColumnMapping {
                column: column.to_string(),
                source: *source,
            })
            .collect::<Vec<_>>()
    };
    let request = CsvImport {
        path: path.display().to_string(),
        options: CsvOptions {
            delimiter: None,
            header: true,
        },
        target: target(server, &table),
        mapping: mapping(&[("id", 0), ("name", 1), ("price", 2), ("note", 3)]),
        empty_as_null: true,
        decimal_comma: true,
    };
    let preview = strata_core::import::preview(path.clone(), &request.options).unwrap();
    assert_eq!(preview.encoding, "windows-1252");
    assert_eq!(preview.delimiter, ";");
    assert_eq!(
        preview.headers,
        ["Nummer", "Bezeichnung", "Preis", "Bemerkung"]
    );
    assert_eq!(preview.total_rows, 3);

    let summary = session
        .import_csv(&request, Box::new(|_| {}))
        .await
        .unwrap();
    assert_eq!(summary.rows, 3);
    run_in(
        session,
        "i",
        "strata",
        &format!("SELECT id, name, price, note FROM {schema}{table} ORDER BY id"),
    )
    .await;
    let rows = session.fetch_rows("i", 0, 0, 10).unwrap();
    assert_eq!(rows[0][1].as_deref(), Some("Käse"));
    assert_eq!(rows[0][2].as_deref(), Some("1234.50"));
    assert_eq!(rows[0][3].as_deref(), Some("zwei\r\nZeilen"));
    assert_eq!(rows[1][1].as_deref(), Some("„Gruß“"));
    assert_eq!(rows[1][2].as_deref(), Some("0.99"));
    assert_eq!(rows[1][3], None);
    assert_eq!(rows[2][1], None);
    assert_eq!(rows[2][3].as_deref(), Some("sagt \"hallo\""));

    let big = dir.path().join("big.csv");
    let mut text = String::from("id,name\n");
    for id in 100..1300 {
        let id = if id == 1200 { 150 } else { id };
        text.push_str(&format!("{id},Zeile {id}\n"));
    }
    std::fs::write(&big, text).unwrap();
    let failing = CsvImport {
        path: big.display().to_string(),
        options: CsvOptions {
            delimiter: Some(",".into()),
            header: true,
        },
        target: target(server, &table),
        mapping: mapping(&[("id", 0), ("name", 1)]),
        empty_as_null: true,
        decimal_comma: false,
    };
    let reported = Arc::new(Mutex::new(Vec::new()));
    let err = session
        .import_csv(
            &failing,
            Box::new({
                let reported = reported.clone();
                move |rows| reported.lock().unwrap().push(rows)
            }),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind(), "database");
    assert!(err.to_string().contains("rows 1001 to 1200"), "{err}");
    assert_eq!(*reported.lock().unwrap(), [500, 1000]);
    run_in(
        session,
        "i",
        "strata",
        &format!("SELECT COUNT(*) FROM {schema}{table}"),
    )
    .await;
    assert_eq!(
        session.fetch_rows("i", 0, 0, 1).unwrap()[0][0].as_deref(),
        Some("3"),
        "a failed import must not leave rows behind"
    );

    let reader = open(server, Safety::ReadOnly).await;
    assert_eq!(
        reader
            .session
            .import_csv(&request, Box::new(|_| {}))
            .await
            .unwrap_err()
            .kind(),
        "read_only"
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_csv_import() {
    csv_import(MYSQL, "it_imp_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_csv_import() {
    csv_import(MARIADB, "it_imp_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_csv_import() {
    csv_import(POSTGRES, "it_imp_pg").await;
}

async fn error_codes(server: Server) {
    let harness = open(server, Safety::Normal).await;
    let events = run(
        &harness.session,
        "e",
        "SELECT * FROM it_missing_table_xyz",
        QUERY_ROW_CAP,
    )
    .await;
    let (message, _, _) = failure(&events).expect("the query must fail");
    let expected = if server.engine == Engine::Postgres {
        "ERROR 42P01:"
    } else {
        "ERROR 1146 ("
    };
    assert!(message.starts_with(expected), "{message}");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_error_codes() {
    error_codes(MYSQL).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_error_codes() {
    error_codes(MARIADB).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_error_codes() {
    error_codes(POSTGRES).await;
}

async fn explain(server: Server, prefix: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;
    let schema = if postgres { "public." } else { "" };
    let table = format!("{prefix}_t");
    run_in(
        session,
        "x",
        "strata",
        &format!(
            "DROP TABLE IF EXISTS {schema}{table}; CREATE TABLE {schema}{table} (id INT PRIMARY KEY, name VARCHAR(20)); INSERT INTO {schema}{table} VALUES (1, 'a'), (2, 'b')"
        ),
    )
    .await;
    let sql = format!(
        "SELECT * FROM {schema}{table} t JOIN {schema}{table} u ON u.id = t.id WHERE t.name = 'a'"
    );
    let plan = session.explain(Some("strata"), &sql, false).await.unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&plan).unwrap();
    println!("PLAN {prefix}: {parsed}");
    if postgres {
        assert!(parsed[0]["Plan"]["Node Type"].is_string(), "{parsed}");
        let analyzed = session.explain(Some("strata"), &sql, true).await.unwrap();
        let analyzed: serde_json::Value = serde_json::from_str(&analyzed).unwrap();
        println!("ANALYZE {prefix}: {analyzed}");
        assert!(analyzed[0]["Plan"]["Actual Rows"].is_number(), "{analyzed}");
        assert!(analyzed[0]["Execution Time"].is_number(), "{analyzed}");
        let err = session
            .explain(
                Some("strata"),
                &format!("DELETE FROM {schema}{table}"),
                true,
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind(), "invalid_input");
    } else {
        assert!(parsed["query_block"].is_object(), "{parsed}");
        let err = session
            .explain(Some("strata"), &sql, true)
            .await
            .unwrap_err();
        assert_eq!(err.kind(), "invalid_input");
    }
    let err = session
        .explain(Some("strata"), "SELECT 1; SELECT 2", false)
        .await
        .unwrap_err();
    assert_eq!(err.kind(), "invalid_input");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_explain() {
    explain(MYSQL, "it_ex_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_explain() {
    explain(MARIADB, "it_ex_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_explain() {
    explain(POSTGRES, "it_ex_pg").await;
}

async fn dump_roundtrip(server: Server, prefix: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;
    let source = format!("{prefix}_src");
    let restore = format!("{prefix}_restore");
    for database in [&source, &restore] {
        let _ = session
            .run_ddl(&DdlAction::DropDatabase {
                database: database.clone(),
            })
            .await;
        session
            .run_ddl(&DdlAction::CreateDatabase {
                name: database.clone(),
            })
            .await
            .unwrap();
    }
    let setup = if postgres {
        "CREATE TABLE public.kunden (id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name text NOT NULL, foto bytea);
         CREATE TABLE public.bestellungen (id serial PRIMARY KEY, kunde_id integer NOT NULL REFERENCES public.kunden (id), betrag numeric(10,2), notiz text);
         CREATE INDEX bestellungen_kunde ON public.bestellungen (kunde_id);
         INSERT INTO public.kunden (name, foto) VALUES ('Käse ''Müller''', '\\x00ff10'), ('Brot', NULL);
         INSERT INTO public.bestellungen (kunde_id, betrag, notiz) VALUES (1, 12.50, 'zwei\nZeilen'), (2, NULL, NULL);
         CREATE VIEW public.umsatz AS SELECT kunde_id, SUM(betrag) AS summe FROM public.bestellungen GROUP BY kunde_id;
         CREATE FUNCTION public.netto(x numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT x / 2 $$;
         CREATE FUNCTION public.kunden_anzahl() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.kunden $$;
         CREATE FUNCTION public.gross() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.name := upper(NEW.name); RETURN NEW; END $$;
         CREATE TRIGGER kunden_gross BEFORE INSERT ON public.kunden FOR EACH ROW EXECUTE FUNCTION public.gross();
         CREATE PROCEDURE public.leeren() LANGUAGE sql AS $$ DELETE FROM public.bestellungen WHERE false $$;
         CREATE VIEW public.netto_umsatz AS SELECT public.netto(betrag) AS netto FROM public.bestellungen"
    } else {
        "CREATE TABLE kunden (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL, foto BLOB);
         CREATE TABLE bestellungen (id INT AUTO_INCREMENT PRIMARY KEY, kunde_id INT NOT NULL, betrag DECIMAL(10,2), notiz TEXT, CONSTRAINT bestellungen_kunde FOREIGN KEY (kunde_id) REFERENCES kunden (id));
         INSERT INTO kunden (name, foto) VALUES ('Käse ''Müller''', X'00FF10'), ('Brot', NULL);
         INSERT INTO bestellungen (kunde_id, betrag, notiz) VALUES (1, 12.50, 'zwei\nZeilen'), (2, NULL, NULL);
         CREATE VIEW umsatz AS SELECT kunde_id, SUM(betrag) AS summe FROM bestellungen GROUP BY kunde_id;
         DELIMITER //
         CREATE FUNCTION netto(x DECIMAL(10,2)) RETURNS DECIMAL(10,2) DETERMINISTIC BEGIN RETURN x / 2; END//
         CREATE PROCEDURE anzahl(OUT n INT) BEGIN SELECT COUNT(*) INTO n FROM kunden; END//
         CREATE TRIGGER kunden_gross BEFORE INSERT ON kunden FOR EACH ROW BEGIN SET NEW.name = UPPER(NEW.name); END//
         CREATE EVENT aufraeumen ON SCHEDULE EVERY 1 DAY DISABLE DO BEGIN DELETE FROM bestellungen WHERE 1 = 0; END//
         DELIMITER ;
         CREATE VIEW netto_umsatz AS SELECT netto(betrag) AS netto FROM bestellungen"
    };
    run_in(session, "s", &source, setup).await;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dump.sql");
    let summary = session
        .dump(
            "dump",
            &DumpOptions {
                database: source.clone(),
                schema: postgres.then(|| "public".into()),
                tables: Vec::new(),
                structure: true,
                data: true,
                drop_existing: true,
                routines: true,
            },
            path.clone(),
            Box::new(|_| {}),
        )
        .await
        .unwrap();
    assert_eq!(summary.tables, 4, "{summary:?}");
    assert_eq!(summary.rows, 4);
    let script = std::fs::read_to_string(&path).unwrap();
    assert!(
        script.starts_with("-- Strata SQL dump"),
        "{}",
        &script[..80]
    );
    assert!(!script.contains("DEFINER="), "{script}");
    if !postgres {
        assert!(script.contains("DELIMITER ;;"), "{script}");
    }
    let trigger_at = script
        .find("-- kunden_gross")
        .expect("the trigger must be dumped");
    let insert_at = script.find("INSERT INTO").unwrap();
    assert!(trigger_at > insert_at, "triggers must follow the data");

    run_in(session, "r", &restore, &script).await;
    let restored: Vec<String> = session
        .list_routines(&restore, postgres.then_some("public"))
        .await
        .unwrap()
        .into_iter()
        .map(|routine| routine.name)
        .collect();
    let expected: &[&str] = if postgres {
        &["gross", "kunden_anzahl", "kunden_gross", "leeren", "netto"]
    } else {
        &["anzahl", "aufraeumen", "kunden_gross", "netto"]
    };
    for name in expected {
        assert!(
            restored.iter().any(|routine| routine == name),
            "{name} missing: {restored:?}"
        );
    }
    let calls = if postgres {
        "SELECT netto(10), kunden_anzahl()"
    } else {
        "SELECT netto(10)"
    };
    run_in(session, "r", &restore, calls).await;
    let rows = session.fetch_rows("r", 0, 0, 1).unwrap();
    assert!(
        rows[0][0]
            .as_deref()
            .is_some_and(|value| value.starts_with('5')),
        "{rows:?}"
    );
    if postgres {
        assert_eq!(rows[0][1].as_deref(), Some("2"));
    }
    run_in(session, "r", &restore, "SELECT COUNT(*) FROM netto_umsatz").await;
    assert_eq!(
        session.fetch_rows("r", 0, 0, 1).unwrap()[0][0].as_deref(),
        Some("2")
    );
    run_in(
        session,
        "r",
        &restore,
        "SELECT name, foto FROM kunden ORDER BY id",
    )
    .await;
    let rows = session.fetch_rows("r", 0, 0, 10).unwrap();
    assert_eq!(rows[0][0].as_deref(), Some("Käse 'Müller'"));
    assert_eq!(
        rows[0][1].as_deref(),
        Some(if postgres { r"\x00ff10" } else { "0x00FF10" })
    );
    assert_eq!(rows[1][1], None);
    run_in(
        session,
        "r",
        &restore,
        "SELECT notiz, betrag FROM bestellungen ORDER BY id",
    )
    .await;
    let rows = session.fetch_rows("r", 0, 0, 10).unwrap();
    assert_eq!(rows[0][0].as_deref(), Some("zwei\nZeilen"));
    assert_eq!(rows[1][1], None);
    run_in(session, "r", &restore, "SELECT COUNT(*) FROM umsatz").await;
    assert_eq!(
        session.fetch_rows("r", 0, 0, 1).unwrap()[0][0].as_deref(),
        Some("2")
    );
    run_in(
        session,
        "r",
        &restore,
        "INSERT INTO kunden (name) VALUES ('neu')",
    )
    .await;
    run_in(
        session,
        "r",
        &restore,
        "SELECT MAX(id), MAX(name) FROM kunden",
    )
    .await;
    let rows = session.fetch_rows("r", 0, 0, 1).unwrap();
    assert_eq!(
        rows[0][0].as_deref(),
        Some("3"),
        "auto increment must continue after the restored rows"
    );
    assert_eq!(
        rows[0][1].as_deref(),
        Some("NEU"),
        "the restored trigger must run"
    );
    let events = Mutex::new(Vec::new());
    session
        .execute(
            "r2",
            Some(&restore),
            "INSERT INTO bestellungen (kunde_id) VALUES (99)",
            QUERY_ROW_CAP,
            &|event| events.lock().unwrap().push(event),
        )
        .await
        .unwrap();
    assert!(
        failure(&events.into_inner().unwrap()).is_some(),
        "the restored foreign key must reject a missing customer"
    );
    let info = session
        .describe_table(&TableTarget {
            database: restore.clone(),
            schema: postgres.then(|| "public".into()),
            table: "bestellungen".into(),
        })
        .await
        .unwrap();
    assert_eq!(
        info.foreign_keys.len(),
        1,
        "the foreign key must be restored"
    );

    for database in [&source, &restore] {
        session
            .run_ddl(&DdlAction::DropDatabase {
                database: database.clone(),
            })
            .await
            .unwrap();
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_dump_roundtrip() {
    dump_roundtrip(MYSQL, "it_dump_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_dump_roundtrip() {
    dump_roundtrip(MARIADB, "it_dump_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_dump_roundtrip() {
    dump_roundtrip(POSTGRES, "it_dump_pg").await;
}

async fn server_info(server: Server) {
    let harness = open(server, Safety::ReadOnly).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;

    let variables = session
        .server_info(ServerInfoKind::Variables)
        .await
        .unwrap();
    assert!(variables.len() > 100, "{}", variables.len());
    let max = variables
        .iter()
        .find(|setting| setting.name == "max_connections")
        .expect("max_connections must be listed");
    assert!(max.value.parse::<u32>().is_ok(), "{max:?}");
    if postgres {
        let buffers = variables
            .iter()
            .find(|setting| setting.name == "shared_buffers")
            .unwrap();
        assert!(buffers.value.ends_with("B"), "{buffers:?}");
        assert!(buffers.category.is_some() && buffers.description.is_some());
        assert!(variables.iter().any(|setting| setting.changed));
    }

    let status = session.server_info(ServerInfoKind::Status).await.unwrap();
    let names: Vec<&str> = status.iter().map(|setting| setting.name.as_str()).collect();
    println!(
        "STATUS {}: {} rows, {:?}",
        server.port,
        status.len(),
        &names[..names.len().min(30)]
    );
    if postgres {
        for name in [
            "version",
            "uptime",
            "connections",
            "database_size",
            "xact_commit",
            "deadlocks",
        ] {
            assert!(names.contains(&name), "{name} missing in {names:?}");
        }
        assert_eq!(names[0], "version");
    } else {
        for name in ["Uptime", "Threads_connected", "Questions"] {
            assert!(names.contains(&name), "{name} missing");
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_server_info() {
    server_info(MYSQL).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_server_info() {
    server_info(MARIADB).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_server_info() {
    server_info(POSTGRES).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_server_info() {
    server_info(POSTGRES_18).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_dump_roundtrip() {
    dump_roundtrip(POSTGRES_18, "it_dump_pg18").await;
}

async fn schema_graph(server: Server, prefix: &str) {
    let harness = open(server, Safety::Normal).await;
    let session = &harness.session;
    let postgres = server.engine == Engine::Postgres;
    let schema = if postgres { "public." } else { "" };
    let parent = format!("{prefix}_kunde");
    let child = format!("{prefix}_position");
    run_in(
        session,
        "g",
        "strata",
        &format!(
            "DROP TABLE IF EXISTS {schema}{child}; DROP TABLE IF EXISTS {schema}{parent};
             CREATE TABLE {schema}{parent} (id INT, land CHAR(2), name VARCHAR(40), PRIMARY KEY (id, land));
             CREATE TABLE {schema}{child} (nr INT PRIMARY KEY, kunde INT NOT NULL, land CHAR(2) NOT NULL, CONSTRAINT {child}_kunde FOREIGN KEY (kunde, land) REFERENCES {schema}{parent} (id, land))"
        ),
    )
    .await;

    let graph = session
        .schema_graph("strata", postgres.then_some("public"))
        .await
        .unwrap();
    let table = |name: &str| {
        graph
            .tables
            .iter()
            .find(|table| table.name == name)
            .unwrap_or_else(|| panic!("{name} missing"))
    };
    let kunde = table(&parent);
    let primary: Vec<&str> = kunde
        .columns
        .iter()
        .filter(|column| column.primary)
        .map(|column| column.name.as_str())
        .collect();
    assert_eq!(primary, ["id", "land"]);
    assert!(kunde.columns[2].nullable);
    assert!(!table(&child).columns[1].nullable);
    let key = graph
        .foreign_keys
        .iter()
        .find(|key| key.table == child)
        .expect("the foreign key must be listed");
    assert_eq!(key.target_table, parent);
    assert_eq!(key.columns, ["kunde", "land"]);
    assert_eq!(key.target_columns, ["id", "land"]);

    run_in(
        session,
        "g",
        "strata",
        &format!("DROP TABLE {schema}{child}; DROP TABLE {schema}{parent}"),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_schema_graph() {
    schema_graph(MYSQL, "it_graph_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_schema_graph() {
    schema_graph(MARIADB, "it_graph_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_schema_graph() {
    schema_graph(POSTGRES, "it_graph_pg").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_18_schema_graph() {
    schema_graph(POSTGRES_18, "it_graph_pg18").await;
}
