use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use strata_core::design::{AlterOp, ColumnDef, DefaultValue, NewTable};
use strata_core::driver::{ColumnKind, create_sqlite_file};
use strata_core::dump::DumpOptions;
use strata_core::profiles::{
    ConnectionProfile, Engine, PasswordUpdate, ProfileColor, ProfileStore, Safety, TlsMode,
};
use strata_core::routines::RoutineKind;
use strata_core::schema::{ObjectKind, TableTarget};
use strata_core::secrets::MemorySecretStore;
use strata_core::server::ServerInfoKind;
use strata_core::session::{QUERY_ROW_CAP, QueryEvent, Session, SessionManager, StatementOutcome};
use strata_core::sql::{CellValue, DdlAction, RowChange, SortSpec, TableQuery};

struct Harness {
    _dir: tempfile::TempDir,
    path: PathBuf,
    _manager: SessionManager,
    session: Arc<Session>,
}

async fn open_file(dir: &Path, path: &Path, safety: Safety) -> (SessionManager, Arc<Session>) {
    let profiles = Arc::new(
        ProfileStore::load(
            dir.join(format!("profiles-{}.json", uuid_like())),
            Arc::new(MemorySecretStore::default()),
        )
        .await
        .unwrap(),
    );
    let profile = profiles
        .save(
            ConnectionProfile {
                id: String::new(),
                name: "lite".into(),
                engine: Engine::Sqlite,
                host: path.display().to_string(),
                port: 5432,
                user: "ignored".into(),
                database: Some("ignored".into()),
                tls: TlsMode::Required,
                color: ProfileColor::None,
                safety,
                ask_password: true,
                group: None,
                ssh: None,
            },
            PasswordUpdate::Keep,
            PasswordUpdate::Keep,
        )
        .await
        .unwrap();
    assert_eq!(profile.port, 0);
    assert!(profile.user.is_empty());
    assert_eq!(profile.database, None);
    assert_eq!(profile.tls, TlsMode::Disabled);
    let manager = SessionManager::new(profiles);
    let info = manager.open(&profile.id, None).await.unwrap();
    let session = manager.get(&info.session_id).unwrap();
    (manager, session)
}

fn uuid_like() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

async fn open(safety: Safety) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("laden.sqlite");
    create_sqlite_file(&path).unwrap();
    let (manager, session) = open_file(dir.path(), &path, safety).await;
    Harness {
        _dir: dir,
        path,
        _manager: manager,
        session,
    }
}

async fn run(session: &Session, tab: &str, sql: &str) -> Vec<QueryEvent> {
    let events = Mutex::new(Vec::new());
    let emit = |event: QueryEvent| events.lock().unwrap().push(event);
    session
        .execute(tab, Some("main"), sql, QUERY_ROW_CAP, &emit)
        .await
        .unwrap();
    events.into_inner().unwrap()
}

fn failure(events: &[QueryEvent]) -> Option<String> {
    events.iter().find_map(|event| match event {
        QueryEvent::StatementFailed { message, .. } => Some(message.clone()),
        _ => None,
    })
}

fn first(session: &Session, tab: &str) -> Vec<Option<String>> {
    session.fetch_rows(tab, 0, 0, 1).unwrap().remove(0)
}

fn target(table: &str) -> TableTarget {
    TableTarget {
        database: "main".into(),
        schema: None,
        table: table.into(),
    }
}

fn cell(column: &str, value: Option<&str>) -> CellValue {
    CellValue {
        column: column.into(),
        value: value.map(str::to_string),
    }
}

const SETUP: &str = "CREATE TABLE kunde (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, saldo REAL DEFAULT 0, foto BLOB);
CREATE TABLE bestellung (id INTEGER PRIMARY KEY AUTOINCREMENT, kunde_id INTEGER NOT NULL REFERENCES kunde (id) ON DELETE CASCADE, datum DATE, notiz TEXT);
CREATE INDEX bestellung_datum ON bestellung (datum);
CREATE VIEW umsatz AS SELECT kunde_id, count(*) AS anzahl FROM bestellung GROUP BY kunde_id;
CREATE TRIGGER kunde_gross BEFORE INSERT ON kunde BEGIN SELECT CASE WHEN NEW.name = '' THEN RAISE(ABORT, 'leer') END; END;
INSERT INTO kunde (name, email, saldo, foto) VALUES ('Käse ''Müller''', 'k@example.org', 12.5, x'00ff10'), ('Brot', NULL, 3.0, NULL);
INSERT INTO bestellung (kunde_id, datum, notiz) VALUES (1, '2026-11-26', 'zwei; Teile'), (2, NULL, NULL), (1, '2026-11-27', NULL)";

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_end_to_end() {
    let harness = open(Safety::Normal).await;
    let session = &harness.session;
    assert_eq!(session.info().server.flavor, "SQLite");

    let events = run(session, "s", SETUP).await;
    assert_eq!(failure(&events), None);

    let events = run(session, "q", "SELECT * FROM kunde ORDER BY id").await;
    let columns = events
        .iter()
        .find_map(|event| match event {
            QueryEvent::Columns { columns, .. } => Some(columns.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(columns[0].kind, ColumnKind::Number);
    assert_eq!(columns[3].kind, ColumnKind::Number);
    assert_eq!(columns[4].kind, ColumnKind::Binary);
    let row = first(session, "q");
    assert_eq!(row[1].as_deref(), Some("Käse 'Müller'"));
    assert_eq!(row[3].as_deref(), Some("12.5"));
    assert_eq!(row[4].as_deref(), Some("0x00FF10"));

    let failed = run(session, "q", "INSERT INTO kunde (name) VALUES ('')").await;
    assert!(failure(&failed).unwrap().contains("leer"));
    let missing = run(session, "q", "SELECT * FROM nichts").await;
    assert!(failure(&missing).unwrap().contains("no such table"));

    assert_eq!(session.list_databases().await.unwrap(), ["main"]);
    assert!(session.list_schemas("main").await.unwrap().is_empty());
    let objects = session.list_objects("main", None).await.unwrap();
    let names: Vec<(&str, ObjectKind)> = objects
        .iter()
        .map(|object| (object.name.as_str(), object.kind))
        .collect();
    assert_eq!(
        names,
        [
            ("bestellung", ObjectKind::Table),
            ("kunde", ObjectKind::Table),
            ("umsatz", ObjectKind::View),
        ]
    );

    let info = session.describe_table(&target("bestellung")).await.unwrap();
    assert_eq!(info.columns.len(), 4);
    assert_eq!(info.editable_key, Some(vec!["id".to_string()]));
    assert!(!info.columns[1].nullable);
    assert_eq!(info.foreign_keys.len(), 1);
    assert_eq!(info.foreign_keys[0].target.table, "kunde");
    assert_eq!(info.foreign_keys[0].target_columns, ["id"]);
    let kunde = session.describe_table(&target("kunde")).await.unwrap();
    assert_eq!(kunde.editable_key, Some(vec!["id".to_string()]));
    let ddl = session.table_ddl(&target("bestellung")).await.unwrap();
    assert!(ddl.starts_with("CREATE TABLE bestellung"), "{ddl}");
    assert!(ddl.contains("CREATE INDEX bestellung_datum"), "{ddl}");

    let completion = session.completion("main").await.unwrap();
    assert!(
        completion
            .iter()
            .any(|table| table.table == "kunde" && table.columns.contains(&"email".to_string()))
    );

    let changes = vec![
        RowChange::Update {
            key: vec![cell("id", Some("2"))],
            values: vec![cell("name", Some("Brötchen"))],
        },
        RowChange::Insert {
            values: vec![cell("name", Some("Neu")), cell("saldo", Some("1.5"))],
        },
    ];
    assert_eq!(
        session
            .apply_changes("edit", &target("kunde"), &changes)
            .await
            .unwrap(),
        2
    );
    let events = Mutex::new(Vec::new());
    session
        .load_table(
            "table",
            &target("kunde"),
            &TableQuery {
                filter: Some("saldo > 1".into()),
                sort: Some(SortSpec {
                    column: "id".into(),
                    descending: true,
                }),
                limit: 2,
            },
            &|event| events.lock().unwrap().push(event),
        )
        .await
        .unwrap();
    let rows = session.fetch_rows("table", 0, 0, 10).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0][1].as_deref(), Some("Neu"));
    assert_eq!(rows[1][1].as_deref(), Some("Brötchen"));

    let graph = session.schema_graph("main", None).await.unwrap();
    assert_eq!(graph.tables.len(), 3);
    assert_eq!(graph.foreign_keys.len(), 1);
    assert_eq!(graph.foreign_keys[0].table, "bestellung");
    assert_eq!(graph.foreign_keys[0].target_columns, ["id"]);
    let kunde = graph
        .tables
        .iter()
        .find(|table| table.name == "kunde")
        .unwrap();
    assert!(kunde.columns[0].primary);

    let routines = session.list_routines("main", None).await.unwrap();
    assert_eq!(routines.len(), 1);
    assert_eq!(routines[0].kind, RoutineKind::Trigger);
    assert_eq!(routines[0].table.as_deref(), Some("kunde"));

    let variables = session
        .server_info(ServerInfoKind::Variables)
        .await
        .unwrap();
    let foreign = variables
        .iter()
        .find(|setting| setting.name == "foreign_keys")
        .unwrap();
    assert_eq!(foreign.value, "1");
    let status = session.server_info(ServerInfoKind::Status).await.unwrap();
    assert!(status.iter().any(|setting| setting.name == "size_bytes"));
    assert_eq!(
        session.list_processes().await.unwrap_err().kind(),
        "invalid_input"
    );

    let plan = session
        .explain(
            Some("main"),
            "SELECT * FROM bestellung WHERE kunde_id = 1",
            false,
        )
        .await
        .unwrap();
    let plan: serde_json::Value = serde_json::from_str(&plan).unwrap();
    assert!(plan["sqlite"][0]["detail"].as_str().is_some(), "{plan}");

    run(session, "q", "DELETE FROM kunde WHERE id = 1").await;
    run(session, "q", "SELECT count(*) FROM bestellung").await;
    assert_eq!(
        first(session, "q")[0].as_deref(),
        Some("1"),
        "foreign keys must be enforced with ON DELETE CASCADE"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_designer_and_structure() {
    let harness = open(Safety::Normal).await;
    let session = &harness.session;
    let def = |name: &str, data_type: &str, nullable: bool| ColumnDef {
        name: name.into(),
        data_type: data_type.into(),
        nullable,
        default: DefaultValue::None,
        auto_increment: false,
        comment: None,
    };
    session
        .apply_create(&NewTable {
            target: target("artikel"),
            columns: vec![
                ColumnDef {
                    auto_increment: true,
                    ..def("id", "INTEGER", false)
                },
                def("titel", "TEXT", false),
            ],
            primary_key: vec!["id".into()],
        })
        .await
        .unwrap();
    run(
        session,
        "q",
        "INSERT INTO artikel (titel) VALUES ('a'), ('b')",
    )
    .await;

    let statements = session
        .apply_alter(
            &target("artikel"),
            &[
                AlterOp::ChangeColumn {
                    name: "titel".into(),
                    column: ColumnDef {
                        default: DefaultValue::Keep,
                        ..def("name", "TEXT", false)
                    },
                    position: None,
                },
                AlterOp::AddColumn {
                    column: ColumnDef {
                        default: DefaultValue::Text { value: "0".into() },
                        ..def("preis", "REAL", true)
                    },
                    position: None,
                },
                AlterOp::AddIndex {
                    name: "artikel_name".into(),
                    columns: vec!["name".into()],
                    unique: true,
                },
            ],
        )
        .await
        .unwrap();
    assert!(statements[0].contains("RENAME COLUMN"), "{statements:?}");
    let design = session.table_design(&target("artikel")).await.unwrap();
    let names: Vec<&str> = design
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect();
    assert_eq!(names, ["id", "name", "preis"]);
    assert!(design.columns[0].auto_increment);
    assert!(
        design
            .indexes
            .iter()
            .any(|index| index.name == "artikel_name" && index.unique && index.editable)
    );
    assert!(design.indexes.iter().any(|index| index.primary));

    let refused = session
        .preview_alter(
            &target("artikel"),
            &[AlterOp::ChangeColumn {
                name: "name".into(),
                column: ColumnDef {
                    default: DefaultValue::Keep,
                    ..def("name", "INTEGER", false)
                },
                position: None,
            }],
        )
        .await
        .unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert!(refused.to_string().contains("recreating"), "{refused}");

    session
        .apply_alter(
            &target("artikel"),
            &[
                AlterOp::DropIndex {
                    name: "artikel_name".into(),
                },
                AlterOp::DropColumn {
                    name: "preis".into(),
                },
            ],
        )
        .await
        .unwrap();

    session
        .run_ddl(&DdlAction::RenameObject {
            target: target("artikel"),
            kind: ObjectKind::Table,
            to: "ware".into(),
        })
        .await
        .unwrap();
    session
        .run_ddl(&DdlAction::TruncateTable {
            target: target("ware"),
        })
        .await
        .unwrap();
    run(session, "q", "SELECT count(*) FROM ware").await;
    assert_eq!(first(session, "q")[0].as_deref(), Some("0"));
    assert!(
        session
            .preview_ddl(&DdlAction::CreateDatabase { name: "x".into() })
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_dump_restores_into_a_new_file() {
    let harness = open(Safety::Normal).await;
    let session = &harness.session;
    assert_eq!(failure(&run(session, "s", SETUP).await), None);

    let dir = tempfile::tempdir().unwrap();
    let dump = dir.path().join("dump.sql");
    let summary = session
        .dump(
            "d",
            &DumpOptions {
                database: "main".into(),
                schema: None,
                tables: Vec::new(),
                structure: true,
                data: true,
                drop_existing: true,
                routines: true,
            },
            dump.clone(),
            Box::new(|_| {}),
        )
        .await
        .unwrap();
    assert_eq!(summary.tables, 3);
    assert_eq!(summary.rows, 5);
    let script = std::fs::read_to_string(&dump).unwrap();
    assert!(script.contains("PRAGMA foreign_keys = OFF;"), "{script}");
    assert!(
        script.contains("X'00FF10'") || script.contains("x'00ff10'"),
        "{script}"
    );

    let copy = dir.path().join("kopie.sqlite");
    create_sqlite_file(&copy).unwrap();
    let (_manager, restored) = open_file(dir.path(), &copy, Safety::Normal).await;
    assert_eq!(failure(&run(&restored, "r", &script).await), None);
    run(
        &restored,
        "r",
        "SELECT name, foto, saldo FROM kunde ORDER BY id",
    )
    .await;
    let row = first(&restored, "r");
    assert_eq!(row[0].as_deref(), Some("Käse 'Müller'"));
    assert_eq!(row[1].as_deref(), Some("0x00FF10"));
    assert_eq!(row[2].as_deref(), Some("12.5"));
    run(&restored, "r", "SELECT notiz FROM bestellung WHERE id = 1").await;
    assert_eq!(first(&restored, "r")[0].as_deref(), Some("zwei; Teile"));
    let failed = run(&restored, "r", "INSERT INTO kunde (name) VALUES ('')").await;
    assert!(failure(&failed).is_some(), "the trigger must be restored");
    run(
        &restored,
        "r",
        "INSERT INTO bestellung (kunde_id) VALUES (2) RETURNING id",
    )
    .await;
    assert_eq!(first(&restored, "r")[0].as_deref(), Some("4"));
    let _ = &harness.path;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_read_only_and_cancel() {
    let harness = open(Safety::Normal).await;
    assert_eq!(
        failure(&run(&harness.session, "s", "CREATE TABLE t (a)").await),
        None
    );
    let (_manager, reader) = open_file(harness._dir.path(), &harness.path, Safety::ReadOnly).await;
    let blocked = Mutex::new(Vec::new());
    let result = reader
        .execute(
            "r",
            Some("main"),
            "INSERT INTO t VALUES (1)",
            QUERY_ROW_CAP,
            &|event| blocked.lock().unwrap().push(event),
        )
        .await;
    let rejected = result.is_err() || failure(&blocked.into_inner().unwrap()).is_some();
    assert!(rejected, "a read-only SQLite connection must reject writes");

    let session = harness.session.clone();
    let running = tokio::spawn(async move {
        run(
            &session,
            "slow",
            "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT count(*) FROM n",
        )
        .await
    });
    tokio::time::sleep(Duration::from_millis(400)).await;
    let started = Instant::now();
    harness.session.cancel("slow").await.unwrap();
    let events = tokio::time::timeout(Duration::from_secs(10), running)
        .await
        .expect("the query must stop after cancel")
        .unwrap();
    assert!(started.elapsed() < Duration::from_secs(10));
    let message = failure(&events).expect("the cancelled query must fail");
    assert!(message.contains("interrupt"), "{message}");
    assert!(events.iter().all(|event| !matches!(
        event,
        QueryEvent::StatementFinished {
            outcome: StatementOutcome::Rows { .. },
            ..
        }
    )));
}
