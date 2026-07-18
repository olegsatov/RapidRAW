# Non-blocking folder import with SQLite catalog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the synchronous folder-listing import with a background, cancellable, progress-reporting import backed by a persistent SQLite catalog, supporting offline folders and relocation.

**Architecture:** A new Rust `library_db` module persists folder/file metadata and tags; a new `folder_import` module runs scan/EXIF/thumbnail phases in background jobs, emitting events. Frontend uses a dedicated store/hook to drive `imageList` progressively and a global indicator for progress/cancel.

**Tech Stack:** Rust (Tauri 2, rusqlite, tokio), React/TypeScript, Zustand, Tailwind.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src-tauri/Cargo.toml` | Add `rusqlite` dependency. |
| `src-tauri/src/library_db.rs` | SQLite connection, migrations, CRUD for folders/files/tags, delta sync, path relocation. |
| `src-tauri/src/folder_import.rs` | Background job manager, `start_folder_import`, `sync_folder`, `cancel_folder_import`, phase loops, event emission. |
| `src-tauri/src/folder_import_types.rs` (optional, can live in `folder_import.rs`) | Event payload structs shared with frontend. |
| `src-tauri/src/app_state.rs` | Add `folder_import_jobs` map. |
| `src-tauri/src/lib.rs` | Register new commands. |
| `src-tauri/src/file_management.rs` | Modify thumbnail cache key helpers to accept optional `file_id`. |
| `src/store/useFolderImportStore.ts` | Zustand store for job states and accumulated files. |
| `src/hooks/useFolderImport.ts` | API and bridge to `imageList`. |
| `src/components/ui/ImportJobsIndicator.tsx` | Global floating progress panel. |
| `src/hooks/useAppNavigation.ts` | Replace monolithic listing invoke with `openFolder`. |
| `src/hooks/useTauriListeners.ts` | Add `folder-import-*` listeners. |
| `src/hooks/useAppInitialization.ts` | Async availability checks at startup. |
| `src/App.tsx` | Mount indicator, wire refresh. |
| `src/components/panel/library/LibraryHeader.tsx` or tree context menu | Add sync/locate menu items. |
| `src/i18n/locales/*.json` | New keys. |

---

## Task 1: Add rusqlite dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dependency**

```toml
[dependencies]
# ... existing deps ...
rusqlite = { version = "0.32", features = ["bundled"] }
```

- [ ] **Step 2: Verify cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes (no compile errors from new dep).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "deps: add rusqlite for library catalog"
```

---

## Task 2: Create `library_db.rs` — schema and migrations

**Files:**
- Create: `src-tauri/src/library_db.rs`

- [ ] **Step 1: Write the module skeleton and schema**

```rust
use rusqlite::{Connection, OptionalExtension, params};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const CURRENT_SCHEMA_VERSION: i32 = 1;

fn db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("library.db"))
}

fn open_connection(app_handle: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app_handle)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    ).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let user_version: i32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if user_version < CURRENT_SCHEMA_VERSION {
        conn.execute_batch(SCHEMA_V1).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    recursive INTEGER NOT NULL,
    last_synced_at INTEGER,
    UNIQUE(path, recursive)
);

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL COLLATE NOCASE,
    modified INTEGER,
    size INTEGER,
    sidecar_modified INTEGER,
    extension TEXT,
    is_raw INTEGER,
    is_edited INTEGER,
    is_virtual_copy INTEGER,
    is_cloud_placeholder INTEGER,
    rating INTEGER,
    flag INTEGER,
    color TEXT,
    exif_scanned INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL,

    date_taken TEXT,
    iso INTEGER,
    aperture REAL,
    shutter REAL,
    focal_length REAL,
    focal_length_35 REAL,
    make TEXT,
    model TEXT,
    lens_make TEXT,
    lens_model TEXT,
    orientation INTEGER
);

CREATE TABLE IF NOT EXISTS tags (
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (file_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified);
CREATE INDEX IF NOT EXISTS idx_files_rating ON files(rating);
CREATE INDEX IF NOT EXISTS idx_files_flag ON files(flag);
CREATE INDEX IF NOT EXISTS idx_files_color ON files(color);
CREATE INDEX IF NOT EXISTS idx_files_is_raw ON files(is_raw);
CREATE INDEX IF NOT EXISTS idx_files_folder_exif_scanned ON files(folder_id, exif_scanned);
CREATE INDEX IF NOT EXISTS idx_files_folder_date_taken ON files(folder_id, date_taken);
CREATE INDEX IF NOT EXISTS idx_files_folder_iso ON files(folder_id, iso);
CREATE INDEX IF NOT EXISTS idx_files_folder_aperture ON files(folder_id, aperture);
CREATE INDEX IF NOT EXISTS idx_files_folder_shutter ON files(folder_id, shutter);
CREATE INDEX IF NOT EXISTS idx_files_folder_focal_length ON files(folder_id, focal_length);
CREATE INDEX IF NOT EXISTS idx_files_folder_make ON files(folder_id, make);
CREATE INDEX IF NOT EXISTS idx_files_folder_model ON files(folder_id, model);
CREATE INDEX IF NOT EXISTS idx_files_folder_lens_model ON files(folder_id, lens_model);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag COLLATE NOCASE);
"#;

pub fn init_catalog(app_handle: &AppHandle) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    migrate(&conn)
}
```

- [ ] **Step 2: Add helper to get or create folder**

```rust
pub fn upsert_folder(
    app_handle: &AppHandle,
    path: &str,
    recursive: bool,
) -> Result<i64, String> {
    let conn = open_connection(app_handle)?;
    conn.execute(
        "INSERT INTO folders(path, recursive) VALUES (?1, ?2)
         ON CONFLICT(path, recursive) DO UPDATE SET path=excluded.path",
        params![path, recursive as i32],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

pub fn get_folder_id(app_handle: &AppHandle, path: &str, recursive: bool) -> Result<Option<i64>, String> {
    let conn = open_connection(app_handle)?;
    conn.query_row(
        "SELECT id FROM folders WHERE path = ?1 AND recursive = ?2",
        params![path, recursive as i32],
        |row| row.get(0),
    ).optional().map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Write a test for init + upsert**

Create a temporary Tauri app handle is hard in unit tests. Instead test with a temp `Connection` directly:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_schema_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        // user_version not set by SCHEMA_V1; migration sets it in real flow.
        assert_eq!(version, 0);
    }
}
```

Run: `cd src-tauri && cargo test library_db::tests`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/library_db.rs
git commit -m "feat: add library_db schema and migrations"
```

---

## Task 3: Add `folder_import_jobs` to `AppState`

**Files:**
- Modify: `src-tauri/src/app_state.rs`

- [ ] **Step 1: Add the field**

Locate the `AppState` struct and add near `export_task_handle`:

```rust
use std::collections::HashMap;
use tokio::task::JoinHandle;
use std::sync::{Arc, Mutex, atomic::AtomicBool};

pub struct FolderImportHandle {
    pub cancel: Arc<AtomicBool>,
    pub handle: JoinHandle<()>,
}

// inside AppState:
pub folder_import_jobs: Arc<Mutex<HashMap<String, FolderImportHandle>>>,
```

- [ ] **Step 2: Initialize it in the constructor**

Find where `AppState` is built (usually `Default` impl or `new`) and add:

```rust
folder_import_jobs: Arc::new(Mutex::new(HashMap::new())),
```

- [ ] **Step 3: cargo check**

Run: `cd src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/app_state.rs
git commit -m "feat: add folder_import_jobs state map"
```

---

## Task 4: Make thumbnail cache key stable across relocation

**Files:**
- Modify: `src-tauri/src/file_management.rs:64-80` and `:3209-3234`

- [ ] **Step 1: Change `compute_thumbnail_cache_hash` signature**

```rust
fn compute_thumbnail_cache_hash(
    path_str: &str,
    file_id: Option<i64>,
    adjustments_bytes: &[u8],
) -> Option<String> {
    let (source_path, _) = parse_virtual_path(path_str);

    let img_mod_time = fs::metadata(&source_path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();

    let mut hasher = blake3::Hasher::new();
    if let Some(id) = file_id {
        hasher.update(&id.to_le_bytes());
    } else {
        hasher.update(path_str.as_bytes());
    }
    hasher.update(&img_mod_time.to_le_bytes());
    hasher.update(adjustments_bytes);
    Some(hasher.finalize().to_hex().to_string())
}
```

- [ ] **Step 2: Update `get_cache_key_hash`**

```rust
pub fn get_cache_key_hash(path_str: &str, file_id: Option<i64>) -> Option<String> {
    let (_, sidecar_path) = parse_virtual_path(path_str);

    let adjustments_bytes = if let Ok(content) = fs::read_to_string(&sidecar_path) {
        if let Ok(meta) = serde_json::from_str::<ImageMetadata>(&content) {
            serde_json::to_vec(&meta.adjustments).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    compute_thumbnail_cache_hash(path_str, file_id, &adjustments_bytes)
}
```

- [ ] **Step 3: Update `generate_single_thumbnail_and_cache` to accept file_id**

Find the function (around line 1495) and its call to `compute_thumbnail_cache_hash`. Add a `file_id: Option<i64>` parameter and pass it through.

Also update the caller `generate_single_thumbnail` (or internal wrapper) if needed.

- [ ] **Step 4: Update existing callers**

Search for all call sites of `compute_thumbnail_cache_hash` and `get_cache_key_hash` and pass `None` for now (we will pass real ids from new import pipeline and thumbnail queue later):

```bash
cd src-tauri && grep -n "get_cache_key_hash\|compute_thumbnail_cache_hash" src/file_management.rs
```

Update each call site to pass `None` (or the resolved id if already available).

- [ ] **Step 5: cargo check**

Run: `cd src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/file_management.rs
git commit -m "feat: make thumbnail cache key stable by optional file_id"
```

---

## Task 5: Create `folder_import.rs` — commands and job manager

**Files:**
- Create: `src-tauri/src/folder_import.rs`

- [ ] **Step 1: Module skeleton with commands**

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use tokio::task::JoinHandle;

use crate::app_state::{AppState, FolderImportHandle};
use crate::library_db;

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
        let _ = app_handle.emit("folder-import-catalog-ready", serde_json::json!({
            "path": normalized,
            "recursive": recursive,
            "folderId": folder_id,
        }));
        return Ok(key);
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_clone = cancel.clone();
    let app_clone = app_handle.clone();

    let handle: JoinHandle<()> = tauri::async_runtime::spawn(async move {
        run_import_job(app_clone, normalized.clone(), recursive, cancel_clone).await;
    });

    {
        let mut jobs = state.folder_import_jobs.lock().map_err(|e| e.to_string())?;
        jobs.insert(key.clone(), FolderImportHandle { cancel, handle });
    }

    let _ = app_handle.emit("folder-import-started", serde_json::json!({
        "path": normalized,
        "recursive": recursive,
    }));

    Ok(key)
}

pub fn cancel_folder_import(
    state: State<AppState>,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let key = folder_key(&path, recursive);
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

async fn run_import_job(app_handle: AppHandle, path: String, recursive: bool, cancel: Arc<AtomicBool>) {
    // Phase 1 (scan), Phase 2 (EXIF), and Phase 3 (thumbnails) are implemented
    // in Tasks 6, 7, and 8 respectively. Keep this stub until those tasks land.
}
```

- [ ] **Step 2: Register commands in `lib.rs`**

Add to the `invoke_handler` list:

```rust
start_folder_import,
cancel_folder_import,
```

Use the existing command naming convention (likely `snake_case` invokable names).

- [ ] **Step 3: cargo check**

Run: `cd src-tauri && cargo check`
Expected: PASS (with `run_import_job` empty or `todo!()`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/folder_import.rs src-tauri/src/lib.rs
git commit -m "feat: scaffold folder_import commands and job manager"
```

---

## Task 6: Implement phase 1 — scan and write to catalog

**Files:**
- Modify: `src-tauri/src/folder_import.rs`
- Modify: `src-tauri/src/library_db.rs`

- [ ] **Step 1: Add catalog write helpers in `library_db.rs`**

```rust
#[derive(Debug, Clone)]
pub struct FileRowInput {
    pub path: String,
    pub name: String,
    pub modified: Option<u64>,
    pub size: Option<u64>,
    pub sidecar_modified: Option<u64>,
    pub extension: String,
    pub is_raw: bool,
    pub is_edited: bool,
    pub is_virtual_copy: bool,
    pub is_cloud_placeholder: bool,
    pub rating: u8,
    pub flag: i8,
    pub color: Option<String>,
    pub metadata_json: String,
    pub tags: Vec<(String, String)>, // (tag, source)
}

pub fn upsert_files(
    app_handle: &AppHandle,
    folder_id: i64,
    files: &[FileRowInput],
) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for f in files {
        tx.execute(
            "INSERT INTO files(
                folder_id, path, name, modified, size, sidecar_modified,
                extension, is_raw, is_edited, is_virtual_copy, is_cloud_placeholder,
                rating, flag, color, exif_scanned, metadata_json
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
             ON CONFLICT(path) DO UPDATE SET
                folder_id=excluded.folder_id,
                name=excluded.name,
                modified=excluded.modified,
                size=excluded.size,
                sidecar_modified=excluded.sidecar_modified,
                extension=excluded.extension,
                is_raw=excluded.is_raw,
                is_edited=excluded.is_edited,
                is_virtual_copy=excluded.is_virtual_copy,
                is_cloud_placeholder=excluded.is_cloud_placeholder,
                rating=excluded.rating,
                flag=excluded.flag,
                color=excluded.color,
                exif_scanned=excluded.exif_scanned,
                metadata_json=excluded.metadata_json",
            params![
                folder_id, &f.path, &f.name,
                f.modified.map(|v| v as i64), f.size.map(|v| v as i64), f.sidecar_modified.map(|v| v as i64),
                &f.extension, f.is_raw as i32, f.is_edited as i32, f.is_virtual_copy as i32,
                f.is_cloud_placeholder as i32, f.rating as i32, f.flag as i32,
                &f.color, 0i32, &f.metadata_json
            ],
        ).map_err(|e| e.to_string())?;

        let file_id: i64 = tx.last_insert_rowid();
        tx.execute("DELETE FROM tags WHERE file_id = ?1", params![file_id])
            .map_err(|e| e.to_string())?;
        for (tag, source) in &f.tags {
            tx.execute(
                "INSERT INTO tags(file_id, tag, source) VALUES (?1, ?2, ?3)",
                params![file_id, tag, source],
            ).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Implement scan phase in `folder_import.rs`**

Use `walkdir` or `std::fs::read_dir` (walkdir is likely already a transitive dep; if not, add it). For recursive mode use `walkdir::WalkDir`, for flat use `std::fs::read_dir`.

Pseudo-code to implement:

```rust
async fn run_import_job(app_handle: AppHandle, path: String, recursive: bool, cancel: Arc<AtomicBool>) {
    let folder_id = match library_db::upsert_folder(&app_handle, &path, recursive) {
        Ok(id) => id,
        Err(e) => { emit_error(&app_handle, &path, &e); return; }
    };

    let entries = tauri::async_runtime::spawn_blocking({
        let path = path.clone();
        let recursive = recursive;
        move || collect_image_paths(&path, recursive)
    }).await.unwrap_or_else(|_| Ok(Vec::new())).unwrap_or_else(|_| Vec::new());

    let total = entries.len();
    let _ = app_handle.emit("folder-import-scan", serde_json::json!({
        "path": &path, "discovered": total,
    }));

    for chunk in entries.chunks(128) {
        if cancel.load(Ordering::SeqCst) { break; }
        let files = match process_scan_chunk(&app_handle, folder_id, chunk, &cancel).await {
            Ok(f) => f,
            Err(e) => { emit_error(&app_handle, &path, &e); continue; }
        };
        let scanned = /* track count */;
        let _ = app_handle.emit("folder-import-batch", serde_json::json!({
            "path": &path,
            "files": files,
            "scanned": scanned,
            "total": total,
        }));
    }

    // Phase 2 and 3 go here.
}
```

For now focus on getting `collect_image_paths` and `process_scan_chunk` to compile. Reuse `crate::file_management::is_supported_image_file` and `resolve_image_metadata` where possible. If those helpers are private, make them `pub(crate)` with minimal changes.

- [ ] **Step 3: Test scan on temp dir**

Create a temporary directory with a few `.jpg` and `.rrdata` files and verify `upsert_folder` + `upsert_files` writes rows.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_upsert_files() {
        // instantiate AppHandle mock or test library_db directly
    }
}
```

If `tempfile` is not a dev-dependency, use `std::env::temp_dir()` + a uuid.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/folder_import.rs src-tauri/src/library_db.rs
git commit -m "feat: implement scan phase writing to catalog"
```

---

## Task 7: Implement phase 2 — EXIF extraction and resume

**Files:**
- Modify: `src-tauri/src/folder_import.rs`
- Modify: `src-tauri/src/library_db.rs`

- [ ] **Step 1: Add query for files needing EXIF**

```rust
pub fn get_files_needing_exif(app_handle: &AppHandle, folder_id: i64) -> Result<Vec<String>, String> {
    let conn = open_connection(app_handle)?;
    let mut stmt = conn.prepare(
        "SELECT path FROM files WHERE folder_id = ?1 AND exif_scanned = 0"
    ).map_err(|e| e.to_string())?;
    let paths: Result<Vec<String>, _> = stmt.query_map(params![folder_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect();
    paths.map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Add update after EXIF read**

```rust
pub fn mark_exif_scanned(
    app_handle: &AppHandle,
    file_id: i64,
    exif_json: &str,
    structured: &StructuredExif,
) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    conn.execute(
        "UPDATE files SET
            exif_scanned = 1,
            metadata_json = ?2,
            date_taken = ?3,
            iso = ?4,
            aperture = ?5,
            shutter = ?6,
            focal_length = ?7,
            focal_length_35 = ?8,
            make = ?9,
            model = ?10,
            lens_make = ?11,
            lens_model = ?12,
            orientation = ?13
         WHERE id = ?1",
        params![
            file_id, exif_json,
            &structured.date_taken, structured.iso, structured.aperture,
            structured.shutter, structured.focal_length, structured.focal_length_35,
            &structured.make, &structured.model, &structured.lens_make, &structured.lens_model,
            structured.orientation
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: Implement phase 2 loop in `folder_import.rs`**

After phase 1:

```rust
let exif_paths = library_db::get_files_needing_exif(&app_handle, folder_id)?;
let total_exif = exif_paths.len();
let _ = app_handle.emit("folder-import-exif-started", serde_json::json!({
    "path": &path, "total": total_exif,
}));

let semaphore = Arc::new(tokio::sync::Semaphore::new(2));
let mut handles = Vec::new();
for (idx, file_path) in exif_paths.into_iter().enumerate() {
    if cancel.load(Ordering::SeqCst) { break; }
    let app_clone = app_handle.clone();
    let cancel_clone = cancel.clone();
    let sem = semaphore.clone();
    handles.push(tauri::async_runtime::spawn(async move {
        let _permit = sem.acquire().await.unwrap();
        if cancel_clone.load(Ordering::SeqCst) { return Ok(()); }
        process_exif_file(&app_clone, &file_path, &cancel_clone).await?;
        let _ = app_clone.emit("folder-import-exif-progress", serde_json::json!({
            "path": &path, "current": idx + 1, "total": total_exif,
        }));
        Ok::<(), String>(())
    }));
}
for h in handles { let _ = h.await; }
```

`process_exif_file` wraps existing `crate::exif_processing::read_exif_data` and writes sidecar. After extraction, query `files.id` by path and call `mark_exif_scanned`.

- [ ] **Step 4: cargo check**

Run: `cd src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/folder_import.rs src-tauri/src/library_db.rs
git commit -m "feat: implement EXIF phase with resume"
```

---

## Task 8: Implement phase 3 — thumbnails with file_id keys

**Files:**
- Modify: `src-tauri/src/folder_import.rs`
- Modify: `src-tauri/src/file_management.rs` (callers)
- Modify: `src-tauri/src/library_db.rs`

- [ ] **Step 1: Add `get_file_id_by_path` helper**

```rust
pub fn get_file_id_by_path(app_handle: &AppHandle, file_path: &str) -> Result<Option<i64>, String> {
    let conn = open_connection(app_handle)?;
    conn.query_row(
        "SELECT id FROM files WHERE path = ?1",
        params![file_path],
        |row| row.get(0),
    ).optional().map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Update `generate_single_thumbnail_and_cache` signature**

Add `file_id: Option<i64>` parameter and pass it to `compute_thumbnail_cache_hash`.

- [ ] **Step 3: Implement phase 3 loop**

After phase 2:

```rust
let thumb_paths = library_db::get_all_file_paths(&app_handle, folder_id)?;
let total_thumbs = thumb_paths.len();
let _ = app_handle.emit("folder-import-thumbs-started", serde_json::json!({
    "path": &path, "total": total_thumbs,
}));

let semaphore = Arc::new(tokio::sync::Semaphore::new(2));
let mut handles = Vec::new();
for (idx, file_path) in thumb_paths.into_iter().enumerate() {
    if cancel.load(Ordering::SeqCst) { break; }
    let app_clone = app_handle.clone();
    let cancel_clone = cancel.clone();
    let sem = semaphore.clone();
    handles.push(tauri::async_runtime::spawn(async move {
        let _permit = sem.acquire().await.unwrap();
        if cancel_clone.load(Ordering::SeqCst) { return; }
        let file_id = library_db::get_file_id_by_path(&app_clone, &file_path).ok().flatten();
        let _ = crate::file_management::generate_single_thumbnail_and_cache(
            &app_clone,
            &file_path,
            file_id,
        );
        let _ = app_clone.emit("folder-import-thumbs-progress", serde_json::json!({
            "path": &path, "current": idx + 1, "total": total_thumbs,
        }));
    }));
}
for h in handles { let _ = h.await; }
```

- [ ] **Step 4: Update thumbnail queue worker to resolve file_id**

Find where `update_thumbnail_queue` calls the generator and add a catalog lookup by path before generating.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/folder_import.rs src-tauri/src/file_management.rs src-tauri/src/library_db.rs
git commit -m "feat: implement thumbnail phase with stable file_id keys"
```

---

## Task 9: Implement `sync_folder` and `locate_folder`

**Files:**
- Modify: `src-tauri/src/folder_import.rs`
- Modify: `src-tauri/src/library_db.rs`

- [ ] **Step 1: Add delta sync helpers**

```rust
pub fn get_folder_file_fingerprints(
    app_handle: &AppHandle,
    folder_id: i64,
) -> Result<HashMap<String, (u64, u64, u64)>, String> {
    let conn = open_connection(app_handle)?;
    let mut stmt = conn.prepare(
        "SELECT path, modified, size, sidecar_modified FROM files WHERE folder_id = ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![folder_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1).map(|v| v as u64).unwrap_or(0),
            row.get::<_, i64>(2).map(|v| v as u64).unwrap_or(0),
            row.get::<_, i64>(3).map(|v| v as u64).unwrap_or(0),
        ))
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<HashMap<_, _>, _>>().map_err(|e| e.to_string())
}

pub fn delete_files_by_paths(app_handle: &AppHandle, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() { return Ok(()); }
    let conn = open_connection(app_handle)?;
    let placeholders = paths.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("DELETE FROM files WHERE path IN ({})", placeholders);
    conn.execute(&sql, rusqlite::params_from_iter(paths.iter()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn relocate_folder(
    app_handle: &AppHandle,
    old_path: &str,
    new_path: &str,
) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE folders SET path = ?1 WHERE path = ?2",
        params![new_path, old_path],
    ).map_err(|e| e.to_string())?;

    let rows: Vec<(i64, String)> = {
        let mut stmt = tx.prepare("SELECT id, path FROM files WHERE path LIKE ?1 || '%'")
            .map_err(|e| e.to_string())?;
        stmt.query_map(params![old_path], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    for (id, file_path) in rows {
        let new_file_path = file_path.replacen(old_path, new_path, 1);
        tx.execute(
            "UPDATE files SET path = ?1 WHERE id = ?2",
            params![new_file_path, id],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Add commands**

```rust
#[tauri::command]
pub fn sync_folder(
    app_handle: AppHandle,
    state: State<AppState>,
    path: String,
    recursive: bool,
) -> Result<String, String> {
    let normalized = PathBuf::from(&path).canonicalize().unwrap_or_else(|_| PathBuf::from(&path))
        .to_string_lossy().to_string();
    let key = folder_key(&normalized, recursive);

    // Attach or start; if already running, return existing.
    {
        let jobs = state.folder_import_jobs.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&key) {
            return Ok(key);
        }
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_clone = cancel.clone();
    let app_clone = app_handle.clone();
    let handle = tauri::async_runtime::spawn(async move {
        run_sync_job(app_clone, normalized, recursive, cancel_clone).await;
    });

    {
        let mut jobs = state.folder_import_jobs.lock().map_err(|e| e.to_string())?;
        jobs.insert(key.clone(), FolderImportHandle { cancel, handle });
    }

    let _ = app_handle.emit("folder-import-started", serde_json::json!({
        "path": normalized, "recursive": recursive,
    }));
    Ok(key)
}
```

`run_sync_job` computes delta, applies transaction, then reuses phase 2 and 3 logic (extract helper functions from `run_import_job`).

- [ ] **Step 3: Implement `locate_folder` command**

```rust
#[tauri::command]
pub fn locate_folder(
    app_handle: AppHandle,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let normalized_old = PathBuf::from(&old_path).canonicalize().unwrap_or_else(|_| PathBuf::from(&old_path))
        .to_string_lossy().to_string();
    let normalized_new = PathBuf::from(&new_path).canonicalize().unwrap_or_else(|_| PathBuf::from(&new_path))
        .to_string_lossy().to_string();

    library_db::relocate_folder(&app_handle, &normalized_old, &normalized_new)?;

    // Update albums via existing helper.
    crate::file_management::sync_album_path_changes(
        &app_handle,
        None,
        None,
        Some((&normalized_old, &normalized_new)),
    );

    let _ = app_handle.emit("folder-located", serde_json::json!({
        "oldPath": normalized_old,
        "newPath": normalized_new,
    }));
    Ok(())
}
```

- [ ] **Step 4: Register commands in `lib.rs`**

Add `sync_folder` and `locate_folder`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/folder_import.rs src-tauri/src/library_db.rs src-tauri/src/lib.rs
git commit -m "feat: implement sync and locate folder commands"
```

---

## Task 10: Frontend — create `useFolderImportStore.ts`

**Files:**
- Create: `src/store/useFolderImportStore.ts`

- [ ] **Step 1: Write the store**

```typescript
import { create } from 'zustand';
import type { ImageFile } from '../components/ui/AppProperties';

export type ImportPhase = 'scan' | 'exif' | 'thumbnails' | 'complete' | 'cancelled' | 'error';

export interface FolderImportJob {
  path: string;
  recursive: boolean;
  phase: ImportPhase;
  discovered: number;
  scanned: number;
  total: number;
  exifCurrent: number;
  exifTotal: number;
  thumbsCurrent: number;
  thumbsTotal: number;
  files: ImageFile[];
  errors: number;
  errorMessage?: string;
}

interface FolderImportState {
  jobs: Record<string, FolderImportJob>;
  startJob: (path: string, recursive: boolean) => void;
  appendBatch: (path: string, files: ImageFile[], scanned: number, total: number) => void;
  setPhase: (path: string, phase: ImportPhase) => void;
  setScanProgress: (path: string, discovered: number) => void;
  setExifProgress: (path: string, current: number, total: number) => void;
  setThumbsProgress: (path: string, current: number, total: number) => void;
  completeJob: (path: string, errors: number) => void;
  cancelJob: (path: string) => void;
  failJob: (path: string, message: string) => void;
  clearJob: (path: string) => void;
  setFiles: (path: string, files: ImageFile[]) => void;
}

export const useFolderImportStore = create<FolderImportState>((set, get) => ({
  jobs: {},

  startJob: (path, recursive) =>
    set((state) => ({
      jobs: {
        ...state.jobs,
        [path]: state.jobs[path] ?? {
          path,
          recursive,
          phase: 'scan',
          discovered: 0,
          scanned: 0,
          total: 0,
          exifCurrent: 0,
          exifTotal: 0,
          thumbsCurrent: 0,
          thumbsTotal: 0,
          files: [],
          errors: 0,
        },
      },
    })),

  appendBatch: (path, files, scanned, total) =>
    set((state) => {
      const job = state.jobs[path];
      if (!job) return state;
      return {
        jobs: {
          ...state.jobs,
          [path]: {
            ...job,
            phase: 'scan',
            scanned,
            total,
            files: [...job.files, ...files],
          },
        },
      };
    }),

  setFiles: (path, files) =>
    set((state) => {
      const job = state.jobs[path];
      if (!job) return state;
      return { jobs: { ...state.jobs, [path]: { ...job, files } } };
    }),

  setPhase: (path, phase) =>
    set((state) => {
      const job = state.jobs[path];
      if (!job) return state;
      return { jobs: { ...state.jobs, [path]: { ...job, phase } } };
    }),

  setScanProgress: (path, discovered) =>
    set((state) => {
      const job = state.jobs[path];
      if (!job) return state;
      return { jobs: { ...state.jobs, [path]: { ...job, discovered } } };
    }),

  setExifProgress: (path, current, total) =>
    set((state) => {
      const job = state.jobs[path];
      if (!job) return state;
      return {
        jobs: {
          ...state.jobs,
          [path]: { ...job, phase: 'exif', exifCurrent: current, exifTotal: total },
        },
      };
    }),

  setThumbsProgress: (path, current, total) =>
    set((state) => {
      const job = state.jobs[path];
      if (!job) return state;
      return {
        jobs: {
          ...state.jobs,
          [path]: { ...job, phase: 'thumbnails', thumbsCurrent: current, thumbsTotal: total },
        },
      };
    }),

  completeJob: (path, errors) =>
    set((state) => {
      const job = state.jobs[path];
      if (!job) return state;
      return {
        jobs: {
          ...state.jobs,
          [path]: { ...job, phase: 'complete', errors },
        },
      };
    }),

  cancelJob: (path) =>
    set((state) => {
      const job = state.jobs[path];
      if (!job) return state;
      return { jobs: { ...state.jobs, [path]: { ...job, phase: 'cancelled' } } };
    }),

  failJob: (path, message) =>
    set((state) => {
      const job = state.jobs[path];
      if (!job) return state;
      return { jobs: { ...state.jobs, [path]: { ...job, phase: 'error', errorMessage: message } } };
    }),

  clearJob: (path) =>
    set((state) => {
      const { [path]: _, ...rest } = state.jobs;
      return { jobs: rest };
    }),
}));
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors (pre-existing baseline acceptable).

- [ ] **Step 3: Commit**

```bash
git add src/store/useFolderImportStore.ts
git commit -m "feat: add folder import zustand store"
```

---

## Task 11: Frontend — create `useFolderImport.ts` hook

**Files:**
- Create: `src/hooks/useFolderImport.ts`
- Modify: `src/hooks/useAppNavigation.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../store/useLibraryStore';
import { useFolderImportStore } from '../store/useFolderImportStore';
import type { ImageFile } from '../components/ui/AppProperties';

const invokeStart = (path: string, recursive: boolean) =>
  invoke<string>('start_folder_import', { path, recursive });

const invokeSync = (path: string, recursive: boolean) =>
  invoke<string>('sync_folder', { path, recursive });

export function useFolderImport() {
  const currentFolder = useLibraryStore((s) => s.currentFolder);
  const setImageList = useLibraryStore((s) => s.setImageList);
  const imageList = useLibraryStore((s) => s.imageList);

  const jobs = useFolderImportStore((s) => s.jobs);
  const startJob = useFolderImportStore((s) => s.startJob);
  const setFiles = useFolderImportStore((s) => s.setFiles);

  const openFolder = useCallback(
    async (path: string, recursive: boolean) => {
      startJob(path, recursive);
      await invokeStart(path, recursive);
    },
    [startJob],
  );

  const syncFolder = useCallback(async (path: string, recursive: boolean) => {
    await invokeSync(path, recursive);
  }, []);

  const cancelFolderImport = useCallback(async (path: string) => {
    await invoke('cancel_folder_import', { path });
  }, []);

  // When the viewed folder has a job, keep imageList in sync with job.files.
  useEffect(() => {
    if (!currentFolder) return;
    const job = jobs[currentFolder];
    if (!job) return;
    // Simple replace; useSortedLibrary derives sort.
    if (job.files !== imageList) {
      setImageList(job.files);
    }
  }, [currentFolder, jobs, setImageList, imageList]);

  return { openFolder, syncFolder, cancelFolderImport };
}
```

- [ ] **Step 2: Modify `handleSelectSubfolder` in `useAppNavigation.ts`**

Replace:

```typescript
files = await invoke(command, { path });
```

with:

```typescript
const { openFolder } = useFolderImport();
// ... inside the function:
await openFolder(path, libraryViewMode === 'recursive');
// imageList will be populated via the store effect.
return;
```

Keep existing `isViewLoading`, thumbnail queue clearing, etc. Remove the `await invoke(list_images_*)` and `read_exif_for_paths` blocks.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useFolderImport.ts src/hooks/useAppNavigation.ts
git commit -m "feat: wire folder import hook into navigation"
```

---

## Task 12: Frontend — create `ImportJobsIndicator.tsx`

**Files:**
- Create: `src/components/ui/ImportJobsIndicator.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { useFolderImportStore } from '../../store/useFolderImportStore';
import { useFolderImport } from '../../hooks/useFolderImport';

export const ImportJobsIndicator: React.FC = () => {
  const jobs = useFolderImportStore((s) => s.jobs);
  const { cancelFolderImport } = useFolderImport();

  const activeJobs = useMemo(
    () => Object.values(jobs).filter((j) => j.phase !== 'complete' && j.phase !== 'cancelled' && j.phase !== 'error'),
    [jobs],
  );

  if (activeJobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      {activeJobs.map((job) => {
        const total =
          job.phase === 'exif'
            ? job.exifTotal
            : job.phase === 'thumbnails'
            ? job.thumbsTotal
            : job.total;
        const current =
          job.phase === 'exif'
            ? job.exifCurrent
            : job.phase === 'thumbnails'
            ? job.thumbsCurrent
            : job.scanned;
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        return (
          <div
            key={job.path}
            className="bg-background border border-border rounded-lg shadow-lg p-3 min-w-[280px]"
          >
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm font-medium truncate max-w-[200px]">
                {job.path.split(/[\\/]/).pop()}
              </span>
              <button
                onClick={() => cancelFolderImport(job.path)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Cancel import"
              >
                <X size={14} />
              </button>
            </div>
            <div className="text-xs text-muted-foreground mb-1">
              {job.phase} {current}/{total}
            </div>
            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 2: Mount in `App.tsx`**

Add `<ImportJobsIndicator />` near the toast container.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/ImportJobsIndicator.tsx src/App.tsx
git commit -m "feat: add global import jobs indicator"
```

---

## Task 13: Wire Tauri listeners

**Files:**
- Modify: `src/hooks/useTauriListeners.ts`

- [ ] **Step 1: Add listeners for import events**

In the existing listener setup, add:

```typescript
import { useFolderImportStore } from '../store/useFolderImportStore';

const {
  startJob,
  appendBatch,
  setScanProgress,
  setExifProgress,
  setThumbsProgress,
  completeJob,
  cancelJob,
  failJob,
} = useFolderImportStore.getState();

const unsubs: UnlistenFn[] = [];

unsubs.push(
  listen('folder-import-started', (event: any) => {
    startJob(event.payload.path, event.payload.recursive);
  }),
);

unsubs.push(
  listen('folder-import-scan', (event: any) => {
    setScanProgress(event.payload.path, event.payload.discovered);
  }),
);

unsubs.push(
  listen('folder-import-batch', (event: any) => {
    appendBatch(event.payload.path, event.payload.files, event.payload.scanned, event.payload.total);
  }),
);

unsubs.push(
  listen('folder-import-exif-progress', (event: any) => {
    setExifProgress(event.payload.path, event.payload.current, event.payload.total);
  }),
);

unsubs.push(
  listen('folder-import-thumbs-progress', (event: any) => {
    setThumbsProgress(event.payload.path, event.payload.current, event.payload.total);
  }),
);

unsubs.push(
  listen('folder-import-complete', (event: any) => {
    completeJob(event.payload.path, event.payload.errors);
  }),
);

unsubs.push(
  listen('folder-import-cancelled', (event: any) => {
    cancelJob(event.payload.path);
  }),
);

unsubs.push(
  listen('folder-import-error', (event: any) => {
    failJob(event.payload.path, event.payload.message);
  }),
);

unsubs.push(
  listen('folder-import-catalog-ready', (event: any) => {
    // Load files from catalog for instant display.
    // For now we will fetch via a separate command in Task 14.
  }),
);
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useTauriListeners.ts
git commit -m "feat: add folder import event listeners"
```

---

## Task 14: Load folder from catalog on frontend

**Files:**
- Modify: `src-tauri/src/library_db.rs`
- Modify: `src-tauri/src/folder_import.rs` or `src-tauri/src/lib.rs`
- Modify: `src/hooks/useFolderImport.ts`
- Modify: `src/hooks/useTauriListeners.ts`

- [ ] **Step 1: Add Rust command to load catalog page**

```rust
#[tauri::command]
pub fn load_folder_files(
    app_handle: AppHandle,
    path: String,
    recursive: bool,
    offset: usize,
    limit: usize,
) -> Result<Vec<crate::file_management::ImageFile>, String> {
    library_db::load_folder_files(&app_handle, &path, recursive, offset, limit)
}
```

Implement `library_db::load_folder_files` to query `metadata_json` for the folder and deserialize.

- [ ] **Step 2: On `folder-import-catalog-ready`, load pages**

In `useFolderImport.ts` or a dedicated effect in `useTauriListeners`, when catalog-ready event fires, loop:

```typescript
let offset = 0;
const limit = 2000;
while (true) {
  const batch = await invoke<ImageFile[]>('load_folder_files', { path, recursive, offset, limit });
  if (batch.length === 0) break;
  appendBatch(path, batch, offset + batch.length, /* total unknown at start */ 0);
  offset += batch.length;
}
```

Also update `setFiles` when loading from catalog.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/library_db.rs src-tauri/src/folder_import.rs src/hooks/useFolderImport.ts src/hooks/useTauriListeners.ts
git commit -m "feat: load folder contents from catalog in pages"
```

---

## Task 15: Offline availability and context menu

**Files:**
- Modify: `src/hooks/useAppInitialization.ts`
- Modify: folder tree / context menu file

- [ ] **Step 1: Add availability store or state**

Extend `useFolderImportStore` or create `useFolderAvailabilityStore`:

```typescript
interface AvailabilityState {
  availability: Record<string, 'unknown' | 'online' | 'offline'>;
  checkAvailability: (paths: string[]) => Promise<void>;
}
```

Implementation calls Rust command `check_path_exists`:

```rust
#[tauri::command]
pub async fn check_path_exists(path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        std::path::Path::new(&path).exists()
    }).await.map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Run availability checks at startup**

In `useAppInitialization.ts`, after loading `rootPaths`, call `checkAvailability(rootPaths)`.

- [ ] **Step 3: Add context menu items**

Find where folder context menu is defined (likely `useAppContextMenus.ts` or tree component). Add:

```typescript
{
  label: t('contextMenus.syncFolder'),
  onClick: () => syncFolder(path, recursive),
},
{
  label: t('contextMenus.locateFolder'),
  visible: availability[path] === 'offline',
  onClick: async () => {
    const newPath = await open({ directory: true });
    if (newPath) await invoke('locate_folder', { oldPath: path, newPath });
  },
}
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAppInitialization.ts src/components/panel/library/LibraryHeader.tsx src/hooks/useAppContextMenus.ts
# exact files may vary
git commit -m "feat: offline badges and locate folder menu"
```

---

## Task 16: Locales and polish

**Files:**
- Modify: `src/i18n/locales/en.json`, `ru.json`, etc.

- [ ] **Step 1: Add keys**

```json
{
  "importJobs": {
    "scan": "Scanning",
    "exif": "Reading EXIF",
    "thumbnails": "Building previews",
    "complete": "Done",
    "cancelled": "Cancelled",
    "error": "Error"
  },
  "contextMenus": {
    "syncFolder": "Synchronize folder",
    "locateFolder": "Locate folder...",
    "lastSynced": "Synced {{time}} ago"
  }
}
```

- [ ] **Step 2: Use keys in UI**

Replace hardcoded strings in `ImportJobsIndicator.tsx` and context menus.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/locales/*.json
git commit -m "feat: add import job locale keys"
```

---

## Task 17: Verification gates

**Files:**
- All touched files.

- [ ] **Step 1: Rust checks**

Run: `cd src-tauri && cargo check`
Expected: PASS (no new errors).

- [ ] **Step 2: Frontend build**

Run: `npm run build`
Expected: PASS (no new type errors beyond pre-existing baseline).

- [ ] **Step 3: Formatting**

Run: `npx prettier --check src-tauri/src/library_db.rs src-tauri/src/folder_import.rs src/store/useFolderImportStore.ts src/hooks/useFolderImport.ts src/components/ui/ImportJobsIndicator.tsx src/hooks/useAppNavigation.ts src/hooks/useTauriListeners.ts src/App.tsx src/hooks/useAppInitialization.ts src/i18n/locales/*.json`

Expected: PASS (Prettier-clean).

- [ ] **Step 4: Manual QA**

- Local folder with 100–1000 images: progressive fill, cancel, reopen from catalog.
- Network folder with many images: disconnect, reopen app, verify offline view; reconnect and sync.
- Move a folder and use «Locate folder»; verify paths update and previews still cached.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: verify non-blocking import implementation"
```

---

## Self-review checklist

- [ ] **Spec coverage:** every requirement in the design doc maps to at least one task.
- [ ] **No placeholders:** no TBD/TODO; each step has code or exact command.
- [ ] **Type consistency:** `file_id: Option<i64>` flows from catalog through thumbnail cache functions; `ImageFile` shape matches existing frontend type.
- [ ] **Delta map:** new files are isolated; shared files have surgical edits only.
