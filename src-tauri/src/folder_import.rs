use std::collections::hash_map::Entry;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::task::JoinHandle;

use crate::app_state::{AppState, FolderImportHandle};
use crate::library_db;

#[tauri::command]
pub fn start_folder_import(
    app_handle: AppHandle,
    state: State<AppState>,
    path: String,
    recursive: bool,
) -> Result<String, String> {
    let normalized = PathBuf::from(&path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&path))
        .to_string_lossy()
        .to_string();
    let key = folder_key(&normalized, recursive);

    {
        let jobs = state.folder_import_jobs.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&key) {
            return Ok(key);
        }
    }

    // If catalog already has this folder, do not rescan on open.
    if let Some(folder_id) = library_db::get_folder_id(&app_handle, &normalized, recursive)? {
        let _ = app_handle.emit(
            "folder-import-catalog-ready",
            serde_json::json!({
                "path": normalized,
                "recursive": recursive,
                "folderId": folder_id,
            }),
        );
        return Ok(key);
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_clone = cancel.clone();
    let cancel_for_cleanup = cancel.clone();
    let app_clone = app_handle.clone();
    let app_for_job = app_clone.clone();
    let key_clone = key.clone();
    let path_for_job = normalized.clone();

    let handle: JoinHandle<()> = tokio::spawn(async move {
        run_import_job(app_for_job, path_for_job, recursive, cancel_clone).await;
        // Remove the finished job so a later import of the same folder can
        // start fresh. Only remove our own entry: if a duplicate start for the
        // same key raced us, the map may hold a different live job (or our
        // entry may already be gone). Never hold the std Mutex guard across
        // an `.await`.
        let state = app_clone.state::<AppState>();
        if let Ok(mut jobs) = state.folder_import_jobs.lock() {
            if jobs
                .get(&key_clone)
                .is_some_and(|j| Arc::ptr_eq(&j.cancel, &cancel_for_cleanup))
            {
                jobs.remove(&key_clone);
            }
        }
    });

    {
        let mut jobs = state.folder_import_jobs.lock().map_err(|e| e.to_string())?;
        match jobs.entry(key.clone()) {
            // A concurrent start for the same folder won the race; scrap the
            // task we just spawned and report the shared key as running.
            Entry::Occupied(_) => {
                handle.abort();
                return Ok(key);
            }
            Entry::Vacant(slot) => {
                slot.insert(FolderImportHandle { cancel, handle });
            }
        }
        // The task may have finished (and run its no-op cleanup) before we
        // inserted it; reap the completed handle so the folder doesn't stay
        // "running" forever. Serialized with the task's cleanup by this lock.
        if jobs.get(&key).is_some_and(|j| j.handle.is_finished()) {
            jobs.remove(&key);
        }
    }

    let _ = app_handle.emit(
        "folder-import-started",
        serde_json::json!({
            "path": normalized,
            "recursive": recursive,
        }),
    );

    Ok(key)
}

#[tauri::command]
pub fn cancel_folder_import(
    state: State<AppState>,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let normalized = PathBuf::from(&path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&path))
        .to_string_lossy()
        .to_string();
    let key = folder_key(&normalized, recursive);
    let handle = {
        let mut jobs = state.folder_import_jobs.lock().map_err(|e| e.to_string())?;
        jobs.remove(&key)
    };
    if let Some(job) = handle {
        job.cancel.store(true, Ordering::SeqCst);
        job.handle.abort();
    }
    Ok(())
}

fn folder_key(path: &str, recursive: bool) -> String {
    format!("{}|{}", path, recursive)
}

async fn run_import_job(
    app_handle: AppHandle,
    path: String,
    recursive: bool,
    cancel: Arc<AtomicBool>,
) {
    // Phase 1 (scan), Phase 2 (EXIF), and Phase 3 (thumbnails) are implemented
    // in Tasks 6, 7, and 8 respectively. Keep this stub until those tasks land.
    let _ = (app_handle, path, recursive, cancel);
}
