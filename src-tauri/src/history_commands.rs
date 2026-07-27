use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Runtime};

use crate::library_db::{self, AdjustmentDelta, AdjustmentSnapshot};
use crate::metadata_store;

#[derive(Serialize)]
pub struct HistoryEntry {
    pub adjustments_json: String,
    pub label: Option<String>,
    pub source: Option<String>,
}

#[derive(Serialize)]
pub struct LoadEditHistoryResponse {
    pub history: Vec<HistoryEntry>,
    pub history_index: i64,
}

#[derive(Deserialize)]
pub struct SnapshotPayload {
    pub idx: i64,
    pub adjustments_json: String,
    pub description: Option<String>,
    pub created_at: i64,
    pub source: String,
}

#[derive(Deserialize)]
pub struct DeltaPayload {
    pub step_index: i64,
    pub idx: i64,
    pub adjustment_key: String,
    pub old_value: Option<String>,
    pub new_value: String,
    pub description: Option<String>,
    pub created_at: i64,
    pub source: String,
}

#[derive(Deserialize)]
pub struct SaveEditHistoryPayload {
    pub path: String,
    pub snapshot: SnapshotPayload,
    pub deltas: Vec<DeltaPayload>,
    pub history_index: i64,
    pub current_adjustments_json: String,
}

#[tauri::command]
pub fn load_edit_history<R: Runtime>(
    app_handle: AppHandle<R>,
    path: String,
) -> Result<LoadEditHistoryResponse, String> {
    let file_id = match library_db::get_file_id_by_path(&app_handle, &path)? {
        Some(id) => id,
        None => {
            return Ok(LoadEditHistoryResponse {
                history: Vec::new(),
                history_index: 0,
            });
        }
    };

    let edit_history = match library_db::load_edit_history(&app_handle, file_id)? {
        Some(h) => h,
        None => {
            return Ok(LoadEditHistoryResponse {
                history: Vec::new(),
                history_index: 0,
            });
        }
    };

    let (states, active_index) = library_db::reconstruct_history(
        &edit_history.snapshot,
        &edit_history.deltas,
        edit_history.history_index,
    )?;

    // Group deltas by step_index to extract per-step labels and panel sources.
    let mut labels: Vec<Option<String>> = vec![None; states.len()];
    let mut sources: Vec<Option<String>> = vec![None; states.len()];
    labels[0] = edit_history.snapshot.description.clone();
    sources[0] = if edit_history.snapshot.source.is_empty() {
        None
    } else {
        Some(edit_history.snapshot.source.clone())
    };
    for delta in &edit_history.deltas {
        let step = (delta.step_index + 1) as usize;
        if step < labels.len() && labels[step].is_none() {
            labels[step] = delta.description.clone();
        }
        if step < sources.len() && sources[step].is_none() && !delta.source.is_empty() {
            sources[step] = Some(delta.source.clone());
        }
    }

    let history = states
        .into_iter()
        .zip(labels)
        .zip(sources)
        .map(|((adjustments_json, label), source)| HistoryEntry {
            adjustments_json,
            label,
            source,
        })
        .collect();

    Ok(LoadEditHistoryResponse {
        history,
        history_index: active_index,
    })
}

#[tauri::command]
pub async fn save_edit_history<R: Runtime>(
    app_handle: AppHandle<R>,
    payload: SaveEditHistoryPayload,
) -> Result<(), String> {
    log::info!(
        "[history-persistence] save_edit_history called for {} with {} deltas, index {}",
        payload.path,
        payload.deltas.len(),
        payload.history_index
    );

    let app_handle_clone = app_handle.clone();
    let path = payload.path.clone();

    let result = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::task::spawn_blocking(move || {
            let file_id = metadata_store::resolve_file_id(&app_handle_clone, None, &path)?;
            log::info!("[history-persistence] resolved file_id={}", file_id);

            let snapshot = AdjustmentSnapshot {
                idx: payload.snapshot.idx,
                adjustments_json: payload.snapshot.adjustments_json,
                description: payload.snapshot.description,
                created_at: payload.snapshot.created_at,
                source: payload.snapshot.source,
            };

            let deltas: Vec<AdjustmentDelta> = payload
                .deltas
                .into_iter()
                .map(|d| AdjustmentDelta {
                    step_index: d.step_index,
                    idx: d.idx,
                    adjustment_key: d.adjustment_key,
                    old_value: d.old_value,
                    new_value: d.new_value,
                    description: d.description,
                    created_at: d.created_at,
                    source: d.source,
                })
                .collect();

            library_db::save_edit_history(
                &app_handle_clone,
                file_id,
                &snapshot,
                &deltas,
                payload.history_index,
                &payload.current_adjustments_json,
            )
        }),
    )
    .await;

    match result {
        Ok(Ok(Ok(()))) => {
            log::info!(
                "[history-persistence] save_edit_history succeeded for {}",
                payload.path
            );
            Ok(())
        }
        Ok(Ok(Err(e))) => {
            log::error!(
                "[history-persistence] save_edit_history failed for {}: {}",
                payload.path,
                e
            );
            Err(e)
        }
        Ok(Err(join_err)) => {
            log::error!(
                "[history-persistence] save_edit_history task panicked for {}: {}",
                payload.path,
                join_err
            );
            Err(join_err.to_string())
        }
        Err(_) => {
            log::error!(
                "[history-persistence] save_edit_history timed out for {}",
                payload.path
            );
            Err("save_edit_history timed out".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tauri::Manager;
    use tauri::test::mock_app;

    #[tokio::test]
    async fn test_save_edit_history_command_completes() {
        let app = mock_app();
        let handle = app.app_handle().clone();
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.arw");
        let path_str = path.to_str().unwrap().to_string();

        let payload = SaveEditHistoryPayload {
            path: path_str.clone(),
            snapshot: SnapshotPayload {
                idx: 0,
                adjustments_json: r#"{"exposure":0.0}"#.to_string(),
                description: None,
                created_at: 1,
                source: "adjust".to_string(),
            },
            deltas: vec![DeltaPayload {
                step_index: 0,
                idx: 0,
                adjustment_key: "exposure".to_string(),
                old_value: None,
                new_value: "0.5".to_string(),
                description: None,
                created_at: 2,
                source: "adjust".to_string(),
            }],
            history_index: 1,
            current_adjustments_json: r#"{"exposure":0.5}"#.to_string(),
        };

        let result = save_edit_history(handle.clone(), payload).await;
        assert!(
            result.is_ok(),
            "save_edit_history failed: {:?}",
            result.err()
        );

        let db_path = handle.path().app_data_dir().unwrap().join("library.db");
        let conn = Connection::open(&db_path).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM file_adjustment_snapshots",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 0, "snapshot was not written");
    }
}
