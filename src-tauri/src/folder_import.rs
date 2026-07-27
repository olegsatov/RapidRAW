use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;
use walkdir::WalkDir;

use crate::app_settings::load_settings;
use crate::app_state::{AppState, FolderImportHandle};
use crate::exif_processing;
use crate::file_management::{self, ImageFile, ReadFileError};
use crate::formats::{is_raw_file, is_supported_image_file};
use crate::gpu_processing;
use crate::library_db::{self, FileRowInput, StructuredExif};
use crate::tagging::{COLOR_TAG_PREFIX, USER_TAG_PREFIX};

/// Pure filesystem check used by the frontend to show whether a tracked
/// root/pinned folder is currently reachable (online) or unavailable
/// (offline). Runs on the blocking pool because `exists()` can block on
/// stale network mounts or disconnected external volumes.
#[tauri::command]
pub async fn check_path_exists(path: String) -> Result<bool, String> {
    log::debug!("[disk-read] check_path_exists: {}", path);
    tokio::task::spawn_blocking(move || std::path::Path::new(&path).exists())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_availability_watchers(
    paths: Vec<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.availability_watchers.update(&app_handle, paths)
}

/// Normalizes a folder path the same way for every command: canonicalized
/// when it exists, raw otherwise, with trailing separators stripped so a
/// user-supplied "/photos/2024/" matches the stored "/photos/2024".
fn normalize_folder_path(path: &str) -> String {
    let normalized = PathBuf::from(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .into_owned();
    let trimmed = normalized.trim_end_matches(|c| c == '/' || c == '\\');
    // Keep a lone root or a drive root ("C:") intact.
    if trimmed.is_empty() || trimmed.ends_with(':') {
        normalized
    } else {
        trimmed.to_string()
    }
}

/// Which body a tracked folder job runs. Both kinds share the job map, the
/// cancel command, and the `folder-import-*` event stream, so the frontend
/// store treats a sync exactly like an import.
#[derive(Clone, Copy)]
enum FolderJobKind {
    Import,
    Sync,
}

impl FolderJobKind {
    fn as_str(self) -> &'static str {
        match self {
            FolderJobKind::Import => "import",
            FolderJobKind::Sync => "sync",
        }
    }
}

#[tauri::command]
pub fn start_folder_import(
    app_handle: AppHandle,
    state: State<AppState>,
    path: String,
    recursive: bool,
) -> Result<String, String> {
    let normalized = normalize_folder_path(&path);
    let key = folder_key(&normalized, recursive);

    {
        let jobs = state.folder_import_jobs.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&key) {
            return Ok(key);
        }
    }

    // If the catalog already has this folder, start a delta sync instead
    // of a full import. Sync discovers new files added since the last
    // import, re-scans changed files, and removes deleted ones — exactly
    // what the user expects when re-opening a folder. The event stream is
    // identical to a fresh import (folder-import-*), so the frontend
    // needs no changes.
    if library_db::get_folder_id(&app_handle, &normalized, recursive)?.is_some() {
        return sync_folder(app_handle, state, path, recursive);
    }

    start_job(
        &app_handle,
        &state,
        normalized,
        recursive,
        FolderJobKind::Import,
    )
}

/// Starts (or attaches to) a delta sync of a cataloged folder: new files are
/// upserted, changed files re-scanned, missing files removed from the
/// catalog, then the EXIF and thumbnail phases run like in an import.
#[tauri::command]
pub fn sync_folder(
    app_handle: AppHandle,
    state: State<AppState>,
    path: String,
    recursive: bool,
) -> Result<String, String> {
    let normalized = normalize_folder_path(&path);
    start_job(
        &app_handle,
        &state,
        normalized,
        recursive,
        FolderJobKind::Sync,
    )
}

/// Spawns and tracks a folder job, or attaches to the one already running
/// for the same (path, recursive) key. Shared by import and sync.
fn start_job(
    app_handle: &AppHandle,
    state: &State<AppState>,
    normalized: String,
    recursive: bool,
    kind: FolderJobKind,
) -> Result<String, String> {
    let key = folder_key(&normalized, recursive);

    {
        let jobs = state.folder_import_jobs.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&key) {
            log::info!(
                "[sync] start_job check: key={} already in map, reusing",
                key
            );
            return Ok(key);
        }
    }
    log::info!(
        "[sync] start_job check: key={} not in map, spawning new",
        key
    );

    let cancel = Arc::new(AtomicBool::new(false));
    let processed = Arc::new(AtomicUsize::new(0));
    let cancel_clone = cancel.clone();
    let cancel_for_cleanup = cancel.clone();
    let app_clone = app_handle.clone();
    let app_for_job = app_clone.clone();
    let key_clone = key.clone();
    let path_for_job = normalized.clone();

    let handle: JoinHandle<()> = tauri::async_runtime::spawn(async move {
        match kind {
            FolderJobKind::Import => {
                run_import_job(app_for_job, path_for_job, recursive, cancel_clone).await
            }
            FolderJobKind::Sync => {
                run_sync_job(app_for_job, path_for_job, recursive, cancel_clone).await
            }
        }
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
                slot.insert(FolderImportHandle {
                    cancel,
                    handle,
                    processed,
                });
            }
        }
    }

    let _ = app_handle.emit(
        "folder-import-started",
        serde_json::json!({
            "path": normalized,
            "recursive": recursive,
            "kind": kind.as_str(),
        }),
    );

    Ok(key)
}

#[tauri::command]
pub fn cancel_folder_import(
    app_handle: AppHandle,
    state: State<AppState>,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let normalized = normalize_folder_path(&path);
    let key = folder_key(&normalized, recursive);
    let handle = {
        let mut jobs = state.folder_import_jobs.lock().map_err(|e| e.to_string())?;
        jobs.remove(&key)
    };
    if let Some(job) = handle {
        job.cancel.store(true, Ordering::SeqCst);
        // The abort kills the job task, so the cooperative emit_cancelled
        // checks inside the job never run — emit here, with the
        // normalized path the frontend store keys on.
        let processed = job.processed.load(Ordering::Relaxed);
        job.handle.abort();
        emit_cancelled(&app_handle, &normalized, recursive, processed);
    }
    Ok(())
}

/// Points the catalog at a folder's new location without a rescan: rewrites
/// the `folders` row and every file path under the old prefix, then updates
/// album memberships the same way an interactive folder rename does.
/// Rejected while an import/sync job for the old path is still running — the
/// job would keep writing rows under the old path.
#[tauri::command]
pub fn locate_folder(
    app_handle: AppHandle,
    state: State<AppState>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let normalized_old = normalize_folder_path(&old_path);
    let normalized_new = normalize_folder_path(&new_path);
    if normalized_old == normalized_new {
        return Ok(());
    }

    {
        let jobs = state.folder_import_jobs.lock().map_err(|e| e.to_string())?;
        for recursive in [false, true] {
            if jobs.contains_key(&folder_key(&normalized_old, recursive)) {
                return Err(format!(
                    "an import/sync job is still running for {}",
                    normalized_old
                ));
            }
        }
    }

    if !library_db::relocate_folder(&app_handle, &normalized_old, &normalized_new)? {
        return Err(format!("folder is not in the catalog: {}", normalized_old));
    }
    crate::file_management::sync_album_path_changes(
        &app_handle,
        None,
        None,
        Some((&normalized_old, &normalized_new)),
    );
    let _ = app_handle.emit(
        "folder-located",
        serde_json::json!({
            "oldPath": normalized_old,
            "newPath": normalized_new,
        }),
    );
    Ok(())
}

/// Returns one page of a cataloged folder's files as fully-populated
/// `ImageFile`s (EXIF included once the EXIF phase has run). The frontend
/// pages through these on `folder-import-catalog-ready` to restore a folder's
/// listing without a rescan, and on `folder-import-complete` to refresh EXIF.
#[tauri::command]
pub async fn load_folder_files(
    app_handle: AppHandle,
    path: String,
    recursive: bool,
    offset: usize,
    limit: usize,
) -> Result<Vec<ImageFile>, String> {
    // Catalog-only: this command must never touch the source disk. The path is
    // used as a prefix against the file paths stored in the catalog.
    log::info!(
        "[catalog] load_folder_files: path={} recursive={} offset={} limit={}",
        path,
        recursive,
        offset,
        limit
    );
    match tauri::async_runtime::spawn_blocking(move || {
        library_db::load_folder_files_for_path(&app_handle, &path, recursive, offset, limit)
    })
    .await
    {
        Ok(Ok(files)) => Ok(files),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Failed to execute load folder files task: {}", e)),
    }
}

/// Returns whether the requested path is part of the catalog. Used by the
/// frontend to decide whether selecting a folder can be served from the catalog
/// or needs a manual import.
#[tauri::command]
pub async fn is_folder_cataloged(app_handle: AppHandle, path: String) -> Result<bool, String> {
    match tauri::async_runtime::spawn_blocking(move || {
        library_db::is_folder_cataloged(&app_handle, &path)
    })
    .await
    {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!(
            "Failed to execute folder catalog check task: {}",
            e
        )),
    }
}

fn folder_key(path: &str, recursive: bool) -> String {
    format!("{}|{}", path, recursive)
}

// Every `folder-import-*` payload carries `path` and `recursive` so the
// frontend store can key jobs by `path|recursive` — both variants may run
// concurrently for the same path.
fn emit_error(app_handle: &AppHandle, path: &str, recursive: bool, message: &str) {
    let _ = app_handle.emit(
        "folder-import-error",
        serde_json::json!({ "path": path, "recursive": recursive, "message": message }),
    );
}

fn emit_cancelled(app_handle: &AppHandle, path: &str, recursive: bool, processed: usize) {
    let _ = app_handle.emit(
        "folder-import-cancelled",
        serde_json::json!({ "path": path, "recursive": recursive, "processed": processed }),
    );
}

fn emit_complete(app_handle: &AppHandle, path: &str, recursive: bool, total: usize, errors: usize) {
    let _ = app_handle.emit(
        "folder-import-complete",
        serde_json::json!({ "path": path, "recursive": recursive, "total": total, "errors": errors }),
    );
}

fn update_job_processed(app_handle: &AppHandle, key: &str, processed: usize) {
    let state = app_handle.state::<AppState>();
    if let Ok(jobs) = state.folder_import_jobs.lock() {
        if let Some(job) = jobs.get(key) {
            job.processed.store(processed, Ordering::Relaxed);
        }
    }
}

const SCAN_CHUNK_SIZE: usize = 128;

/// One supported image file plus the sidecars that belong to it
/// (`None` = base sidecar, `Some(id)` = virtual-copy sidecar).
#[derive(Debug, Clone)]
struct ScanEntry {
    path_str: String,
    file_name: String,
    path_buf: PathBuf,
    sidecars: Vec<Option<String>>,
    modified: u64,
    size: u64,
}

fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

fn classify_entry(
    entry_path: &Path,
    images: &mut Vec<PathBuf>,
    sidecars_by_path: &mut HashMap<PathBuf, Vec<Option<String>>>,
) {
    let file_name = entry_path.file_name().unwrap_or_default().to_string_lossy();
    if is_hidden_name(&file_name) {
        return;
    }
    if let Some((source_filename, copy_id)) = file_management::parse_sidecar_filename(&file_name) {
        if is_hidden_name(&source_filename) {
            return;
        }
        if let Some(parent) = entry_path.parent() {
            sidecars_by_path
                .entry(parent.join(source_filename))
                .or_default()
                .push(copy_id);
        }
    } else if is_supported_image_file(entry_path) {
        images.push(entry_path.to_path_buf());
    }
}

/// Collects supported image files (grouped with their `.rrdata` sidecars),
/// mirroring the grouping logic of the `list_images_*` commands. Stops early
/// when `cancel` is set, returning what was found so far. Hidden files and
/// hidden directories are always skipped.
fn collect_image_paths(
    root: &str,
    recursive: bool,
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<ScanEntry>, String> {
    let mut images: Vec<PathBuf> = Vec::new();
    let mut sidecars_by_path: HashMap<PathBuf, Vec<Option<String>>> = HashMap::new();

    if recursive {
        let walker = WalkDir::new(root).into_iter();
        for entry in walker
            .filter_entry(|e| {
                // Always keep the root directory so a hidden temp-dir name
                // does not prune the entire scan.
                if e.depth() == 0 {
                    return true;
                }
                e.file_name()
                    .to_str()
                    .map(|n| !is_hidden_name(n))
                    .unwrap_or(true)
            })
            .filter_map(|entry_result| match entry_result {
                Ok(entry) => Some(entry),
                Err(err) => {
                    // A single unreadable directory (permissions, stale
                    // network mount) must not abort the entire import.
                    // Log it so the user can investigate instead of
                    // silently missing whole subtrees.
                    log::warn!("[folder-import] walk error (skipping entry): {}", err);
                    None
                }
            })
        {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let entry_path = entry.path();
            if !entry_path.is_file() {
                continue;
            }
            classify_entry(entry_path, &mut images, &mut sidecars_by_path);
        }
    } else {
        for entry in fs::read_dir(root)
            .map_err(|e| e.to_string())?
            .filter_map(|entry_result| match entry_result {
                Ok(entry) => Some(entry),
                Err(err) => {
                    log::warn!(
                        "[folder-import] read_dir error in {} (skipping entry): {}",
                        root,
                        err
                    );
                    None
                }
            })
        {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            classify_entry(&entry.path(), &mut images, &mut sidecars_by_path);
        }
    }

    Ok(images
        .into_iter()
        .map(|path_buf| {
            let sidecars = sidecars_by_path
                .remove(&path_buf)
                .unwrap_or_else(|| vec![None]);
            let file_name = path_buf
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let path_str = path_buf.to_string_lossy().into_owned();
            let metadata = fs::metadata(&path_buf).ok();
            let modified = metadata
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let size = metadata.map(|m| m.len()).unwrap_or(0);
            ScanEntry {
                path_str,
                file_name,
                path_buf,
                sidecars,
                modified,
                size,
            }
        })
        .collect())
}

/// Builds the catalog row for one scanned `ImageFile`. The catalog key is the
/// (possibly virtual) path, so each virtual copy gets its own row with
/// `is_virtual_copy = 1` while `name`/`extension`/`size` describe the real file.
fn file_row_input(image_file: &ImageFile, size: Option<u64>) -> Result<FileRowInput, String> {
    let source_path = file_management::parse_virtual_path(&image_file.path).0;

    let name = source_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let extension = source_path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    // Tags are stored in the sidecar as a flat list where `color:` and `user:`
    // prefixes carry the source; the color label goes into its own column.
    let mut color = None;
    let mut tags = Vec::new();
    if let Some(file_tags) = &image_file.tags {
        for tag in file_tags {
            if let Some(value) = tag.strip_prefix(COLOR_TAG_PREFIX) {
                color = Some(value.to_string());
            } else if tag.starts_with(USER_TAG_PREFIX) {
                tags.push((tag.clone(), "user".to_string()));
            } else {
                tags.push((tag.clone(), "ai".to_string()));
            }
        }
    }

    Ok(FileRowInput {
        path: image_file.path.clone(),
        name,
        modified: Some(image_file.modified),
        size,
        extension,
        is_raw: is_raw_file(&source_path),
        is_edited: image_file.is_edited,
        is_virtual_copy: image_file.is_virtual_copy,
        is_cloud_placeholder: image_file.is_cloud_placeholder,
        rating: image_file.rating,
        flag: image_file.flag,
        color,
        metadata_json: serde_json::to_string(image_file).map_err(|e| e.to_string())?,
        tags,
    })
}

/// Builds `ImageFile`s for one chunk (reusing the same per-file logic as the
/// folder-listing commands) and upserts them into the catalog. Returns the
/// files plus the number of scan entries (real files) processed, so progress
/// stays in real-file units even on a cancelled partial chunk.
async fn process_scan_chunk(
    app_handle: &AppHandle,
    folder_id: i64,
    chunk: &[ScanEntry],
    cancel: &Arc<AtomicBool>,
) -> Result<(Vec<ImageFile>, usize), String> {
    let app_handle_clone = app_handle.clone();
    let chunk = chunk.to_vec();
    let cancel = cancel.clone();

    // Size lookup is built before the chunk is moved into the blocking closure.
    let size_by_base_path: HashMap<String, u64> =
        chunk.iter().map(|e| (e.path_str.clone(), e.size)).collect();

    let (image_files, entries_processed) = tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(app_handle_clone.clone()).unwrap_or_default();
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

        let mut out = Vec::new();
        let mut processed = 0usize;
        for entry in &chunk {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            out.extend(file_management::build_image_files(
                &app_handle_clone,
                &entry.path_str,
                &entry.file_name,
                &entry.path_buf,
                entry.sidecars.clone(),
                enable_xmp_sync,
                &settings,
                entry.modified,
            ));
            processed += 1;
        }
        (out, processed)
    })
    .await
    .map_err(|e| e.to_string())?;

    let rows = image_files
        .iter()
        .map(|img| {
            let base_path = img
                .path
                .split_once("?vc=")
                .map(|(base, _)| base)
                .unwrap_or(&img.path);
            let size = size_by_base_path.get(base_path).copied();
            file_row_input(img, size)
        })
        .collect::<Result<Vec<_>, _>>()?;
    library_db::upsert_files(app_handle, folder_id, &rows)?;

    Ok((image_files, entries_processed))
}

/// Outcome of reading one file's EXIF, distinguished so the caller can decide
/// whether the row should be retried on a later run.
enum ExifReadOutcome {
    /// EXIF map (possibly empty when the file simply has no EXIF).
    Read(HashMap<String, String>),
    /// File is gone, empty, or a cloud placeholder: a terminal state, so the
    /// row is marked scanned (with cleared columns) instead of being retried
    /// forever. `sync_folder` removes orphans from the catalog.
    Missing,
    /// Transient read failure: `exif_scanned` stays 0 so the next run retries.
    Failed(String),
    Cancelled,
}

/// Reads and stores the EXIF of one catalog row. The read/parsing runs on the
/// blocking pool; the DB write happens inline (a single small transaction).
/// Returns `Ok(true)` when the row was marked scanned, `Ok(false)` when
/// cancelled, and `Err` when the file or the DB write failed (the row stays
/// pending in that case).
async fn process_exif_file(
    app_handle: &AppHandle,
    file_id: i64,
    file_path: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<bool, String> {
    let (source_path, _) = file_management::parse_virtual_path(file_path);
    let source_str = source_path.to_string_lossy().into_owned();

    let cancel_inner = cancel.clone();
    let read_path = source_path.clone();
    let read_str = source_str.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        if cancel_inner.load(Ordering::Relaxed) {
            return ExifReadOutcome::Cancelled;
        }
        if file_management::is_cloud_placeholder(&read_path) {
            return ExifReadOutcome::Missing;
        }
        match file_management::read_file_bytes(&read_path) {
            Ok(bytes) => {
                // EXIF is persisted into the catalog (structured columns and
                // `metadata_json`) by `mark_exif_scanned` below.
                ExifReadOutcome::Read(exif_processing::read_exif_data(&read_str, &bytes))
            }
            Err(ReadFileError::NotFound | ReadFileError::Invalid | ReadFileError::Empty) => {
                ExifReadOutcome::Missing
            }
            Err(e) => ExifReadOutcome::Failed(e.to_string()),
        }
    })
    .await
    .unwrap_or_else(|e| ExifReadOutcome::Failed(e.to_string()));

    match outcome {
        ExifReadOutcome::Read(map) => {
            let structured = StructuredExif::from_exif_map(&map);
            library_db::mark_exif_scanned(
                app_handle,
                file_id,
                &source_str,
                Some(&map),
                &structured,
            )?;
            Ok(true)
        }
        ExifReadOutcome::Missing => {
            library_db::mark_exif_scanned(
                app_handle,
                file_id,
                &source_str,
                None,
                &StructuredExif::default(),
            )?;
            Ok(true)
        }
        ExifReadOutcome::Failed(e) => Err(e),
        ExifReadOutcome::Cancelled => Ok(false),
    }
}

/// Phase 3: EXIF scan for catalog rows with `exif_scanned = 0`. Only pending
/// rows are processed, so a re-run after cancel (or after new files were
/// scanned in) resumes where the previous run stopped. Returns the number of
/// per-file failures for the final `folder-import-complete` tally, or `None`
/// when the phase aborted on a systemic failure (`folder-import-error`
/// already emitted) — the caller must not report completion then.
async fn run_exif_phase(
    app_handle: &AppHandle,
    path: &str,
    recursive: bool,
    folder_id: i64,
    cancel: &Arc<AtomicBool>,
) -> Option<usize> {
    let pending = match library_db::get_files_needing_exif(app_handle, folder_id) {
        Ok(pending) => pending,
        Err(e) => {
            emit_error(app_handle, path, recursive, &e);
            return None;
        }
    };
    if pending.is_empty() {
        return Some(0);
    }

    let total_exif = pending.len();
    let _ = app_handle.emit(
        "folder-import-exif-started",
        serde_json::json!({ "path": path, "recursive": recursive, "total": total_exif }),
    );

    // One file at a time: EXIF parsing of RAWs is CPU-heavy, but SQLite only
    // allows one writer in WAL mode. Concurrent DB transactions from this phase
    // contend for the write lock and trip busy timeouts on slow or loaded
    // volumes; serialize the writes and keep the reads sequential too.
    let semaphore = Arc::new(Semaphore::new(1));
    let processed = Arc::new(AtomicUsize::new(0));
    let failed = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();

    for (file_id, file_path) in pending {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let Ok(permit) = semaphore.clone().acquire_owned().await else {
            break;
        };
        let app = app_handle.clone();
        let cancel_task = cancel.clone();
        let processed_task = processed.clone();
        let failed_task = failed.clone();
        let path_for_event = path.to_string();
        handles.push(tokio::spawn(async move {
            let _permit = permit;
            match process_exif_file(&app, file_id, &file_path, &cancel_task).await {
                Ok(true) => {}
                Ok(false) => return,
                Err(e) => {
                    failed_task.fetch_add(1, Ordering::Relaxed);
                    log::warn!("EXIF scan failed for {}: {}", file_path, e);
                }
            }
            let current = processed_task.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = app.emit(
                "folder-import-exif-progress",
                serde_json::json!({
                    "path": path_for_event,
                    "recursive": recursive,
                    "current": current,
                    "total": total_exif,
                }),
            );
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    let failed_count = failed.load(Ordering::Relaxed);
    if failed_count > 0 {
        log::warn!(
            "folder import EXIF phase: {} of {} files failed for {}",
            failed_count,
            total_exif,
            path
        );
    }
    Some(failed_count)
}

/// Outcome of generating one thumbnail, distinguished so files skipped on
/// purpose (cloud placeholders) are not miscounted as failures.
enum ThumbOutcome {
    /// Generated now or already present in the cache.
    Done,
    /// Cloud placeholder: skipped like the interactive queue does (the
    /// generator would also refuse it); does not count as a failure.
    Skipped,
    Failed,
    Cancelled,
}

/// Phase 2: thumbnail generation for every catalog row of the folder, real
/// files and virtual copies alike (each VC has its own sidecar/adjustments,
/// so the frontend requests thumbnails per virtual path). Cache entries are
/// keyed by the stable file_id, so a later rename/move reuses the cached
/// thumbnail instead of regenerating. Returns the number of per-file
/// failures for the final `folder-import-complete` tally, or `None` when the
/// phase aborted on a systemic failure (`folder-import-error` already
/// emitted) — the caller must not report completion then.
async fn run_thumbs_phase(
    app_handle: &AppHandle,
    path: &str,
    recursive: bool,
    folder_id: i64,
    cancel: &Arc<AtomicBool>,
) -> Option<usize> {
    let rows = match library_db::get_all_file_paths_with_modified(app_handle, folder_id) {
        Ok(rows) => rows,
        Err(e) => {
            emit_error(app_handle, path, recursive, &e);
            return None;
        }
    };
    if rows.is_empty() {
        return Some(0);
    }

    let total_thumbs = rows.len();
    let _ = app_handle.emit(
        "folder-import-thumbs-started",
        serde_json::json!({ "path": path, "recursive": recursive, "total": total_thumbs }),
    );

    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let thumb_cache_dir = match file_management::get_thumb_cache_dir(app_handle) {
        Ok(dir) => dir,
        Err(e) => {
            emit_error(app_handle, path, recursive, &e);
            return None;
        }
    };
    let gpu_context = {
        let state = app_handle.state::<AppState>();
        gpu_processing::get_or_init_gpu_context(&state, app_handle).ok()
    };

    // Two files at a time, like the EXIF phase: RAW decoding plus the GPU
    // render are heavy and the source may be a slow external volume.
    let semaphore = Arc::new(Semaphore::new(2));
    let processed = Arc::new(AtomicUsize::new(0));
    let failed = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();

    for (file_id, file_path, modified) in rows {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let Ok(permit) = semaphore.clone().acquire_owned().await else {
            break;
        };
        let app = app_handle.clone();
        let cancel_task = cancel.clone();
        let processed_task = processed.clone();
        let failed_task = failed.clone();
        let path_for_event = path.to_string();
        let settings_task = settings.clone();
        let cache_dir_task = thumb_cache_dir.clone();
        let gpu_task = gpu_context.clone();
        handles.push(tokio::spawn(async move {
            let _permit = permit;
            let cancel_inner = cancel_task.clone();
            let app_inner = app.clone();
            let gen_path = file_path.clone();
            let outcome = tauri::async_runtime::spawn_blocking(move || {
                if cancel_inner.load(Ordering::Relaxed) {
                    return ThumbOutcome::Cancelled;
                }
                let (source_path, _) = file_management::parse_virtual_path(&gen_path);
                if file_management::is_cloud_placeholder(&source_path) {
                    return ThumbOutcome::Skipped;
                }
                if file_management::generate_thumbnail_from_embedded_preview(
                    &gen_path,
                    &cache_dir_task,
                    &app_inner,
                    &settings_task,
                    Some(file_id),
                    modified,
                )
                .is_some()
                {
                    ThumbOutcome::Done
                } else {
                    match file_management::generate_single_thumbnail_and_cache(
                        &gen_path,
                        &cache_dir_task,
                        gpu_task.as_ref(),
                        None,
                        false,
                        &app_inner,
                        &settings_task,
                        Some(file_id),
                        modified,
                    ) {
                        Some(_) => ThumbOutcome::Done,
                        None => ThumbOutcome::Failed,
                    }
                }
            })
            .await
            .unwrap_or(ThumbOutcome::Failed);

            match outcome {
                ThumbOutcome::Done | ThumbOutcome::Skipped => {}
                ThumbOutcome::Failed => {
                    failed_task.fetch_add(1, Ordering::Relaxed);
                    log::warn!("thumbnail generation failed for {}", file_path);
                }
                ThumbOutcome::Cancelled => return,
            }
            let current = processed_task.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = app.emit(
                "folder-import-thumbs-progress",
                serde_json::json!({
                    "path": path_for_event,
                    "recursive": recursive,
                    "current": current,
                    "total": total_thumbs,
                }),
            );
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    let failed_count = failed.load(Ordering::Relaxed);
    if failed_count > 0 {
        log::warn!(
            "folder import thumbnail phase: {} of {} files failed for {}",
            failed_count,
            total_thumbs,
            path
        );
    }
    Some(failed_count)
}

async fn run_import_job(
    app_handle: AppHandle,
    path: String,
    recursive: bool,
    cancel: Arc<AtomicBool>,
) {
    let key = folder_key(&path, recursive);

    // Phase 1: scan the folder and write every file to the catalog.
    // Note: this phase only upserts. Rows for files deleted from disk stay in
    // the catalog until `sync_folder` removes them.
    let folder_id = match library_db::upsert_folder(&app_handle, &path, recursive) {
        Ok(id) => id,
        Err(e) => {
            emit_error(&app_handle, &path, recursive, &e);
            return;
        }
    };

    let entries = match tauri::async_runtime::spawn_blocking({
        let path = path.clone();
        let cancel = cancel.clone();
        move || collect_image_paths(&path, recursive, &cancel)
    })
    .await
    {
        Ok(Ok(entries)) => entries,
        Ok(Err(e)) => {
            emit_error(&app_handle, &path, recursive, &e);
            return;
        }
        Err(e) => {
            emit_error(&app_handle, &path, recursive, &e.to_string());
            return;
        }
    };

    // The walk may have stopped early on cancel; don't catalog a partial set.
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path, recursive, 0);
        return;
    }

    let total = entries.len();
    let _ = app_handle.emit(
        "folder-import-scan",
        serde_json::json!({
            "path": &path,
            "recursive": recursive,
            "discovered": total,
        }),
    );

    let mut scanned = 0usize;
    for chunk in entries.chunks(SCAN_CHUNK_SIZE) {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        match process_scan_chunk(&app_handle, folder_id, chunk, &cancel).await {
            Ok((files, entries_processed)) => {
                scanned += entries_processed;
                update_job_processed(&app_handle, &key, scanned);
                let _ = app_handle.emit(
                    "folder-import-batch",
                    serde_json::json!({
                        "path": &path,
                        "recursive": recursive,
                        "files": files,
                        "scanned": scanned,
                        "total": total,
                    }),
                );
            }
            // A chunk-level DB failure is almost always systemic; report it
            // once and abort the whole import (phases 2/3 would run on a
            // partial catalog, and a later `folder-import-complete` would
            // hide the failure from the UI).
            Err(e) => {
                emit_error(&app_handle, &path, recursive, &e);
                return;
            }
        }
    }

    // Phase 2: thumbnail generation with stable file_id-keyed cache entries.
    // Thumbs are produced from the embedded JPEG preview first, so the UI
    // populates quickly; the slower full RAW development path is a fallback.

    // Clean up orphan sub-folder rows that were left with zero files after
    // the ON CONFLICT reassignment above. This is a best-effort housekeeping
    // step: if it fails the import still proceeds with the scan tally intact.
    if let Err(e) = library_db::delete_orphan_folders_under(&app_handle, &path, folder_id) {
        log::warn!("[catalog] orphan cleanup failed for {}: {}", path, e);
    }
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path, recursive, scanned);
        return;
    }
    // A systemic phase failure already emitted `folder-import-error`; stop
    // here so the job never reports a false `folder-import-complete`.
    let Some(thumbs_failed) =
        run_thumbs_phase(&app_handle, &path, recursive, folder_id, &cancel).await
    else {
        return;
    };

    // Phase 3: EXIF scan for catalog rows with exif_scanned = 0 (resumable:
    // only pending rows are processed).
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path, recursive, scanned);
        return;
    }
    let Some(exif_failed) = run_exif_phase(&app_handle, &path, recursive, folder_id, &cancel).await
    else {
        return;
    };

    // Reaching here means no systemic failure occurred (those return early
    // above), so the tally is exactly the per-file EXIF/thumbnail failures.
    let errors = exif_failed + thumbs_failed;
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path, recursive, scanned);
    } else {
        if let Err(e) = library_db::update_folder_last_synced(&app_handle, folder_id) {
            emit_error(&app_handle, &path, recursive, &e);
            return;
        }
        emit_complete(&app_handle, &path, recursive, total, errors);
    }
}

/// Computes the sync delta between a disk walk and the catalog fingerprints.
/// Returns the scan entries that need a (re-)upsert — an entry qualifies when
/// its base path or any of its virtual copies is new or has a changed
/// fingerprint — plus the catalog paths to delete.
///
/// The fingerprint is `(modified, size, metadata_modified)`. `metadata_modified`
/// is a catalog dirty flag stamped by `metadata_store` on every metadata write
/// and reset to `0` when the sync (re-)upserts the row. The disk side has no
/// pending metadata change, so it compares against the clean sentinel `0`.
///
/// Rows missing from the walk are double-checked on disk before being
/// removed: the walk's `filter_map` silently swallows per-entry IO errors
/// (in recursive mode one unreadable subdirectory skips the whole subtree),
/// so absence from the walk is not proof of absence on disk. A base row is
/// kept while its file exists, a VC row (`path?vc=id`) while both its source
/// file and VC sidecar exist — a VC sidecar whose source disappeared is an
/// orphan and is removed together with the source row.
fn compute_sync_delta(
    entries: Vec<ScanEntry>,
    fingerprints: &HashMap<String, library_db::FileFingerprint>,
    cancel: &Arc<AtomicBool>,
) -> (Vec<ScanEntry>, Vec<String>) {
    let mut disk_paths: HashSet<String> = HashSet::new();
    let mut to_upsert: Vec<ScanEntry> = Vec::new();

    for entry in entries {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let modified = entry.modified;
        let size = Some(entry.size);

        let mut needs_upsert = false;
        for sidecar in &entry.sidecars {
            let catalog_path = match sidecar {
                None => entry.path_str.clone(),
                Some(id) => format!("{}?vc={}", entry.path_str, id),
            };
            disk_paths.insert(catalog_path.clone());
            // Disk has no pending metadata change, so compare against the clean
            // sentinel `0`. A catalog `metadata_modified` of `NULL` is also
            // treated as `0` by `get_folder_file_fingerprints`.
            let fingerprint = (Some(modified), size, Some(0));
            if fingerprints.get(&catalog_path) != Some(&fingerprint) {
                needs_upsert = true;
            }
        }
        if needs_upsert {
            to_upsert.push(entry);
        }
    }

    let mut removed = Vec::new();
    for path in fingerprints.keys() {
        if disk_paths.contains(path) {
            continue;
        }
        if path.contains("?vc=") {
            let (source_path, sidecar_path) = file_management::parse_virtual_path(path);
            // A virtual copy needs both its source file and its sidecar to
            // survive the sync. If either is gone the VC row is an orphan.
            let keep = source_path.exists() && sidecar_path.exists();
            if keep {
                continue;
            }
        // `exists()` is also false when the metadata is unreadable.
        } else if Path::new(path).exists() {
            continue;
        }
        removed.push(path.clone());
    }
    removed.sort();
    (to_upsert, removed)
}

/// Delta-sync job: reconciles the catalog with the disk, then runs the same
/// EXIF and thumbnail phases as an import. The event contract is identical to
/// `run_import_job` (`folder-import-*`): systemic failure → error only,
/// cancel → cancelled, otherwise complete with the per-file failure tally.
async fn run_sync_job(
    app_handle: AppHandle,
    path: String,
    recursive: bool,
    cancel: Arc<AtomicBool>,
) {
    let key = folder_key(&path, recursive);
    log::info!(
        "[sync] run_sync_job starting for {} (recursive={})",
        path,
        recursive
    );

    // A missing root (e.g. an unplugged external drive) must never reach the
    // delta: the recursive walk silently yields an empty set for a
    // nonexistent root, and an "everything is gone" delta would delete the
    // folder's whole catalog.
    if !Path::new(&path).is_dir() {
        emit_error(
            &app_handle,
            &path,
            recursive,
            "folder does not exist or is not readable",
        );
        return;
    }

    let folder_id = match library_db::upsert_folder(&app_handle, &path, recursive) {
        Ok(id) => id,
        Err(e) => {
            emit_error(&app_handle, &path, recursive, &e);
            return;
        }
    };
    log::info!("[sync] folder_id={} upserted, starting walk", folder_id);

    let entries = match tauri::async_runtime::spawn_blocking({
        let path = path.clone();
        let cancel = cancel.clone();
        move || collect_image_paths(&path, recursive, &cancel)
    })
    .await
    {
        Ok(Ok(entries)) => entries,
        Ok(Err(e)) => {
            emit_error(&app_handle, &path, recursive, &e);
            return;
        }
        Err(e) => {
            emit_error(&app_handle, &path, recursive, &e.to_string());
            return;
        }
    };
    log::info!("[sync] walk complete: {} entries found", entries.len());

    // The walk may have stopped early on cancel; don't sync a partial set.
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path, recursive, 0);
        return;
    }

    // Re-check the root after the walk: if the volume dropped mid-sync, the
    // walk returned empty/partial and the delta would delete every row.
    if !Path::new(&path).is_dir() {
        emit_error(
            &app_handle,
            &path,
            recursive,
            "folder does not exist or is not readable",
        );
        return;
    }

    let total = entries.len();
    log::info!(
        "[sync] emitting folder-import-scan for {} (recursive={}) with discovered={}",
        path,
        recursive,
        total
    );
    let _ = app_handle.emit(
        "folder-import-scan",
        serde_json::json!({
            "path": &path,
            "recursive": recursive,
            "discovered": total,
        }),
    );

    let fingerprints = match library_db::get_folder_file_fingerprints(&app_handle, folder_id) {
        Ok(fingerprints) => fingerprints,
        Err(e) => {
            emit_error(&app_handle, &path, recursive, &e);
            return;
        }
    };
    let cataloged_count = fingerprints.len();

    // Guard against a disconnected or unreadable volume: if the walk returned
    // empty but the catalog has files, the delta below would mark every
    // cataloged file as removed. Abort when the walk finds nothing while the
    // catalog still has rows — a disconnected network share returns 0 entries
    // while `Path::is_dir()` may still report true on macOS.
    if entries.is_empty() && cataloged_count > 0 {
        log::warn!(
            "[sync] walk returned 0 entries but catalog has {} files — \
             volume may be disconnected; aborting sync to prevent data loss",
            cataloged_count
        );
        emit_error(
            &app_handle,
            &path,
            recursive,
            "folder appears empty or unreadable; sync aborted to prevent data loss",
        );
        return;
    }

    // The delta stats every file and sidecar; run it off the async executor
    // like the walk itself.
    log::info!(
        "[sync] computing delta for {} ({} catalog rows)",
        path,
        cataloged_count
    );
    let delta = tauri::async_runtime::spawn_blocking({
        let cancel = cancel.clone();
        move || compute_sync_delta(entries, &fingerprints, &cancel)
    })
    .await;
    let (to_upsert, removed) = match delta {
        Ok(delta) => delta,
        Err(e) => {
            emit_error(&app_handle, &path, recursive, &e.to_string());
            return;
        }
    };
    log::info!(
        "[sync] delta computed for {}: {} to upsert, {} to remove",
        path,
        to_upsert.len(),
        removed.len()
    );

    // A cancelled partial delta must not be applied.
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path, recursive, 0);
        return;
    }

    // Removals first, so the EXIF/thumbnail phases never touch dead rows.
    if let Err(e) = library_db::delete_files_by_paths(&app_handle, &removed) {
        emit_error(&app_handle, &path, recursive, &e);
        return;
    }

    // Upsert new and changed entries in chunks. `total` is the number of
    // entries to (re-)process — not the whole folder — so batch progress
    // still runs 0 → 100%.
    let upsert_total = to_upsert.len();
    log::info!(
        "[sync] starting upsert phase for {}: {} entries",
        path,
        upsert_total
    );
    let mut scanned = 0usize;
    for chunk in to_upsert.chunks(SCAN_CHUNK_SIZE) {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        match process_scan_chunk(&app_handle, folder_id, chunk, &cancel).await {
            Ok((files, entries_processed)) => {
                scanned += entries_processed;
                update_job_processed(&app_handle, &key, scanned);
                let _ = app_handle.emit(
                    "folder-import-batch",
                    serde_json::json!({
                        "path": &path,
                        "recursive": recursive,
                        "files": files,
                        "scanned": scanned,
                        "total": upsert_total,
                    }),
                );
            }
            // Same rule as the import: a chunk-level DB failure is systemic;
            // report once and abort rather than completing on a partial sync.
            Err(e) => {
                emit_error(&app_handle, &path, recursive, &e);
                return;
            }
        }
    }

    // Phase 2: thumbnails for every catalog row. The fast embedded-preview
    // path runs first so the UI updates quickly; full RAW development is the
    // fallback for files without a usable preview.
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path, recursive, scanned);
        return;
    }
    log::info!("[sync] starting thumbnail phase for {}", path);
    // A systemic phase failure already emitted `folder-import-error`; stop
    // here so the job never reports a false `folder-import-complete`.
    let Some(thumbs_failed) =
        run_thumbs_phase(&app_handle, &path, recursive, folder_id, &cancel).await
    else {
        return;
    };

    // Phase 3: EXIF scan for rows with exif_scanned = 0 (unchanged files kept
    // their flag through the upsert; new and changed rows are pending).
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path, recursive, scanned);
        return;
    }
    log::info!("[sync] starting EXIF phase for {}", path);
    let Some(exif_failed) = run_exif_phase(&app_handle, &path, recursive, folder_id, &cancel).await
    else {
        return;
    };

    let errors = exif_failed + thumbs_failed;
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path, recursive, scanned);
    } else {
        if let Err(e) = library_db::update_folder_last_synced(&app_handle, folder_id) {
            emit_error(&app_handle, &path, recursive, &e);
            return;
        }
        log::info!("[sync] completed for {} (errors={})", path, errors);
        emit_complete(&app_handle, &path, recursive, total, errors);
    }
}

/// Reads the `last_synced_at` timestamp for a tracked folder. Returns `None`
/// when the folder is not in the catalog.
#[tauri::command]
pub fn get_folder_last_synced(
    app_handle: AppHandle,
    path: String,
    recursive: bool,
) -> Result<Option<u64>, String> {
    let normalized = normalize_folder_path(&path);
    library_db::get_folder_last_synced(&app_handle, &normalized, recursive)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a temp folder with:
    /// - `a.jpg` + base sidecar
    /// - `b.png` + virtual-copy sidecar only
    /// - `notes.txt` (ignored)
    /// - `sub/c.jpg` (only found in recursive mode)
    fn make_test_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("a.jpg"), b"x").unwrap();
        fs::write(root.join("a.jpg.rrdata"), b"{}").unwrap();
        fs::write(root.join("b.png"), b"x").unwrap();
        fs::write(root.join("b.png.abc123.rrdata"), b"{}").unwrap();
        fs::write(root.join("notes.txt"), b"x").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub").join("c.jpg"), b"x").unwrap();
        dir
    }

    #[test]
    fn collect_flat_groups_sidecars_and_virtual_copies() {
        let dir = make_test_dir();
        let cancel = Arc::new(AtomicBool::new(false));
        let entries = collect_image_paths(dir.path().to_str().unwrap(), false, &cancel).unwrap();

        assert_eq!(entries.len(), 2);

        let a = entries.iter().find(|e| e.file_name == "a.jpg").unwrap();
        assert_eq!(a.sidecars, vec![None]);

        let b = entries.iter().find(|e| e.file_name == "b.png").unwrap();
        assert_eq!(b.sidecars, vec![Some("abc123".to_string())]);
    }

    #[test]
    fn collect_recursive_includes_subdirectories() {
        let dir = make_test_dir();
        let cancel = Arc::new(AtomicBool::new(false));
        let entries = collect_image_paths(dir.path().to_str().unwrap(), true, &cancel).unwrap();

        assert_eq!(entries.len(), 3);
        let c = entries.iter().find(|e| e.file_name == "c.jpg").unwrap();
        assert!(c.path_buf.ends_with(Path::new("sub").join("c.jpg")));
        assert_eq!(c.sidecars, vec![None]);
    }

    #[test]
    fn collect_stops_early_when_cancelled() {
        let dir = make_test_dir();
        let cancel = Arc::new(AtomicBool::new(true));
        let entries = collect_image_paths(dir.path().to_str().unwrap(), true, &cancel).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn collect_missing_dir_is_an_error() {
        let cancel = Arc::new(AtomicBool::new(false));
        let result = collect_image_paths("/nonexistent/path/that/does/not/exist", false, &cancel);
        assert!(result.is_err());
    }

    #[test]
    fn collect_recursive_missing_root_is_silently_empty() {
        // WalkDir reports the missing root as a per-entry Err, which the
        // walk's filter_map swallows: Ok(empty), not Err. This is why
        // run_sync_job refuses to run when the root is not a directory —
        // an empty walk would otherwise look like "everything was deleted".
        let cancel = Arc::new(AtomicBool::new(false));
        let entries =
            collect_image_paths("/nonexistent/path/that/does/not/exist", true, &cancel).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn sync_delta_confirms_on_disk_before_removing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // Present on disk but missing from the walk (e.g. a subtree skipped
        // on an IO error): both rows must survive the sync.
        fs::write(root.join("skipped.jpg"), b"x").unwrap();
        fs::write(root.join("skipped.jpg.abc123.rrdata"), b"{}").unwrap();
        let kept = root.join("skipped.jpg").to_string_lossy().into_owned();
        let kept_vc = format!("{}?vc=abc123", kept);
        // Truly gone: base row and its VC row are removed.
        let gone = root.join("gone.jpg").to_string_lossy().into_owned();
        let gone_vc = format!("{}?vc=def456", gone);
        // Orphan VC: sidecar exists but the source file is gone.
        fs::write(root.join("orphan.jpg.999999.rrdata"), b"{}").unwrap();
        let orphan_vc = root
            .join("orphan.jpg?vc=999999")
            .to_string_lossy()
            .into_owned();

        let fingerprints: HashMap<String, library_db::FileFingerprint> = [
            (kept.clone(), (Some(1), Some(1), Some(0))),
            (kept_vc.clone(), (Some(1), Some(1), Some(0))),
            (gone.clone(), (Some(1), Some(1), Some(0))),
            (gone_vc.clone(), (Some(1), Some(1), Some(0))),
            (orphan_vc.clone(), (Some(1), Some(1), Some(0))),
        ]
        .into_iter()
        .collect();

        // An empty walk stands in for the partial-walk case.
        let cancel = Arc::new(AtomicBool::new(false));
        let (to_upsert, removed) = compute_sync_delta(Vec::new(), &fingerprints, &cancel);
        assert!(to_upsert.is_empty());
        assert_eq!(removed, vec![gone, gone_vc, orphan_vc]);
    }

    #[test]
    fn sync_delta_removes_virtual_copy_with_missing_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // Source file exists, but the VC sidecar was deleted. The base row
        // must survive while the VC row is treated as an orphan.
        fs::write(root.join("source.jpg"), b"x").unwrap();
        let base = root.join("source.jpg").to_string_lossy().into_owned();
        let missing_vc = format!("{}?vc=deadbeef", base);

        let fingerprints: HashMap<String, library_db::FileFingerprint> = [
            (base.clone(), (Some(1), Some(1), Some(0))),
            (missing_vc.clone(), (Some(1), Some(1), Some(0))),
        ]
        .into_iter()
        .collect();

        let cancel = Arc::new(AtomicBool::new(false));
        let (to_upsert, removed) = compute_sync_delta(Vec::new(), &fingerprints, &cancel);
        assert!(to_upsert.is_empty());
        assert_eq!(removed, vec![missing_vc]);
    }

    /// Regression test: `start_job` is called from sync Tauri commands
    /// (`import_folder`, `sync_folder`). It must spawn its background work
    /// through the Tauri async runtime instead of `tokio::spawn`, which panics
    /// when there is no Tokio runtime on the current thread.
    #[test]
    fn test_sync_command_spawns_without_tokio_runtime() {
        // This test runs in a normal Rust test thread (no Tokio runtime).
        // Using the Tauri async runtime to spawn must succeed from here.
        let handle = tauri::async_runtime::spawn(async {});
        handle.abort();
    }
}
