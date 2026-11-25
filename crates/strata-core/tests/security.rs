use strata_core::driver::{ConnectParams, Connection};
use strata_core::profiles::{Engine, TlsMode};

type Server = (Engine, u16, &'static str);

const MYSQL: Server = (Engine::Mysql, 33306, "root");
const MARIADB: Server = (Engine::Mysql, 33307, "root");
const POSTGRES: Server = (Engine::Postgres, 55432, "postgres");
const POSTGRES_TLS: Server = (Engine::Postgres, 55433, "postgres");

const MYSQL_CIPHER: &str = "SHOW SESSION STATUS LIKE 'Ssl_cipher'";
const PG_SSL: &str = "SELECT ssl::text FROM pg_stat_ssl WHERE pid = pg_backend_pid()";

fn params(server: Server, tls: TlsMode, read_only: bool) -> ConnectParams {
    ConnectParams {
        engine: server.0,
        host: "127.0.0.1".into(),
        port: server.1,
        user: server.2.into(),
        password: Some("strata".into()),
        database: Some("strata".into()),
        tls,
        read_only,
        tls_server_name: None,
    }
}

async fn value(conn: &mut Connection, sql: &str) -> String {
    conn.query_rows(sql)
        .await
        .unwrap()
        .into_iter()
        .next()
        .and_then(|row| row.into_iter().last().flatten())
        .unwrap_or_default()
}

async fn server_blocks_writes(server: Server, table: &str) {
    let mut writer = Connection::connect(&params(server, TlsMode::Disabled, false))
        .await
        .unwrap();
    writer
        .execute(&format!("DROP TABLE IF EXISTS {table}"))
        .await
        .unwrap();
    writer
        .execute(&format!("CREATE TABLE {table} (id int)"))
        .await
        .unwrap();

    let mut reader = Connection::connect(&params(server, TlsMode::Disabled, true))
        .await
        .unwrap();
    reader
        .query_rows(&format!("SELECT * FROM {table}"))
        .await
        .expect("reading must still work in a read-only session");
    for sql in [
        format!("INSERT INTO {table} VALUES (1)"),
        format!("CREATE TABLE {table}_new (id int)"),
        format!("ALTER TABLE {table} ADD COLUMN x int"),
        format!("TRUNCATE TABLE {table}"),
        format!("DROP TABLE {table}"),
    ] {
        let err = reader
            .execute(&sql)
            .await
            .expect_err(&format!("server must refuse: {sql}"));
        assert!(
            err.message.contains("READ ONLY") || err.message.contains("read-only"),
            "{sql}: {}",
            err.message
        );
    }
    writer
        .execute(&format!("DROP TABLE IF EXISTS {table}"))
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_read_only_session_blocks_writes_and_ddl() {
    server_blocks_writes(MYSQL, "ro_probe_mysql").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_read_only_session_blocks_writes_and_ddl() {
    server_blocks_writes(MARIADB, "ro_probe_mariadb").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_read_only_session_blocks_writes_and_ddl() {
    server_blocks_writes(POSTGRES, "ro_probe_postgres").await;
}

async fn tls_modes(server: Server, probe: &str, encrypted: fn(&str) -> bool) {
    let mut plain = Connection::connect(&params(server, TlsMode::Disabled, false))
        .await
        .unwrap();
    assert!(!encrypted(&value(&mut plain, probe).await));

    let mut tls = Connection::connect(&params(server, TlsMode::Required, false))
        .await
        .unwrap();
    assert!(encrypted(&value(&mut tls, probe).await));

    let err = Connection::connect(&params(server, TlsMode::VerifyFull, false))
        .await
        .err()
        .expect("a self-signed certificate must not pass verification");
    assert!(err.message.contains("TLS"), "{}", err.message);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mysql_tls_modes() {
    tls_modes(MYSQL, MYSQL_CIPHER, |cipher| !cipher.is_empty()).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn mariadb_tls_modes() {
    tls_modes(MARIADB, MYSQL_CIPHER, |cipher| !cipher.is_empty()).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_tls_modes() {
    tls_modes(POSTGRES_TLS, PG_SSL, |ssl| ssl == "true").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn postgres_required_tls_explains_missing_server_support() {
    let err = Connection::connect(&params(POSTGRES, TlsMode::Required, false))
        .await
        .err()
        .expect("a server without TLS must be refused when TLS is required");
    assert!(
        err.message.contains("does not support TLS"),
        "{}",
        err.message
    );
}
