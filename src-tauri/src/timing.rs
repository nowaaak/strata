use std::future::Future;
use std::time::Instant;

pub async fn timed<T, E>(
    command: &'static str,
    work: impl Future<Output = Result<T, E>>,
) -> Result<T, E> {
    let started = Instant::now();
    let result = work.await;
    let elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    tracing::info!(command, elapsed_ms, ok = result.is_ok(), "command timing");
    result
}
