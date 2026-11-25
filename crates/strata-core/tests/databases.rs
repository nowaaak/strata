use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use strata_core::driver::ColumnKind;
use strata_core::profiles::{
    ConnectionProfile, Engine, PasswordUpdate, ProfileColor, ProfileStore, Safety, TlsMode,
};
use strata_core::schema::{ObjectKind, TableTarget};
use strata_core::secrets::MemorySecretStore;
use strata_core::session::{QUERY_ROW_CAP, QueryEvent, Session, SessionManager, StatementOutcome};
use strata_core::sql::{CellValue, RowChange, SortSpec, TableQuery};

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
            },
            PasswordUpdate::Set {
                value: "strata".into(),
            },
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
