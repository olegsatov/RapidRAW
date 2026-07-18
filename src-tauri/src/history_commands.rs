use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::library_db::{self, AdjustmentDelta, AdjustmentSnapshot};
use crate::metadata_store;

#[derive(Serialize)]
pub struct HistoryEntry {
    pub adjustments_json: String,
    pub label: Option<String>,
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

    // Group deltas by step_index to extract per-step labels.
    let mut labels: Vec<Option<String>> = vec![None; states.len()];
    labels[0] = edit_history.snapshot.description.clone();
    for delta in &edit_history.deltas {
        let step = (delta.step_index + 1) as usize;
        if step < labels.len() && labels[step].is_none() {
            labels[step] = delta.description.clone();
        }
    }

    let history = states
        .into_iter()
        .zip(labels)
        .map(|(adjustments_json, label)| HistoryEntry {
            adjustments_json,
            label,
        })
        .collect();

    Ok(LoadEditHistoryResponse {
        history,
        history_index: active_index,
    })
}

#[tauri::command]
pub fn save_edit_history<R: Runtime>(
    app_handle: AppHandle<R>,
    payload: SaveEditHistoryPayload,
) -> Result<(), String> {
    let file_id = metadata_store::resolve_file_id(&app_handle, None, &payload.path)?;

    let snapshot = AdjustmentSnapshot {
        idx: payload.snapshot.idx,
        adjustments_json: payload.snapshot.adjustments_json,
        description: payload.snapshot.description,
        created_at: payload.snapshot.created_at,
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
        })
        .collect();

    library_db::save_edit_history(
        &app_handle,
        file_id,
        &snapshot,
        &deltas,
        payload.history_index,
        &payload.current_adjustments_json,
    )
}
