use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;
use walkdir::WalkDir;

use crate::app_settings::load_settings;
use crate::app_state::{AppState, FolderImportHandle};
use crate::exif_processing;
use crate::file_management::{self, ImageFile, ReadFileError};
use crate::formats::{is_raw_file, is_supported_image_file};
use crate::gpu_processing;
use crate::library_db::{self, FileRowInput, StructuredExif};
use crate::tagging::{COLOR_TAG_PREFIX, USER_TAG_PREFIX};

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

fn emit_error(app_handle: &AppHandle, path: &str, message: &str) {
    let _ = app_handle.emit(
        "folder-import-error",
        serde_json::json!({ "path": path, "message": message }),
    );
}

fn emit_cancelled(app_handle: &AppHandle, path: &str) {
    let _ = app_handle.emit(
        "folder-import-cancelled",
        serde_json::json!({ "path": path }),
    );
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
}

fn classify_entry(
    entry_path: &Path,
    images: &mut Vec<PathBuf>,
    sidecars_by_path: &mut HashMap<PathBuf, Vec<Option<String>>>,
) {
    let file_name = entry_path.file_name().unwrap_or_default().to_string_lossy();
    if let Some((source_filename, copy_id)) = file_management::parse_sidecar_filename(&file_name) {
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
/// when `cancel` is set, returning what was found so far.
fn collect_image_paths(
    root: &str,
    recursive: bool,
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<ScanEntry>, String> {
    let mut images: Vec<PathBuf> = Vec::new();
    let mut sidecars_by_path: HashMap<PathBuf, Vec<Option<String>>> = HashMap::new();

    if recursive {
        for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
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
            .filter_map(Result::ok)
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
            ScanEntry {
                path_str,
                file_name,
                path_buf,
                sidecars,
            }
        })
        .collect())
}

/// Builds the catalog row for one scanned `ImageFile`. The catalog key is the
/// (possibly virtual) path, so each virtual copy gets its own row with
/// `is_virtual_copy = 1` while `name`/`extension`/`size` describe the real file.
fn file_row_input(image_file: &ImageFile) -> Result<FileRowInput, String> {
    let (source_path, sidecar_path) = file_management::parse_virtual_path(&image_file.path);

    let size = fs::metadata(&source_path).ok().map(|m| m.len());
    let sidecar_modified = fs::metadata(&sidecar_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

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
        sidecar_modified,
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
            ));
            processed += 1;
        }
        (out, processed)
    })
    .await
    .map_err(|e| e.to_string())?;

    let rows = image_files
        .iter()
        .map(file_row_input)
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
    /// forever. The sync/prune job (Task 9) removes orphans from the catalog.
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
                // `read_exif_data` also caches the map into the `.rrdata`
                // sidecar, matching the interactive `read_exif_for_paths`
                // flow.
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

/// Phase 2: EXIF scan for catalog rows with `exif_scanned = 0`. Only pending
/// rows are processed, so a re-run after cancel (or after new files were
/// scanned in) resumes where the previous run stopped. Returns the number of
/// per-file failures for the final `folder-import-complete` tally.
async fn run_exif_phase(
    app_handle: &AppHandle,
    path: &str,
    folder_id: i64,
    cancel: &Arc<AtomicBool>,
) -> usize {
    let pending = match library_db::get_files_needing_exif(app_handle, folder_id) {
        Ok(pending) => pending,
        Err(e) => {
            emit_error(app_handle, path, &e);
            return 0;
        }
    };
    if pending.is_empty() {
        return 0;
    }

    let total_exif = pending.len();
    let _ = app_handle.emit(
        "folder-import-exif-started",
        serde_json::json!({ "path": path, "total": total_exif }),
    );

    // Two files at a time: EXIF parsing of RAWs is CPU-heavy and the reads
    // may hit slow external volumes.
    let semaphore = Arc::new(Semaphore::new(2));
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
    failed_count
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

/// Phase 3: thumbnail generation for every catalog row of the folder, real
/// files and virtual copies alike (each VC has its own sidecar/adjustments,
/// so the frontend requests thumbnails per virtual path). Cache entries are
/// keyed by the stable file_id, so a later rename/move reuses the cached
/// thumbnail instead of regenerating. Returns the number of per-file
/// failures for the final `folder-import-complete` tally.
async fn run_thumbs_phase(
    app_handle: &AppHandle,
    path: &str,
    folder_id: i64,
    cancel: &Arc<AtomicBool>,
) -> usize {
    let rows = match library_db::get_all_file_paths(app_handle, folder_id) {
        Ok(rows) => rows,
        Err(e) => {
            emit_error(app_handle, path, &e);
            return 0;
        }
    };
    if rows.is_empty() {
        return 0;
    }

    let total_thumbs = rows.len();
    let _ = app_handle.emit(
        "folder-import-thumbs-started",
        serde_json::json!({ "path": path, "total": total_thumbs }),
    );

    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let thumb_cache_dir = match file_management::get_thumb_cache_dir(app_handle) {
        Ok(dir) => dir,
        Err(e) => {
            emit_error(app_handle, path, &e);
            return 0;
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

    for (file_id, file_path) in rows {
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
                match file_management::generate_single_thumbnail_and_cache(
                    &gen_path,
                    &cache_dir_task,
                    gpu_task.as_ref(),
                    None,
                    false,
                    &app_inner,
                    &settings_task,
                    Some(file_id),
                ) {
                    Some(_) => ThumbOutcome::Done,
                    None => ThumbOutcome::Failed,
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
    failed_count
}

async fn run_import_job(
    app_handle: AppHandle,
    path: String,
    recursive: bool,
    cancel: Arc<AtomicBool>,
) {
    // Phase 1: scan the folder and write every file to the catalog.
    // Note: this phase only upserts. Rows for files deleted from disk stay in
    // the catalog until the sync/prune job (Task 9) removes them.
    let folder_id = match library_db::upsert_folder(&app_handle, &path, recursive) {
        Ok(id) => id,
        Err(e) => {
            emit_error(&app_handle, &path, &e);
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
            emit_error(&app_handle, &path, &e);
            return;
        }
        Err(e) => {
            emit_error(&app_handle, &path, &e.to_string());
            return;
        }
    };

    // The walk may have stopped early on cancel; don't catalog a partial set.
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path);
        return;
    }

    let total = entries.len();
    let _ = app_handle.emit(
        "folder-import-scan",
        serde_json::json!({
            "path": &path,
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
                let _ = app_handle.emit(
                    "folder-import-batch",
                    serde_json::json!({
                        "path": &path,
                        "files": files,
                        "scanned": scanned,
                        "total": total,
                    }),
                );
            }
            // A chunk-level DB failure is almost always systemic; report it
            // once and abort the scan rather than spamming one error per
            // remaining chunk.
            Err(e) => {
                emit_error(&app_handle, &path, &e);
                break;
            }
        }
    }

    // Phase 2: EXIF scan for catalog rows with exif_scanned = 0 (resumable:
    // only pending rows are processed).
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path);
        return;
    }
    let exif_failed = run_exif_phase(&app_handle, &path, folder_id, &cancel).await;

    // Phase 3: thumbnail generation with stable file_id-keyed cache entries.
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path);
        return;
    }
    let thumbs_failed = run_thumbs_phase(&app_handle, &path, folder_id, &cancel).await;

    // Scan-phase chunk failures already reported `folder-import-error` (they
    // are systemic, not per-file), so the tally below counts only per-file
    // EXIF/thumbnail failures.
    let errors = exif_failed + thumbs_failed;
    if cancel.load(Ordering::SeqCst) {
        emit_cancelled(&app_handle, &path);
    } else {
        let _ = app_handle.emit(
            "folder-import-complete",
            serde_json::json!({ "path": &path, "errors": errors }),
        );
    }
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
}
