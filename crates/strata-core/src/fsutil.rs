use std::path::Path;

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::{CoreError, CoreResult};

pub(crate) async fn read_json_or_default<T: DeserializeOwned + Default>(
    path: &Path,
) -> CoreResult<T> {
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|err| CoreError::json(path, err)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(err) => Err(CoreError::io(path, err)),
    }
}

pub(crate) async fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> CoreResult<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|err| CoreError::json(path, err))?;
    write_atomic(path, &bytes).await
}

pub(crate) async fn write_atomic(path: &Path, bytes: &[u8]) -> CoreResult<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| CoreError::io(parent, err))?;
    }
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    let temp = std::path::PathBuf::from(temp);
    tokio::fs::write(&temp, bytes)
        .await
        .map_err(|err| CoreError::io(&temp, err))?;
    tokio::fs::rename(&temp, path)
        .await
        .map_err(|err| CoreError::io(path, err))
}
