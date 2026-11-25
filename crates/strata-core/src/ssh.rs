use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

use crate::profiles::{SshAuth, SshConfig};
use crate::{CoreError, CoreResult};

const SSH_TIMEOUT: Duration = Duration::from_secs(15);
const KEEPALIVE: Duration = Duration::from_secs(30);

struct HostKeyCheck {
    expected: Option<String>,
    seen: Arc<Mutex<Option<String>>>,
}

impl client::Handler for HostKeyCheck {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        let trusted = self.expected.as_deref() == Some(fingerprint.as_str());
        *self
            .seen
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(fingerprint);
        Ok(trusted)
    }
}

#[derive(Clone)]
struct Endpoint {
    config: SshConfig,
    secret: Option<String>,
}

async fn connect(endpoint: &Endpoint) -> CoreResult<Handle<HostKeyCheck>> {
    let config = &endpoint.config;
    let seen = Arc::new(Mutex::new(None));
    let handler = HostKeyCheck {
        expected: config.host_key.clone(),
        seen: seen.clone(),
    };
    let client_config = Arc::new(client::Config {
        keepalive_interval: Some(KEEPALIVE),
        inactivity_timeout: None,
        nodelay: true,
        ..client::Config::default()
    });
    let attempt = client::connect(client_config, (config.host.as_str(), config.port), handler);
    let mut handle = match tokio::time::timeout(SSH_TIMEOUT, attempt).await {
        Err(_) => {
            return Err(CoreError::Connection(format!(
                "SSH connection to {}:{} timed out",
                config.host, config.port
            )));
        }
        Ok(Ok(handle)) => handle,
        Ok(Err(err)) => {
            let seen = seen
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone();
            return Err(match (seen, &config.host_key) {
                (Some(fingerprint), None) => CoreError::SshHostKeyUnknown {
                    host: config.host.clone(),
                    fingerprint,
                },
                (Some(fingerprint), Some(expected)) if &fingerprint != expected => {
                    CoreError::SshHostKeyChanged {
                        host: config.host.clone(),
                        expected: expected.clone(),
                        fingerprint,
                    }
                }
                _ => CoreError::Connection(format!(
                    "SSH connection to {}:{} failed: {err}",
                    config.host, config.port
                )),
            });
        }
    };

    let auth = match &config.auth {
        SshAuth::Password => {
            handle
                .authenticate_password(
                    config.user.clone(),
                    endpoint.secret.clone().unwrap_or_default(),
                )
                .await
        }
        SshAuth::KeyFile { path } => {
            let passphrase = endpoint.secret.as_deref().filter(|value| !value.is_empty());
            let key = russh::keys::load_secret_key(path, passphrase).map_err(|err| {
                CoreError::InvalidInput(format!("SSH key {path} could not be read: {err}"))
            })?;
            let hash = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|err| CoreError::Connection(format!("SSH negotiation failed: {err}")))?
                .flatten();
            handle
                .authenticate_publickey(
                    config.user.clone(),
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
        }
    }
    .map_err(|err| CoreError::Connection(format!("SSH authentication failed: {err}")))?;
    if !auth.success() {
        return Err(CoreError::Connection(format!(
            "SSH server {} rejected the credentials of {}",
            config.host, config.user
        )));
    }
    Ok(handle)
}

pub struct SshTunnel {
    local_port: u16,
    task: JoinHandle<()>,
}

impl SshTunnel {
    pub async fn open(
        config: SshConfig,
        secret: Option<String>,
        target_host: String,
        target_port: u16,
    ) -> CoreResult<Self> {
        let endpoint = Endpoint { config, secret };
        let handle = connect(&endpoint).await?;
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|err| {
            CoreError::Connection(format!("tunnel port could not be opened: {err}"))
        })?;
        let local_port = listener
            .local_addr()
            .map_err(|err| CoreError::Connection(format!("tunnel port is unknown: {err}")))?
            .port();
        let shared = Arc::new(tokio::sync::Mutex::new(Some(handle)));
        let target = Arc::new((target_host, target_port));
        let task = tokio::spawn(async move {
            loop {
                let (socket, peer) = match listener.accept().await {
                    Ok(accepted) => accepted,
                    Err(err) => {
                        tracing::warn!(error = %err, "ssh tunnel stopped accepting connections");
                        return;
                    }
                };
                let shared = shared.clone();
                let endpoint = endpoint.clone();
                let target = target.clone();
                tokio::spawn(async move {
                    if let Err(err) =
                        forward(socket, peer.port(), &shared, &endpoint, &target).await
                    {
                        tracing::warn!(kind = err.kind(), error = %err, "ssh tunnel connection failed");
                    }
                });
            }
        });
        tracing::info!(local_port, "ssh tunnel opened");
        Ok(Self { local_port, task })
    }

    pub fn local_port(&self) -> u16 {
        self.local_port
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.task.abort();
        tracing::info!(local_port = self.local_port, "ssh tunnel closed");
    }
}

async fn forward(
    mut socket: TcpStream,
    origin_port: u16,
    shared: &tokio::sync::Mutex<Option<Handle<HostKeyCheck>>>,
    endpoint: &Endpoint,
    target: &(String, u16),
) -> CoreResult<()> {
    let channel = {
        let mut guard = shared.lock().await;
        let reusable = guard.as_ref().is_some_and(|handle| !handle.is_closed());
        if !reusable {
            tracing::info!("reconnecting ssh tunnel");
            *guard = Some(connect(endpoint).await?);
        }
        let handle = guard
            .as_ref()
            .ok_or_else(|| CoreError::Connection("SSH session is unavailable".into()))?;
        handle
            .channel_open_direct_tcpip(
                target.0.clone(),
                u32::from(target.1),
                "127.0.0.1",
                u32::from(origin_port),
            )
            .await
            .map_err(|err| {
                CoreError::Connection(format!(
                    "SSH server could not reach {}:{}: {err}",
                    target.0, target.1
                ))
            })?
    };
    let mut stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut socket, &mut stream)
        .await
        .map_err(|err| CoreError::Connection(format!("SSH tunnel transfer failed: {err}")))?;
    Ok(())
}
