use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::task::JoinHandle;
use walkdir::WalkDir;

use crate::app_settings::load_settings;
use crate::app_state::{AppState, FolderImportHandle};
use crate::file_management::{self, ImageFile};
use crate::formats::{is_raw_file, is_supported_image_file};
use crate::library_db::{self, FileRowInput};
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
/// folder-listing commands) and upserts them into the catalog.
async fn process_scan_chunk(
    app_handle: &AppHandle,
    folder_id: i64,
    chunk: &[ScanEntry],
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<ImageFile>, String> {
    let app_handle_clone = app_handle.clone();
    let chunk = chunk.to_vec();
    let cancel = cancel.clone();

    let image_files = tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(app_handle_clone.clone()).unwrap_or_default();
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

        let mut out = Vec::new();
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
        }
        out
    })
    .await
    .map_err(|e| e.to_string())?;

    let rows = image_files
        .iter()
        .map(file_row_input)
        .collect::<Result<Vec<_>, _>>()?;
    library_db::upsert_files(app_handle, folder_id, &rows)?;

    Ok(image_files)
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
            Ok(files) => {
                scanned += files.len();
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

    // Phase 2 (Task 7): EXIF scan for catalog rows with exif_scanned = 0.
    // Phase 3 (Task 8): thumbnail generation.
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
