use std::path::PathBuf;

use strata_core::CoreError;
use strata_core::import::{self, CsvImport, CsvOptions, CsvPreview, ImportSummary};
use tauri::State;
use tauri::ipc::Channel;

use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
pub async fn csv_preview(path: PathBuf, options: CsvOptions) -> CommandResult<CsvPreview> {
    Ok(
        tauri::async_runtime::spawn_blocking(move || import::preview(path, &options))
            .await
            .map_err(|err| CoreError::InvalidInput(format!("reading the file failed: {err}")))??,
    )
}

#[tauri::command]
pub async fn import_csv(
    state: State<'_, AppState>,
    session_id: String,
    request: CsvImport,
    on_progress: Channel<u32>,
) -> CommandResult<ImportSummary> {
    let session = state.sessions.get(&session_id)?;
    let progress = Box::new(move |rows: u32| {
        if let Err(err) = on_progress.send(rows) {
            tracing::debug!(error = %err, "import progress could not be delivered");
        }
    });
    let started = std::time::Instant::now();
    let outcome = session.import_csv(&request, progress).await;
    match &outcome {
        Ok(summary) => tracing::info!(
            rows = summary.rows,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "csv imported"
        ),
        Err(err) => tracing::warn!(kind = err.kind(), "csv import failed"),
    }
    Ok(outcome?)
}
