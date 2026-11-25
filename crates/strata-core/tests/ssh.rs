use std::sync::Arc;
use std::time::{Duration, Instant};

use russh::ChannelMsg;
use russh::client;
use russh::keys::PublicKeyOrCertificate;
use strata_core::driver::{ConnectParams, Connection};
use strata_core::profiles::{
    ConnectionProfile, Engine, PasswordUpdate, ProfileColor, ProfileStore, Safety, SshAuth,
    SshConfig, TlsMode,
};
use strata_core::secrets::MemorySecretStore;
use strata_core::session::{QUERY_ROW_CAP, QueryEvent, SessionManager};
use strata_core::ssh::SshTunnel;

const SSH_PORT: u16 = 2222;

struct AcceptAny;

impl client::Handler for AcceptAny {
    type Error = russh::Error;

    async fn check_server_key(&mut self, _: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn read_remote_file(path: &str) -> String {
    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, ("127.0.0.1", SSH_PORT), AcceptAny)
        .await
        .unwrap();
    assert!(
        handle
            .authenticate_password("tunnel", "strata")
            .await
            .unwrap()
            .success()
    );
    let mut channel = handle.channel_open_session().await.unwrap();
    channel.exec(true, format!("cat {path}")).await.unwrap();
    let mut output = Vec::new();
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => output.extend_from_slice(&data),
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }
    String::from_utf8(output).unwrap()
}

fn ssh(auth: SshAuth, host_key: Option<String>) -> SshConfig {
    SshConfig {
        host: "127.0.0.1".into(),
        port: SSH_PORT,
        user: "tunnel".into(),
        auth,
        host_key,
    }
}

async fn fingerprint() -> String {
    match SshTunnel::open(
        ssh(SshAuth::Password, None),
        Some("strata".into()),
        "mysql".into(),
        3306,
    )
    .await
    {
        Err(strata_core::CoreError::SshHostKeyUnknown { fingerprint, .. }) => fingerprint,
        other => panic!("expected an unknown host key, got {:?}", other.err()),
    }
}

fn through(tunnel: &SshTunnel, engine: Engine, user: &str, tls: TlsMode) -> ConnectParams {
    ConnectParams {
        engine,
        host: "127.0.0.1".into(),
        port: tunnel.local_port(),
        user: user.into(),
        password: Some("strata".into()),
        database: Some("strata".into()),
        tls,
        read_only: false,
        tls_server_name: Some(
            match engine {
                Engine::Mysql => "mysql",
                Engine::Postgres => "postgres",
            }
            .into(),
        ),
    }
}

async fn first_value(conn: &mut Connection, sql: &str) -> String {
    conn.query_rows(sql)
        .await
        .unwrap()
        .into_iter()
        .next()
        .and_then(|row| row.into_iter().last().flatten())
        .unwrap_or_default()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn unknown_and_changed_host_keys_are_refused() {
    let fingerprint = fingerprint().await;
    assert!(fingerprint.starts_with("SHA256:"), "{fingerprint}");

    let err = SshTunnel::open(
        ssh(SshAuth::Password, Some("SHA256:not-the-right-key".into())),
        Some("strata".into()),
        "mysql".into(),
        3306,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(err.kind(), "ssh_host_key_changed");
    assert_eq!(err.detail().as_deref(), Some(fingerprint.as_str()));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn password_tunnel_reaches_mysql_and_postgres() {
    let key = Some(fingerprint().await);
    let mysql = SshTunnel::open(
        ssh(SshAuth::Password, key.clone()),
        Some("strata".into()),
        "mysql".into(),
        3306,
    )
    .await
    .unwrap();
    let mut conn = Connection::connect(&through(&mysql, Engine::Mysql, "root", TlsMode::Disabled))
        .await
        .unwrap();
    assert_eq!(
        first_value(&mut conn, "SELECT 'über ssh'").await,
        "über ssh"
    );

    let mut encrypted =
        Connection::connect(&through(&mysql, Engine::Mysql, "root", TlsMode::Required))
            .await
            .unwrap();
    assert!(
        !first_value(&mut encrypted, "SHOW SESSION STATUS LIKE 'Ssl_cipher'")
            .await
            .is_empty()
    );

    let postgres = SshTunnel::open(
        ssh(SshAuth::Password, key),
        Some("strata".into()),
        "postgres".into(),
        5432,
    )
    .await
    .unwrap();
    let mut pg = Connection::connect(&through(
        &postgres,
        Engine::Postgres,
        "postgres",
        TlsMode::Disabled,
    ))
    .await
    .unwrap();
    assert_eq!(
        first_value(&mut pg, "SELECT current_database()").await,
        "strata"
    );

    let local_port = mysql.local_port();
    drop(mysql);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", local_port))
            .await
            .is_err(),
        "the local tunnel port must close with the tunnel"
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn wrong_password_is_rejected() {
    let key = Some(fingerprint().await);
    let err = SshTunnel::open(
        ssh(SshAuth::Password, key),
        Some("falsch".into()),
        "mysql".into(),
        3306,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(err.kind(), "connection");
    assert!(err.to_string().contains("rejected"), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn key_files_with_and_without_passphrase() {
    let key = Some(fingerprint().await);
    let dir = tempfile::tempdir().unwrap();
    let plain = dir.path().join("client");
    let protected = dir.path().join("client_protected");
    std::fs::write(&plain, read_remote_file("/keys/client").await).unwrap();
    std::fs::write(&protected, read_remote_file("/keys/client_protected").await).unwrap();
    let key_file = |path: &std::path::Path| SshAuth::KeyFile {
        path: path.display().to_string(),
    };

    let tunnel = SshTunnel::open(
        ssh(key_file(&plain), key.clone()),
        None,
        "mysql".into(),
        3306,
    )
    .await
    .unwrap();
    let mut conn = Connection::connect(&through(&tunnel, Engine::Mysql, "root", TlsMode::Disabled))
        .await
        .unwrap();
    assert_eq!(first_value(&mut conn, "SELECT 1").await, "1");

    SshTunnel::open(
        ssh(key_file(&protected), key.clone()),
        Some("geheim".into()),
        "mysql".into(),
        3306,
    )
    .await
    .unwrap();

    let err = SshTunnel::open(
        ssh(key_file(&protected), key),
        Some("falsch".into()),
        "mysql".into(),
        3306,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(err.kind(), "invalid_input", "{err}");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs docker compose -f docker-compose.test.yml up -d"]
async fn sessions_run_queries_and_cancel_through_the_tunnel() {
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
                name: "via ssh".into(),
                engine: Engine::Mysql,
                host: "mysql".into(),
                port: 3306,
                user: "root".into(),
                database: Some("strata".into()),
                tls: TlsMode::Disabled,
                color: ProfileColor::None,
                safety: Safety::Normal,
                ask_password: false,
                group: None,
                ssh: Some(ssh(SshAuth::Password, None)),
            },
            PasswordUpdate::Set {
                value: "strata".into(),
            },
            PasswordUpdate::Set {
                value: "strata".into(),
            },
        )
        .await
        .unwrap();
    let manager = SessionManager::new(profiles.clone());

    let err = manager.open(&profile.id, None).await.err().unwrap();
    assert_eq!(err.kind(), "ssh_host_key_unknown");
    profiles
        .set_ssh_host_key(&profile.id, err.detail())
        .await
        .unwrap();

    let details = manager
        .test(
            &profiles.get(&profile.id).await.unwrap(),
            &PasswordUpdate::Keep,
            &PasswordUpdate::Keep,
        )
        .await
        .unwrap();
    assert_eq!(details.flavor, "MySQL");

    let info = manager.open(&profile.id, None).await.unwrap();
    let session = manager.get(&info.session_id).unwrap();
    assert!(
        session
            .list_databases()
            .await
            .unwrap()
            .contains(&"strata".to_string())
    );

    let running = tokio::spawn({
        let session = session.clone();
        async move {
            session
                .execute(
                    "sleepy",
                    None,
                    "SELECT SLEEP(30); SELECT 2",
                    QUERY_ROW_CAP,
                    &|_: QueryEvent| {},
                )
                .await
                .unwrap()
        }
    });
    tokio::time::sleep(Duration::from_millis(800)).await;
    let started = Instant::now();
    session.cancel("sleepy").await.unwrap();
    let summary = tokio::time::timeout(Duration::from_secs(10), running)
        .await
        .expect("cancel must reach the server through the tunnel")
        .unwrap();
    assert!(summary.cancelled);
    assert!(started.elapsed() < Duration::from_secs(10));

    manager.close(&info.session_id).await.unwrap();
}
