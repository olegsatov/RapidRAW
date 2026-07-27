use rusqlite::{Connection, OptionalExtension, params};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

use crate::file_management::{ImageFile, compute_thumbnail_cache_hash};

const CURRENT_SCHEMA_VERSION: i32 = 5;

fn db_path<R: Runtime>(app_handle: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("library.db"))
}

pub(crate) fn open_connection<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Connection, String> {
    let path = db_path(app_handle)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 30000;",
    )
    .map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

#[allow(dead_code)] // consumed by catalog backup tasks 4-7
const BACKUP_PENDING_COUNT_KEY: &str = "backup_pending_count";
#[allow(dead_code)] // consumed by catalog backup tasks 4-7
const BACKUP_LAST_AT_KEY: &str = "backup_last_at";
#[allow(dead_code)] // consumed by catalog backup tasks 4-7
const BACKUP_LAST_BANNER_AT_KEY: &str = "backup_last_banner_at";

#[allow(dead_code)] // consumed by catalog backup tasks 4-7
fn get_meta_i64(conn: &Connection, key: &str) -> Result<Option<i64>, String> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match value {
        Some(v) => v.parse::<i64>().map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

fn set_meta_i64(conn: &Connection, key: &str, value: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Increments the pending-backup counter by `delta`. Non-positive values are ignored.
#[allow(dead_code)] // consumed by catalog backup tasks 4-7
pub(crate) fn increment_backup_counter_in_conn(
    conn: &Connection,
    delta: i64,
) -> Result<(), String> {
    if delta <= 0 {
        return Ok(());
    }
    let current = get_meta_i64(conn, BACKUP_PENDING_COUNT_KEY)?.unwrap_or(0);
    let next = current.saturating_add(delta);
    set_meta_i64(conn, BACKUP_PENDING_COUNT_KEY, next)
}

#[allow(dead_code)] // consumed by catalog backup tasks 4-7
pub fn get_catalog_backup_state_in_conn(
    conn: &Connection,
) -> Result<(i64, Option<i64>, Option<i64>), String> {
    Ok((
        get_meta_i64(conn, BACKUP_PENDING_COUNT_KEY)?.unwrap_or(0),
        get_meta_i64(conn, BACKUP_LAST_AT_KEY)?,
        get_meta_i64(conn, BACKUP_LAST_BANNER_AT_KEY)?,
    ))
}

#[allow(dead_code)] // consumed by catalog backup tasks 4-7
pub fn reset_backup_counter_in_conn(conn: &Connection) -> Result<(), String> {
    let now = now_secs();
    set_meta_i64(conn, BACKUP_PENDING_COUNT_KEY, 0)?;
    set_meta_i64(conn, BACKUP_LAST_AT_KEY, now)?;
    Ok(())
}

#[allow(dead_code)] // used by the backup-banner UI task
pub fn touch_backup_banner_in_conn(conn: &Connection) -> Result<(), String> {
    set_meta_i64(conn, BACKUP_LAST_BANNER_AT_KEY, now_secs())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let sql = format!(
        "SELECT 1 FROM pragma_table_info('{}') WHERE name = ?1",
        table
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let exists: Option<i32> = stmt
        .query_row([column], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(exists.is_some())
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let user_version: i32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if user_version < 1 {
        conn.execute_batch(SCHEMA_V1).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 1)
            .map_err(|e| e.to_string())?;
    }
    if user_version < 2 {
        conn.execute_batch(SCHEMA_V2).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 2)
            .map_err(|e| e.to_string())?;
    }
    if user_version < 3 {
        // A crash between adding the V3 columns and bumping user_version can
        // leave the catalog in a partially migrated state. Guard each ALTER so
        // migration is idempotent and recovers cleanly.
        if !column_exists(conn, "file_adjustment_deltas", "step_index")? {
            conn.execute(
                "ALTER TABLE file_adjustment_deltas ADD COLUMN step_index INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        if !column_exists(conn, "file_adjustment_deltas", "idx")? {
            conn.execute(
                "ALTER TABLE file_adjustment_deltas ADD COLUMN idx INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        if !column_exists(conn, "file_adjustment_snapshots", "idx")? {
            conn.execute(
                "ALTER TABLE file_adjustment_snapshots ADD COLUMN idx INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        if !column_exists(conn, "files", "history_index")? {
            conn.execute("ALTER TABLE files ADD COLUMN history_index INTEGER", [])
                .map_err(|e| e.to_string())?;
        }
        conn.execute_batch(SCHEMA_V3).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 3)
            .map_err(|e| e.to_string())?;
    }
    if user_version < 4 {
        // A crash between adding the column and bumping user_version can leave
        // the catalog partially migrated. Guard the ALTER so the migration is
        // idempotent, but always run the hidden-row purge and hash backfill.
        if !column_exists(conn, "files", "thumbnail_hash")? {
            conn.execute_batch(SCHEMA_V4).map_err(|e| e.to_string())?;
        } else {
            conn.execute("DELETE FROM files WHERE path LIKE '%/.%'", [])
                .map_err(|e| e.to_string())?;
        }
        backfill_thumbnail_hashes(conn)?;
        conn.pragma_update(None, "user_version", 4)
            .map_err(|e| e.to_string())?;
    }
    if user_version < 5 {
        conn.execute_batch(SCHEMA_V5).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 5)
            .map_err(|e| e.to_string())?;
    }
    let final_version: i32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if final_version != CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "migration ended at user_version {} but expected {}",
            final_version, CURRENT_SCHEMA_VERSION
        ));
    }
    Ok(())
}

#[cfg(test)]
const SCHEMA_V1_PRE_MIGRATION: &str = r#"
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

const SCHEMA_V2: &str = r#"
ALTER TABLE files ADD COLUMN adjustments_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE files ADD COLUMN metadata_modified INTEGER;
ALTER TABLE files ADD COLUMN exif_json TEXT;

CREATE TABLE IF NOT EXISTS file_adjustment_deltas (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    adjustment_key TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT NOT NULL,
    source TEXT NOT NULL,
    description TEXT,
    is_undone INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS file_adjustment_snapshots (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    adjustments_json TEXT NOT NULL,
    source TEXT NOT NULL,
    description TEXT
);

CREATE INDEX IF NOT EXISTS idx_deltas_file_created ON file_adjustment_deltas(file_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_file_created ON file_adjustment_snapshots(file_id, created_at);
"#;

const SCHEMA_V3: &str = r#"
CREATE INDEX IF NOT EXISTS idx_deltas_file_step ON file_adjustment_deltas(file_id, step_index);
CREATE INDEX IF NOT EXISTS idx_deltas_file_idx ON file_adjustment_deltas(file_id, idx);
CREATE INDEX IF NOT EXISTS idx_snapshots_file_idx ON file_adjustment_snapshots(file_id, idx);
"#;

const SCHEMA_V4: &str = r#"
ALTER TABLE files ADD COLUMN thumbnail_hash TEXT;
DELETE FROM files WHERE path LIKE '%/.%';
"#;

const SCHEMA_V5: &str = r#"
CREATE TABLE IF NOT EXISTS dodge_burn_masks (
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    sub_mask_id TEXT NOT NULL,
    mask_data_url TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (file_id, sub_mask_id)
);
CREATE INDEX IF NOT EXISTS idx_dodge_burn_masks_file ON dodge_burn_masks(file_id);
"#;

pub fn init_catalog(app_handle: &AppHandle) -> Result<(), String> {
    match try_init_catalog(app_handle) {
        Ok(()) => Ok(()),
        Err(e) => {
            log::warn!(
                "Library catalog open/migrate failed ({}); renaming broken database and creating a fresh one.",
                e
            );
            let path = db_path(app_handle)?;
            if path.exists() {
                let corrupt_path = path.with_extension("db.corrupt");
                // Overwrite any previous corrupt backup so the catalog recovery
                // leaves exactly one `library.db.corrupt` behind.
                if corrupt_path.exists() {
                    let _ = std::fs::remove_file(&corrupt_path);
                }
                std::fs::rename(&path, &corrupt_path)
                    .map_err(|err| format!("failed to rename corrupt catalog: {}", err))?;
                log::info!(
                    "Renamed corrupt library catalog to {}",
                    corrupt_path.display()
                );
                // Move aside WAL/shm files so the fresh database starts clean.
                for ext in ["-wal", "-shm"] {
                    let sidecar = path.with_extension(format!("db{}", ext));
                    if sidecar.exists() {
                        let _ = std::fs::remove_file(&sidecar);
                    }
                }
            }
            try_init_catalog(app_handle)
                .map_err(|e| format!("failed to create fresh catalog after recovery: {}", e))
        }
    }
}

fn try_init_catalog(app_handle: &AppHandle) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    migrate(&conn)
}

pub fn upsert_folder<R: Runtime>(
    app_handle: &AppHandle<R>,
    path: &str,
    recursive: bool,
) -> Result<i64, String> {
    let conn = open_connection(app_handle)?;
    upsert_folder_in_conn(&conn, path, recursive)
}

pub fn upsert_folder_in_conn(
    conn: &Connection,
    path: &str,
    recursive: bool,
) -> Result<i64, String> {
    // RETURNING id: on the conflict-update path last_insert_rowid() is not
    // set to the conflicting row (it returns 0 on a fresh connection).
    conn.query_row(
        "INSERT INTO folders(path, recursive) VALUES (?1, ?2)
         ON CONFLICT(path, recursive) DO UPDATE SET path=excluded.path
         RETURNING id",
        params![path, recursive as i32],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn get_folder_id(
    app_handle: &AppHandle,
    path: &str,
    recursive: bool,
) -> Result<Option<i64>, String> {
    let conn = open_connection(app_handle)?;
    conn.query_row(
        "SELECT id FROM folders WHERE path = ?1 AND recursive = ?2",
        params![path, recursive as i32],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Deletes catalog folder rows under `root_path` (excluding the root itself)
/// that have zero files — orphan folders left behind when a parent-folder
/// import reassigns every file to the parent's `folder_id` via
/// `ON CONFLICT(path) DO UPDATE SET folder_id=excluded.folder_id`.
/// Returns the number of deleted rows.
pub fn delete_orphan_folders_under(
    app_handle: &AppHandle,
    root_path: &str,
    root_folder_id: i64,
) -> Result<usize, String> {
    let conn = open_connection(app_handle)?;
    let normalized = root_path.trim_end_matches(|c| c == '/' || c == '\\');
    let pattern = format!("{}/%", normalized);
    let deleted = conn
        .execute(
            "DELETE FROM folders WHERE id IN (\
             SELECT f.id FROM folders f \
             LEFT JOIN files fl ON fl.folder_id = f.id \
             WHERE f.path LIKE ?1 AND f.id != ?2 \
             GROUP BY f.id \
             HAVING COUNT(fl.id) = 0)",
            params![pattern, root_folder_id],
        )
        .map_err(|e| e.to_string())?;
    if deleted > 0 {
        log::info!(
            "[catalog] deleted {} orphan folder(s) under {}",
            deleted,
            normalized
        );
    }
    Ok(deleted)
}

#[derive(Debug, Clone)]
pub struct FileRowInput {
    pub path: String,
    pub name: String,
    pub modified: Option<u64>,
    pub size: Option<u64>,
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

#[derive(Debug, Clone)]
pub struct AdjustmentDelta {
    pub step_index: i64,
    pub idx: i64,
    pub adjustment_key: String,
    pub old_value: Option<String>,
    pub new_value: String,
    pub description: Option<String>,
    pub created_at: i64,
    pub source: String,
}

#[derive(Debug, Clone)]
pub struct AdjustmentSnapshot {
    pub idx: i64,
    pub adjustments_json: String,
    pub description: Option<String>,
    pub created_at: i64,
    pub source: String,
}

#[derive(Debug, Clone)]
pub struct EditHistory {
    pub snapshot: AdjustmentSnapshot,
    pub deltas: Vec<AdjustmentDelta>,
    pub history_index: i64,
}

pub fn upsert_files<R: Runtime>(
    app_handle: &AppHandle<R>,
    folder_id: i64,
    files: &[FileRowInput],
) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    upsert_files_in_conn(&mut conn, folder_id, files)
}

/// On conflict (file seen before), `exif_scanned` is reset to 0 only when
/// `modified` or `size` changed, so the EXIF phase does not rescan unchanged
/// files. New rows always start with `exif_scanned = 0`.
fn upsert_files_in_conn(
    conn: &mut Connection,
    folder_id: i64,
    files: &[FileRowInput],
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for f in files {
        let file_id: i64 = tx
            .query_row(
                "INSERT INTO files(
                    folder_id, path, name, modified, size,
                    extension, is_raw, is_edited, is_virtual_copy, is_cloud_placeholder,
                    rating, flag, color, exif_scanned, metadata_json, metadata_modified
                ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
                 ON CONFLICT(path) DO UPDATE SET
                    folder_id=excluded.folder_id,
                    name=excluded.name,
                    modified=excluded.modified,
                    size=excluded.size,
                    extension=excluded.extension,
                    is_raw=excluded.is_raw,
                    is_edited=excluded.is_edited,
                    is_virtual_copy=excluded.is_virtual_copy,
                    is_cloud_placeholder=excluded.is_cloud_placeholder,
                    rating=excluded.rating,
                    flag=excluded.flag,
                    color=excluded.color,
                    exif_scanned=CASE
                        WHEN files.modified IS NOT excluded.modified
                          OR files.size IS NOT excluded.size
                        THEN 0 ELSE files.exif_scanned END,
                    metadata_json=excluded.metadata_json,
                    metadata_modified=0
                 RETURNING id",
                params![
                    folder_id,
                    &f.path,
                    &f.name,
                    f.modified.map(|v| v as i64),
                    f.size.map(|v| v as i64),
                    &f.extension,
                    f.is_raw as i32,
                    f.is_edited as i32,
                    f.is_virtual_copy as i32,
                    f.is_cloud_placeholder as i32,
                    f.rating as i32,
                    f.flag as i32,
                    &f.color,
                    0i32,
                    &f.metadata_json,
                    0i64
                ],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        tx.execute("DELETE FROM tags WHERE file_id = ?1", params![file_id])
            .map_err(|e| e.to_string())?;
        for (tag, source) in &f.tags {
            tx.execute(
                "INSERT OR IGNORE INTO tags(file_id, tag, source) VALUES (?1, ?2, ?3)",
                params![file_id, tag, source],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    increment_backup_counter_in_conn(&*tx, files.len() as i64)?;
    tx.commit().map_err(|e| e.to_string())
}

/// Structured EXIF values matching the dedicated `files` columns, derived
/// from the formatted EXIF map produced by `exif_processing::read_exif_data`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StructuredExif {
    pub date_taken: Option<String>,
    pub iso: Option<u32>,
    pub aperture: Option<f32>,
    pub shutter: Option<f32>,
    pub focal_length: Option<f32>,
    pub focal_length_35: Option<f32>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub lens_make: Option<String>,
    pub lens_model: Option<String>,
    pub orientation: Option<u32>,
}

fn clean_exif_str(s: &str) -> &str {
    s.trim().trim_matches('"').trim()
}

fn parse_exif_u32(value: Option<&String>) -> Option<u32> {
    // Orientation values may be descriptive ("1 (Horizontal)"); take the
    // leading numeric token.
    clean_exif_str(value?)
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}

fn parse_exif_f32(value: Option<&String>) -> Option<f32> {
    clean_exif_str(value?)
        .trim_start_matches("f/")
        .trim_end_matches(" mm")
        .trim()
        .parse()
        .ok()
        .filter(|v: &f32| v.is_finite())
}

fn parse_exif_shutter(value: Option<&String>) -> Option<f32> {
    let cleaned = clean_exif_str(value?).trim_end_matches(" s").trim();
    let parsed = if let Some((num, den)) = cleaned.split_once('/') {
        let num: f32 = num.trim().parse().ok()?;
        let den: f32 = den.trim().parse().ok()?;
        (den != 0.0).then_some(num / den)
    } else {
        cleaned.parse().ok()
    };
    parsed.filter(|v: &f32| v.is_finite())
}

/// Parses a raw APEX value. The EXIF map stores `ShutterSpeedValue` and
/// `ApertureValue` as unconverted APEX numbers (verified in both extraction
/// paths): `"7"` / `"f/5.66"` from `extract_metadata` (RAW) and `"7 EV"` from
/// kamadak-exif's `display_value().with_unit()` (non-RAW). Callers convert:
/// shutter seconds = 2^-x, aperture f-number = 2^(x/2).
fn parse_exif_apex(value: Option<&String>) -> Option<f32> {
    clean_exif_str(value?)
        .trim_start_matches("f/")
        .trim_end_matches(" EV")
        .trim()
        .parse()
        .ok()
        .filter(|v: &f32| v.is_finite())
}

/// Normalizes `date_taken` to `YYYY-MM-DD HH:MM:SS`. The RAW extraction path
/// already emits that format, but the non-RAW path stores the raw EXIF date
/// `2024:05:01 12:30:00`; both must match or the `date_taken` index sorts
/// mixed folders wrong.
fn normalize_date_taken(value: Option<&String>) -> Option<String> {
    let cleaned = clean_exif_str(value?);
    if cleaned.is_empty() {
        return None;
    }
    Some(match cleaned.split_once(' ') {
        // Only the date part carries colons; the time part keeps its own.
        Some((date, time)) => format!("{} {}", date.replace(':', "-"), time),
        None => cleaned.replace(':', "-"),
    })
}

impl StructuredExif {
    pub fn from_exif_map(map: &HashMap<String, String>) -> Self {
        let get = |keys: &[&str]| keys.iter().find_map(|k| map.get(*k));
        let get_string = |keys: &[&str]| {
            get(keys).and_then(|v| {
                let cleaned = clean_exif_str(v);
                (!cleaned.is_empty()).then(|| cleaned.to_string())
            })
        };
        StructuredExif {
            date_taken: normalize_date_taken(get(&["DateTimeOriginal", "CreateDate"])),
            iso: parse_exif_u32(get(&[
                "ISOSpeed",
                "PhotographicSensitivity",
                "ISOSpeedRatings",
            ])),
            // Prefer the true f-number/seconds keys; the `ApertureValue`/
            // `ShutterSpeedValue` fallbacks are raw APEX (see parse_exif_apex)
            // and must be converted, not stored as-is.
            aperture: parse_exif_f32(get(&["FNumber"])).or_else(|| {
                parse_exif_apex(get(&["ApertureValue"])).map(|apex| 2f32.powf(apex / 2.0))
            }),
            shutter: parse_exif_shutter(get(&["ExposureTime"])).or_else(|| {
                parse_exif_apex(get(&["ShutterSpeedValue"])).map(|apex| 2f32.powf(-apex))
            }),
            focal_length: parse_exif_f32(get(&["FocalLength"])),
            focal_length_35: parse_exif_f32(get(&["FocalLengthIn35mmFilm"])),
            make: get_string(&["Make"]),
            model: get_string(&["Model"]),
            lens_make: get_string(&["LensMake"]),
            lens_model: get_string(&["LensModel"]),
            orientation: parse_exif_u32(get(&["Orientation"])),
        }
    }
}

/// Returns `(id, path)` for real-file rows in `folder_id` whose EXIF has not
/// been scanned yet. Virtual-copy rows (`path?vc=id`) are excluded: they
/// share the source file's EXIF and are filled by `mark_exif_scanned`.
pub fn get_files_needing_exif(
    app_handle: &AppHandle,
    folder_id: i64,
) -> Result<Vec<(i64, String)>, String> {
    let conn = open_connection(app_handle)?;
    get_files_needing_exif_in_conn(&conn, folder_id)
}

fn get_files_needing_exif_in_conn(
    conn: &Connection,
    folder_id: i64,
) -> Result<Vec<(i64, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, path FROM files
             WHERE folder_id = ?1 AND exif_scanned = 0 AND path NOT LIKE '%?vc=%'
             ORDER BY id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![folder_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Resolves the catalog id for one (possibly virtual) path. `None` means the
/// file is not cataloged; callers fall back to path-keyed behavior in that
/// case — a missing row is never an error.
pub fn get_file_id_by_path<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_path: &str,
) -> Result<Option<i64>, String> {
    let conn = open_connection(app_handle)?;
    get_file_id_by_path_in_conn(&conn, file_path)
}

fn get_file_id_by_path_in_conn(conn: &Connection, file_path: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM files WHERE path = ?1",
        params![file_path],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[allow(dead_code)]
fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Adjustment/metadata state stored for one catalog row.
#[derive(Debug, Clone, PartialEq)]
pub struct FileMetadata {
    pub adjustments_json: String,
    pub metadata_modified: Option<i64>,
    pub exif_json: Option<String>,
}

/// Returns the adjustment/metadata columns for one catalog row, or `None` if
/// the file is not cataloged. Used by the metadata store to decide whether a
/// catalog-backed settings read is available.
pub fn get_file_metadata<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
) -> Result<Option<FileMetadata>, String> {
    let conn = open_connection(app_handle)?;
    get_file_metadata_in_conn(&conn, file_id)
}

fn get_file_metadata_in_conn(
    conn: &Connection,
    file_id: i64,
) -> Result<Option<FileMetadata>, String> {
    conn.query_row(
        "SELECT adjustments_json, metadata_modified, exif_json FROM files WHERE id = ?1",
        params![file_id],
        |row| {
            Ok(FileMetadata {
                adjustments_json: row.get::<_, String>(0)?,
                metadata_modified: row.get::<_, Option<i64>>(1)?,
                exif_json: row.get::<_, Option<String>>(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn update_file_metadata_in_conn(
    conn: &Connection,
    file_id: i64,
    adjustments_json: &str,
    exif_json: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET adjustments_json = ?2, metadata_modified = ?3, exif_json = ?4 WHERE id = ?1",
        params![file_id, adjustments_json, now_secs(), exif_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Persists a dodge/burn mask bitmap separately from the adjustments JSON.
/// Keeping the large data URL out of `files.adjustments_json` keeps metadata
/// saves fast and avoids blocking the UI on every slider change.
pub fn save_dodge_burn_mask<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
    sub_mask_id: &str,
    mask_data_url: &str,
) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    conn.execute(
        "INSERT INTO dodge_burn_masks(file_id, sub_mask_id, mask_data_url, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(file_id, sub_mask_id) DO UPDATE SET
            mask_data_url = excluded.mask_data_url,
            updated_at = excluded.updated_at",
        params![file_id, sub_mask_id, mask_data_url, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Loads all persisted dodge/burn masks for a file, keyed by sub-mask id.
pub fn load_dodge_burn_masks<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
) -> Result<HashMap<String, String>, String> {
    let conn = open_connection(app_handle)?;
    let mut stmt = conn
        .prepare("SELECT sub_mask_id, mask_data_url FROM dodge_burn_masks WHERE file_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![file_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut result = HashMap::new();
    for row in rows {
        let (sub_mask_id, mask_data_url) = row.map_err(|e| e.to_string())?;
        result.insert(sub_mask_id, mask_data_url);
    }
    Ok(result)
}

/// Deletes a persisted dodge/burn mask. Called when the sub-mask is removed.
pub fn delete_dodge_burn_mask<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
    sub_mask_id: &str,
) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    conn.execute(
        "DELETE FROM dodge_burn_masks WHERE file_id = ?1 AND sub_mask_id = ?2",
        params![file_id, sub_mask_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Persists a full delta-based edit history for one file, replacing any
/// previously stored history. The base snapshot is written to
/// `file_adjustment_snapshots` and every delta to `file_adjustment_deltas`.
/// The `files` row is updated with the current adjustments blob, the active
/// history index, and a fresh `metadata_modified` timestamp.
pub fn save_edit_history<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
    snapshot: &AdjustmentSnapshot,
    deltas: &[AdjustmentDelta],
    history_index: i64,
    current_adjustments_json: &str,
) -> Result<(), String> {
    log::info!(
        "[history-persistence] library_db::save_edit_history opening connection for file_id={}",
        file_id
    );
    let mut conn = open_connection(app_handle)?;
    log::info!("[history-persistence] connection opened, starting transaction");
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    log::info!("[history-persistence] transaction started");
    save_edit_history_in_conn(
        &tx,
        file_id,
        snapshot,
        deltas,
        history_index,
        current_adjustments_json,
    )?;
    log::info!(
        "[history-persistence] committing transaction for file_id={}",
        file_id
    );
    tx.commit().map_err(|e| e.to_string())?;
    log::info!(
        "[history-persistence] transaction committed for file_id={}",
        file_id
    );
    Ok(())
}

fn save_edit_history_in_conn(
    conn: &Connection,
    file_id: i64,
    snapshot: &AdjustmentSnapshot,
    deltas: &[AdjustmentDelta],
    history_index: i64,
    current_adjustments_json: &str,
) -> Result<(), String> {
    // `reconstruct_history` expects deltas ordered by (step_index, idx).
    // Sort here so callers don't have to guarantee ordering themselves.
    let mut sorted_deltas = deltas.to_vec();
    sorted_deltas.sort_by_key(|d| (d.step_index, d.idx));

    conn.execute(
        "DELETE FROM file_adjustment_deltas WHERE file_id = ?1",
        params![file_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM file_adjustment_snapshots WHERE file_id = ?1",
        params![file_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO file_adjustment_snapshots
         (file_id, created_at, adjustments_json, source, description, idx)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            file_id,
            snapshot.created_at,
            &snapshot.adjustments_json,
            &snapshot.source,
            snapshot.description.as_ref(),
            snapshot.idx,
        ],
    )
    .map_err(|e| e.to_string())?;

    for delta in &sorted_deltas {
        conn.execute(
            "INSERT INTO file_adjustment_deltas
             (file_id, created_at, adjustment_key, old_value, new_value, source, description, is_undone, step_index, idx)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                file_id,
                delta.created_at,
                &delta.adjustment_key,
                delta.old_value.as_ref(),
                &delta.new_value,
                &delta.source,
                delta.description.as_ref(),
                0i32,
                delta.step_index,
                delta.idx,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let max_step_index: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(step_index), 0) FROM file_adjustment_deltas WHERE file_id = ?1",
            params![file_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if max_step_index >= 100 {
        let cutoff = max_step_index - 99;
        conn.execute(
            "DELETE FROM file_adjustment_deltas WHERE file_id = ?1 AND step_index < ?2",
            params![file_id, cutoff],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "UPDATE files SET adjustments_json = ?1, history_index = ?2, metadata_modified = ?3 WHERE id = ?4",
        params![current_adjustments_json, history_index, now_secs(), file_id],
    )
    .map_err(|e| e.to_string())?;

    increment_backup_counter_in_conn(conn, 1)?;
    Ok(())
}

/// Loads the persisted edit history for one file. Returns `None` when no base
/// snapshot exists.
pub fn load_edit_history<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
) -> Result<Option<EditHistory>, String> {
    let conn = open_connection(app_handle)?;
    load_edit_history_in_conn(&conn, file_id)
}

fn load_edit_history_in_conn(
    conn: &Connection,
    file_id: i64,
) -> Result<Option<EditHistory>, String> {
    let snapshot = conn
        .query_row(
            "SELECT idx, adjustments_json, description, created_at, source
             FROM file_adjustment_snapshots
             WHERE file_id = ?1
             ORDER BY idx ASC
             LIMIT 1",
            params![file_id],
            |row| {
                Ok(AdjustmentSnapshot {
                    idx: row.get(0)?,
                    adjustments_json: row.get(1)?,
                    description: row.get(2)?,
                    created_at: row.get(3)?,
                    source: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let snapshot = match snapshot {
        Some(s) => s,
        None => return Ok(None),
    };

    let mut stmt = conn
        .prepare(
            "SELECT step_index, idx, adjustment_key, old_value, new_value, description, created_at, source
             FROM file_adjustment_deltas
             WHERE file_id = ?1
             ORDER BY step_index ASC, idx ASC",
        )
        .map_err(|e| e.to_string())?;
    let deltas = stmt
        .query_map(params![file_id], |row| {
            Ok(AdjustmentDelta {
                step_index: row.get(0)?,
                idx: row.get(1)?,
                adjustment_key: row.get(2)?,
                old_value: row.get(3)?,
                new_value: row.get(4)?,
                description: row.get(5)?,
                created_at: row.get(6)?,
                source: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let history_index: i64 = conn
        .query_row(
            "SELECT COALESCE(history_index, 0) FROM files WHERE id = ?1",
            params![file_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(0);

    Ok(Some(EditHistory {
        snapshot,
        deltas,
        history_index,
    }))
}

/// Reconstructs the full adjustment state at every step from the base snapshot
/// and the ordered deltas. Returns `(states, active_index)` where `states[0]`
/// is the snapshot state, `states[1]` is after applying step 0, and so on.
/// `active_index` is `history_index` clamped to the available state range.
pub fn reconstruct_history(
    snapshot: &AdjustmentSnapshot,
    deltas: &[AdjustmentDelta],
    history_index: i64,
) -> Result<(Vec<String>, i64), String> {
    let mut state: serde_json::Value =
        serde_json::from_str(&snapshot.adjustments_json).map_err(|e| e.to_string())?;
    let mut states = vec![serde_json::to_string(&state).map_err(|e| e.to_string())?];

    let mut groups: Vec<Vec<&AdjustmentDelta>> = Vec::new();
    for delta in deltas {
        if let Some(last_group) = groups.last_mut() {
            if last_group[0].step_index == delta.step_index {
                last_group.push(delta);
                continue;
            }
        }
        groups.push(vec![delta]);
    }

    for group in groups {
        let Some(obj) = state.as_object_mut() else {
            return Err("snapshot adjustments are not a JSON object".to_string());
        };
        for delta in group {
            let new_value: serde_json::Value =
                serde_json::from_str(&delta.new_value).map_err(|e| e.to_string())?;
            obj.insert(delta.adjustment_key.clone(), new_value);
        }
        states.push(serde_json::to_string(&state).map_err(|e| e.to_string())?);
    }

    let max_index = (states.len() as i64).saturating_sub(1);
    let active_index = history_index.clamp(0, max_index);
    Ok((states, active_index))
}

/// Returns whether a catalog row has already completed its EXIF scan. Used by
/// lazy EXIF caching to avoid racing the folder import's EXIF phase.
pub fn is_file_exif_scanned<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
) -> Result<bool, String> {
    let conn = open_connection(app_handle)?;
    is_file_exif_scanned_in_conn(&conn, file_id)
}

fn is_file_exif_scanned_in_conn(conn: &Connection, file_id: i64) -> Result<bool, String> {
    conn.query_row(
        "SELECT exif_scanned FROM files WHERE id = ?1",
        params![file_id],
        |row| row.get::<_, i32>(0),
    )
    .map(|v| v == 1)
    .map_err(|e| e.to_string())
}

/// Updates the rating, flag, and tags for a single catalog row in one
/// transaction, stamping `metadata_modified`. Tags are parsed from prefixed
/// strings: `user:`, `color:`, or default `ai`.
///
/// `color:` tags are stored with source `color` in the `tags` table, but the
/// canonical color label used for filtering remains `files.color`, which
/// callers set separately via `update_file_metadata_in_conn` or `upsert_files`.
pub fn update_file_rating_flag_tags<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
    rating: u8,
    flag: i8,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    update_file_rating_flag_tags_in_conn(&tx, file_id, rating, flag, tags.as_deref())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Executes the rating/flag/tags update against an existing connection or
/// transaction. Callers that need atomicity must wrap this in a transaction
/// themselves; the public `update_file_rating_flag_tags` does so.
pub(crate) fn update_file_rating_flag_tags_in_conn(
    conn: &Connection,
    file_id: i64,
    rating: u8,
    flag: i8,
    tags: Option<&[String]>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET rating = ?1, flag = ?2, metadata_modified = ?3 WHERE id = ?4",
        params![rating as i32, flag as i32, now_secs(), file_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM tags WHERE file_id = ?1", params![file_id])
        .map_err(|e| e.to_string())?;
    if let Some(tags) = tags {
        for tag in tags {
            let (source, tag_name) = if let Some(stripped) = tag.strip_prefix("user:") {
                ("user", stripped)
            } else if let Some(stripped) = tag.strip_prefix("color:") {
                ("color", stripped)
            } else {
                ("ai", tag.as_str())
            };
            conn.execute(
                "INSERT OR IGNORE INTO tags(file_id, tag, source) VALUES (?1, ?2, ?3)",
                params![file_id, tag_name, source],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    increment_backup_counter_in_conn(conn, 1)?;
    Ok(())
}

/// Reads the rating, flag, and user/ai/color tags stored for one catalog row.
/// Returns `None` when the file id is not known. Used by the metadata store to
/// reconstruct `ImageMetadata` from catalog columns.
pub fn get_file_rating_flag_tags<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
) -> Result<Option<(u8, i8, Vec<String>)>, String> {
    let conn = open_connection(app_handle)?;
    let row: Option<(i64, i64)> = conn
        .query_row(
            "SELECT rating, flag FROM files WHERE id = ?1",
            params![file_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (rating, flag) = match row {
        Some((r, f)) => (r as u8, f as i8),
        None => return Ok(None),
    };

    let mut stmt = conn
        .prepare("SELECT tag, source FROM tags WHERE file_id = ?1 ORDER BY tag")
        .map_err(|e| e.to_string())?;
    let tags: Vec<String> = stmt
        .query_map(params![file_id], |row| {
            let tag: String = row.get(0)?;
            let source: String = row.get(1)?;
            let formatted = match source.as_str() {
                "user" => format!("user:{}", tag),
                "color" => format!("color:{}", tag),
                _ => tag,
            };
            Ok(formatted)
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(Some((rating, flag, tags)))
}

/// Updates only the color label for one catalog row, stamping
/// `metadata_modified`. Used by the metadata store for `set_color`.
pub fn update_file_color<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
    color: Option<&str>,
) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE files SET color = ?1, metadata_modified = ?2 WHERE id = ?3",
        params![color, now_secs(), file_id],
    )
    .map_err(|e| e.to_string())?;
    increment_backup_counter_in_conn(&tx, 1)?;
    tx.commit().map_err(|e| e.to_string())
}

/// Returns `(id, path)` for every catalog row in `folder_id`, real files and
/// virtual copies alike. Thumbnails are per row, not per source file: each
/// virtual copy has its own sidecar (adjustments) and gets its own
/// file_id-keyed cache entry — matching the frontend, which requests
/// thumbnails per (virtual) path.
#[allow(dead_code)]
fn get_all_file_paths_in_conn(
    conn: &Connection,
    folder_id: i64,
) -> Result<Vec<(i64, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT id, path FROM files WHERE folder_id = ?1 ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![folder_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Returns `(id, path, modified)` for every catalog row in `folder_id`.
/// Used by the thumbnail phase when it needs the catalog's modified timestamp
/// to compute the cache hash without re-statting each source file.
pub fn get_all_file_paths_with_modified(
    app_handle: &AppHandle,
    folder_id: i64,
) -> Result<Vec<(i64, String, u64)>, String> {
    let conn = open_connection(app_handle)?;
    let mut stmt = conn
        .prepare("SELECT id, path, modified FROM files WHERE folder_id = ?1 ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![folder_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?.unwrap_or(0) as u64,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Stores the thumbnail cache hash for one catalog row.
pub fn update_file_thumbnail_hash(
    app_handle: &AppHandle,
    file_id: i64,
    hash: &str,
) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    conn.execute(
        "UPDATE files SET thumbnail_hash = ?1 WHERE id = ?2",
        params![hash, file_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns the source-file `modified` timestamp stored in the catalog for one
/// file row. Used by the thumbnail worker to avoid re-statting source files.
pub fn get_file_modified_by_id(
    app_handle: &AppHandle,
    file_id: i64,
) -> Result<Option<u64>, String> {
    let conn = open_connection(app_handle)?;
    let modified: Option<i64> = conn
        .query_row(
            "SELECT modified FROM files WHERE id = ?1",
            params![file_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(modified.map(|m| m as u64))
}

/// Returns every non-null thumbnail hash stored in the catalog.
pub fn get_all_thumbnail_hashes(app_handle: &AppHandle) -> Result<HashSet<String>, String> {
    let conn = open_connection(app_handle)?;
    let mut stmt = conn
        .prepare("SELECT thumbnail_hash FROM files WHERE thumbnail_hash IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Computes the expected thumbnail cache hash for every existing catalog row
/// and stores it. This preserves existing valid cache files across the first
/// cleanup instead of treating them as orphans because their rows start with a
/// NULL `thumbnail_hash`.
fn backfill_thumbnail_hashes(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id, path, modified, adjustments_json FROM files")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, String, Option<i64>, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for (file_id, path, modified, adjustments_json) in rows {
        // Use the catalog's stored modified timestamp. If it is missing, the
        // hash is computed with 0; falling back to a disk stat here would hit
        // network volumes on every startup.
        let modified = modified.map(|m| m as u64).unwrap_or(0);

        if let Some(hash) = compute_thumbnail_cache_hash(
            &path,
            Some(file_id),
            modified,
            adjustments_json.as_bytes(),
        ) {
            conn.execute(
                "UPDATE files SET thumbnail_hash = ?1 WHERE id = ?2",
                params![hash, file_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Loads one page of files under any path that belongs to the catalog. Works
/// for root folders as well as subfolders: it matches `files.path` against the
/// requested prefix, so a recursive import that stored everything under the
/// root folder_id still returns the correct subset for a subfolder.
pub fn load_folder_files_for_path(
    app_handle: &AppHandle,
    path: &str,
    recursive: bool,
    offset: usize,
    limit: usize,
) -> Result<Vec<ImageFile>, String> {
    let conn = open_connection(app_handle)?;
    let files = load_folder_files_for_path_in_conn(&conn, path, recursive, offset, limit)?;
    log::info!(
        "[catalog] load_folder_files_for_path returned {} files",
        files.len()
    );
    Ok(files)
}

fn load_folder_files_for_path_in_conn(
    conn: &Connection,
    path: &str,
    recursive: bool,
    offset: usize,
    limit: usize,
) -> Result<Vec<ImageFile>, String> {
    let normalized = path.trim_end_matches(|c| c == '/' || c == '\\');
    let sql = if recursive {
        "SELECT f.metadata_json FROM files f \
         WHERE f.path LIKE ?1 || '/%' \
         ORDER BY f.name, f.id \
         LIMIT ?2 OFFSET ?3"
    } else {
        "SELECT f.metadata_json FROM files f \
         WHERE f.path LIKE ?1 || '/%' AND instr(substr(f.path, length(?1)+2), '/') = 0 \
         ORDER BY f.name, f.id \
         LIMIT ?2 OFFSET ?3"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![normalized, limit as i64, offset as i64], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for row in rows {
        let json = row.map_err(|e| e.to_string())?;
        match serde_json::from_str::<ImageFile>(&json) {
            Ok(file) => files.push(file),
            Err(e) => log::warn!("skipping catalog row with corrupt metadata_json: {}", e),
        }
    }
    Ok(files)
}

/// Returns true when `path` is a cataloged folder, lies under one, or has
/// cataloged files directly underneath it. The last case covers subfolders
/// that are derived from file paths (e.g. a recursive import where only the
/// root has a `folders` row) so selecting them stays catalog-only.
pub fn is_folder_cataloged(app_handle: &AppHandle, path: &str) -> Result<bool, String> {
    let conn = open_connection(app_handle)?;
    let normalized = path.trim_end_matches(|c| c == '/' || c == '\\');
    let pattern = format!("{}/%", normalized);
    let folder_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM folders WHERE path = ?1 OR path LIKE ?2",
            params![normalized, pattern],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if folder_count > 0 {
        return Ok(true);
    }
    let file_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM files WHERE path LIKE ?1 || '/%'",
            params![normalized],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(file_count > 0)
}

/// Sets the `exif` field of the serialized `ImageFile` stored in
/// `metadata_json` without touching anything else, so catalog loads return
/// fully-populated `ImageFile`s. Falls back to the original string when it is
/// not a JSON object, so a corrupt row is never made worse.
fn merge_exif_into_metadata_json(
    metadata_json: &str,
    exif_map: &HashMap<String, String>,
) -> String {
    // No EXIF: leave the stored ImageFile's `exif: null` alone — inserting an
    // empty object would deserialize as `Some({})` on the frontend.
    if exif_map.is_empty() {
        return metadata_json.to_string();
    }
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(metadata_json) else {
        return metadata_json.to_string();
    };
    let Some(obj) = value.as_object_mut() else {
        return metadata_json.to_string();
    };
    let exif_value = serde_json::to_value(exif_map).unwrap_or(serde_json::Value::Null);
    obj.insert("exif".to_string(), exif_value);
    serde_json::to_string(&value).unwrap_or_else(|_| metadata_json.to_string())
}

/// Writes the post-EXIF state of one row. With `metadata_json`/`structured`
/// the full column set is stored; with both `None` (missing file, cloud
/// placeholder) the row is only marked scanned and its structured columns are
/// cleared, so the row is not retried forever (the sync/prune job removes
/// orphans). `metadata_json` is left untouched in that case.
fn update_exif_row(
    conn: &Connection,
    file_id: i64,
    metadata_json: Option<&str>,
    structured: Option<&StructuredExif>,
) -> Result<(), String> {
    match (metadata_json, structured) {
        (Some(json), Some(s)) => conn
            .execute(
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
                    file_id,
                    json,
                    s.date_taken,
                    s.iso,
                    s.aperture,
                    s.shutter,
                    s.focal_length,
                    s.focal_length_35,
                    s.make,
                    s.model,
                    s.lens_make,
                    s.lens_model,
                    s.orientation
                ],
            )
            .map_err(|e| e.to_string())?,
        _ => conn
            .execute(
                "UPDATE files SET
                    exif_scanned = 1,
                    date_taken = NULL, iso = NULL, aperture = NULL, shutter = NULL,
                    focal_length = NULL, focal_length_35 = NULL, make = NULL,
                    model = NULL, lens_make = NULL, lens_model = NULL, orientation = NULL
                 WHERE id = ?1",
                params![file_id],
            )
            .map_err(|e| e.to_string())?,
    };
    Ok(())
}

/// Marks a file's EXIF as scanned: stores the structured columns and merges
/// the formatted EXIF map into the stored `metadata_json`. Virtual-copy rows
/// of the same source file (`source_path?vc=id`) get the same values in the
/// same transaction. Pass `exif_map = None` for files that could not be read
/// at all (missing, empty, cloud placeholder): the row is marked scanned with
/// cleared columns instead of being retried on every run.
pub fn mark_exif_scanned(
    app_handle: &AppHandle,
    file_id: i64,
    source_path: &str,
    exif_map: Option<&HashMap<String, String>>,
    structured: &StructuredExif,
) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    mark_exif_scanned_in_conn(&conn, file_id, source_path, exif_map, structured)
}

fn mark_exif_scanned_in_conn(
    conn: &Connection,
    file_id: i64,
    source_path: &str,
    exif_map: Option<&HashMap<String, String>>,
    structured: &StructuredExif,
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let merged = match exif_map {
        Some(map) => {
            let current: Option<String> = tx
                .query_row(
                    "SELECT metadata_json FROM files WHERE id = ?1",
                    params![file_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            current.map(|json| merge_exif_into_metadata_json(&json, map))
        }
        None => None,
    };
    update_exif_row(
        &tx,
        file_id,
        merged.as_deref(),
        exif_map.map(|_| structured),
    )?;

    // Virtual copies share the source file's EXIF. The range scan uses the
    // implicit unique index on `path` (from the UNIQUE constraint) instead of
    // a full-table `instr(...)` scan.
    let vc_prefix = format!("{}?vc=", source_path);
    let mut vc_upper = vc_prefix.clone();
    vc_upper.push('\x7f'); // one past every possible `?vc=...` suffix
    let vc_rows: Vec<(i64, String)> = {
        let mut stmt = tx
            .prepare(
                "SELECT id, metadata_json FROM files
                 WHERE path >= ?1 AND path < ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![&vc_prefix, &vc_upper], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    for (vc_id, vc_json) in vc_rows {
        let merged_vc = exif_map.map(|map| merge_exif_into_metadata_json(&vc_json, map));
        update_exif_row(
            &tx,
            vc_id,
            merged_vc.as_deref(),
            exif_map.map(|_| structured),
        )?;
    }

    tx.commit().map_err(|e| e.to_string())
}

/// Fingerprint of one catalog row used by folder sync to detect changes:
/// `(modified, size, metadata_modified)`. `metadata_modified` is treated as a
/// dirty flag: it is stamped by `metadata_store` on every metadata write and
/// reset to `0` when the folder-import sync (re-)upserts the row. A `NULL`
/// `metadata_modified` is treated as `0` so a clean row compares equal to a
/// disk entry that has no metadata change pending.
pub type FileFingerprint = (Option<u64>, Option<u64>, Option<u64>);

/// Returns the fingerprints of every catalog row in `folder_id`, keyed by the
/// (possibly virtual) path. Virtual-copy rows (`path?vc=id`) are included:
/// sync matches them against the sidecar files found by the disk walk.
pub fn get_folder_file_fingerprints(
    app_handle: &AppHandle,
    folder_id: i64,
) -> Result<HashMap<String, FileFingerprint>, String> {
    let conn = open_connection(app_handle)?;
    get_folder_file_fingerprints_in_conn(&conn, folder_id)
}

fn get_folder_file_fingerprints_in_conn(
    conn: &Connection,
    folder_id: i64,
) -> Result<HashMap<String, FileFingerprint>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT path, modified, size, metadata_modified FROM files
             WHERE folder_id = ?1 ORDER BY id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![folder_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                (
                    row.get::<_, Option<i64>>(1)?.map(|v| v as u64),
                    row.get::<_, Option<i64>>(2)?.map(|v| v as u64),
                    // Treat a NULL metadata_modified as the clean sentinel 0.
                    Some(row.get::<_, Option<i64>>(3)?.unwrap_or(0) as u64),
                ),
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(|e| e.to_string())
}

/// Deletes catalog rows (and, via ON DELETE CASCADE, their tags) by exact
/// path — real paths and virtual-copy paths alike. Unknown paths are ignored.
pub fn delete_files_by_paths(app_handle: &AppHandle, paths: &[String]) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    delete_files_by_paths_in_conn(&mut conn, paths)
}

fn delete_files_by_paths_in_conn(conn: &mut Connection, paths: &[String]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // Chunked: SQLite caps bound variables per statement.
    for chunk in paths.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!("DELETE FROM files WHERE path IN ({})", placeholders);
        tx.execute(&sql, rusqlite::params_from_iter(chunk.iter()))
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Moves a cataloged folder to a new on-disk location: updates the `folders`
/// row(s) and rewrites every file path under the old prefix. The file match
/// is anchored on `old_path + '/'` via `instr(...) = 1`, so relocating
/// `/photos/2024` never touches `/photos/20245/...`, and LIKE wildcards in
/// paths stay literal. Virtual-copy paths (`...?vc=id`) keep their suffix:
/// the `?vc=` part comes after the filename, so a prefix rewrite is safe.
/// Returns `false` when no `folders` row matched `old_path` — callers treat
/// that as "folder is not cataloged" instead of succeeding vacuously.
pub fn relocate_folder(
    app_handle: &AppHandle,
    old_path: &str,
    new_path: &str,
) -> Result<bool, String> {
    let conn = open_connection(app_handle)?;
    relocate_folder_in_conn(&conn, old_path, new_path)
}

fn relocate_folder_in_conn(
    conn: &Connection,
    old_path: &str,
    new_path: &str,
) -> Result<bool, String> {
    // Stored folder paths never carry a trailing separator; accept one anyway.
    let old_trimmed = old_path.trim_end_matches(&['/', '\\'][..]);
    let new_trimmed = new_path.trim_end_matches(&['/', '\\'][..]);
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let folder_rows = tx
        .execute(
            "UPDATE folders SET path = ?2 WHERE path = ?1",
            params![old_trimmed, new_trimmed],
        )
        .map_err(|e| e.to_string())?;

    let old_prefix = format!("{}/", old_trimmed);
    let new_prefix = format!("{}/", new_trimmed);
    // substr() is 1-indexed; length() counts characters, so use chars().count().
    let skip = old_prefix.chars().count() as i64 + 1;
    tx.execute(
        "UPDATE files SET path = ?2 || substr(path, ?3) WHERE instr(path, ?1) = 1",
        params![old_prefix, new_prefix, skip],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(folder_rows > 0)
}

/// Stamps `folders.last_synced_at` after a successful sync delta apply.
pub fn update_folder_last_synced(app_handle: &AppHandle, folder_id: i64) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let conn = open_connection(app_handle)?;
    update_folder_last_synced_in_conn(&conn, folder_id, now)
}

fn update_folder_last_synced_in_conn(
    conn: &Connection,
    folder_id: i64,
    timestamp: u64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE folders SET last_synced_at = ?2 WHERE id = ?1",
        params![folder_id, timestamp as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns the `last_synced_at` timestamp for a (path, recursive) folder
/// entry, or `None` when the folder is not cataloged.
pub fn get_folder_last_synced(
    app_handle: &AppHandle,
    path: &str,
    recursive: bool,
) -> Result<Option<u64>, String> {
    let conn = open_connection(app_handle)?;
    conn.query_row(
        "SELECT last_synced_at FROM folders WHERE path = ?1 AND recursive = ?2",
        params![path, recursive as i32],
        |row| row.get::<_, Option<i64>>(0),
    )
    .optional()
    .map(|v| v.flatten().map(|ts| ts as u64))
    .map_err(|e| e.to_string())
}

/// Returns all folder paths stored in the catalog. This is the authoritative
/// list of folders that should appear in the folder tree.
pub fn get_cataloged_folder_paths(app_handle: &AppHandle) -> Result<Vec<String>, String> {
    let conn = open_connection(app_handle)?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT path FROM folders ORDER BY path")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut paths = Vec::new();
    for row in rows {
        paths.push(row.map_err(|e| e.to_string())?);
    }
    Ok(paths)
}

/// Returns every cataloged folder path at or under `root_path`. Explicitly
/// imported empty folders are included even when they contain no files. This
/// gives the set of nodes the folder tree must render; file counts are computed
/// separately from the actual file paths so a recursive import that stores all
/// files under the root folder_id still shows the correct subfolder hierarchy.
pub fn get_folder_subtree_paths(
    app_handle: &AppHandle,
    root_path: &str,
) -> Result<Vec<(String, i64, i32)>, String> {
    let conn = open_connection(app_handle)?;
    let root_normalized = root_path.trim_end_matches(|c| c == '/' || c == '\\');
    let pattern = format!("{}/%", root_normalized);
    let mut stmt = conn
        .prepare(
            "SELECT f.path, f.id, f.recursive \
             FROM folders f \
             WHERE f.path = ?1 OR f.path LIKE ?2 \
             ORDER BY f.path",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![root_normalized, pattern], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i32>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Returns every real-file path (and its modified timestamp) stored under any
/// cataloged folder at or under `root_path`. Virtual-copy rows (`?vc=`) are
/// skipped. Used to derive subfolder nodes and direct file counts for the
/// folder tree without relying on which `folder_id` a file was assigned to.
pub fn get_files_under_folder_subtree(
    app_handle: &AppHandle,
    root_path: &str,
) -> Result<Vec<(String, Option<i64>)>, String> {
    let conn = open_connection(app_handle)?;
    let root_normalized = root_path.trim_end_matches(|c| c == '/' || c == '\\');
    let pattern = format!("{}/%", root_normalized);
    let mut stmt = conn
        .prepare(
            "SELECT files.path, files.modified \
             FROM files \
             JOIN folders f ON f.id = files.folder_id \
             WHERE (f.path = ?1 OR f.path LIKE ?2) AND files.path NOT LIKE '%?vc=%' \
             ORDER BY files.path",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![root_normalized, pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Files eligible for archiving from a source folder subtree. Returns rows for
/// real (non-virtual-copy) imported images together with their folder and date.
pub fn get_files_for_archive<R: Runtime>(
    app_handle: &AppHandle<R>,
    source_path: &str,
) -> Result<Vec<(i64, String, Option<String>, i64)>, String> {
    let conn = open_connection(app_handle)?;
    let normalized = source_path.trim_end_matches(|c| c == '/' || c == '\\');
    let pattern = format!("{}/%", normalized);
    let mut stmt = conn
        .prepare(
            "SELECT files.id, files.path, files.date_taken, files.folder_id \
             FROM files \
             JOIN folders f ON f.id = files.folder_id \
             WHERE (f.path = ?1 OR f.path LIKE ?2) \
               AND files.is_virtual_copy = 0 \
               AND files.is_cloud_placeholder = 0 \
             ORDER BY files.path",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![normalized, pattern], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Updates the catalog for one physical file that was moved to a new location.
/// Both the master row and any virtual-copy rows (`old_path?vc=...`) are
/// rewritten to point at `new_path`. The caller is responsible for the
/// surrounding transaction.
pub fn update_file_path_in_conn(
    conn: &Connection,
    old_path: &str,
    new_path: &str,
    new_folder_id: i64,
    new_modified: Option<i64>,
) -> Result<usize, String> {
    let new_name = PathBuf::from(new_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let old_vc_pattern = format!("{}?vc=%", old_path);

    let mut updated = if let Some(m) = new_modified {
        conn.execute(
            "UPDATE files SET path = ?1, name = ?2, folder_id = ?3, modified = ?4 WHERE path = ?5",
            params![new_path, new_name, new_folder_id, m, old_path],
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.execute(
            "UPDATE files SET path = ?1, name = ?2, folder_id = ?3 WHERE path = ?4",
            params![new_path, new_name, new_folder_id, old_path],
        )
        .map_err(|e| e.to_string())?
    };

    updated += if let Some(m) = new_modified {
        conn.execute(
            "UPDATE files SET path = REPLACE(path, ?1, ?2), name = ?3, folder_id = ?4, modified = ?5 WHERE path LIKE ?6",
            params![old_path, new_path, new_name, new_folder_id, m, old_vc_pattern],
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.execute(
            "UPDATE files SET path = REPLACE(path, ?1, ?2), name = ?3, folder_id = ?4 WHERE path LIKE ?5",
            params![old_path, new_path, new_name, new_folder_id, old_vc_pattern],
        )
        .map_err(|e| e.to_string())?
    };

    increment_backup_counter_in_conn(conn, updated as i64)?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_schema_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        // user_version not set by SCHEMA_V1; migration sets it in real flow.
        assert_eq!(version, 0);
    }

    #[test]
    fn test_migrate_sets_version() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        // Idempotent on second run.
        migrate(&conn).unwrap();
    }

    fn sample_file() -> FileRowInput {
        FileRowInput {
            path: "/tmp/x/a.jpg".to_string(),
            name: "a.jpg".to_string(),
            modified: Some(100),
            size: Some(10),
            extension: "jpg".to_string(),
            is_raw: false,
            is_edited: true,
            is_virtual_copy: false,
            is_cloud_placeholder: false,
            rating: 3,
            flag: 1,
            color: Some("red".to_string()),
            metadata_json: "{}".to_string(),
            tags: vec![
                ("cat".to_string(), "ai".to_string()),
                ("user:trip".to_string(), "user".to_string()),
            ],
        }
    }

    fn setup_conn() -> (Connection, i64) {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn.execute(
            "INSERT INTO folders(path, recursive) VALUES ('/tmp/x', 0)",
            [],
        )
        .unwrap();
        let folder_id = conn.last_insert_rowid();
        (conn, folder_id)
    }

    #[test]
    fn test_upsert_folder_returns_stable_id_on_conflict() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let a1 = upsert_folder_in_conn(&conn, "/tmp/a", false).unwrap();
        let b = upsert_folder_in_conn(&conn, "/tmp/b", false).unwrap();
        let a2 = upsert_folder_in_conn(&conn, "/tmp/a", false).unwrap();

        assert_ne!(a1, b);
        assert_eq!(a1, a2);
        // Distinct (path, recursive) pairs get distinct rows.
        let a_recursive = upsert_folder_in_conn(&conn, "/tmp/a", true).unwrap();
        assert_ne!(a_recursive, a1);
    }

    #[test]
    fn test_upsert_files_insert() {
        let (mut conn, folder_id) = setup_conn();
        upsert_files_in_conn(&mut conn, folder_id, std::slice::from_ref(&sample_file())).unwrap();

        let (name, rating, flag, color, exif_scanned, is_edited): (
            String,
            i64,
            i64,
            Option<String>,
            i64,
            i64,
        ) = conn
            .query_row(
                "SELECT name, rating, flag, color, exif_scanned, is_edited
                 FROM files WHERE path = '/tmp/x/a.jpg'",
                [],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(name, "a.jpg");
        assert_eq!((rating, flag, exif_scanned, is_edited), (3, 1, 0, 1));
        assert_eq!(color.as_deref(), Some("red"));

        let mut stmt = conn
            .prepare("SELECT tag, source FROM tags ORDER BY tag")
            .unwrap();
        let tags: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            tags,
            vec![
                ("cat".to_string(), "ai".to_string()),
                ("user:trip".to_string(), "user".to_string())
            ]
        );
    }

    #[test]
    fn test_upsert_files_conflict_preserves_exif_scanned_when_unchanged() {
        let (mut conn, folder_id) = setup_conn();
        upsert_files_in_conn(&mut conn, folder_id, std::slice::from_ref(&sample_file())).unwrap();
        let file_id: i64 = conn
            .query_row(
                "SELECT id FROM files WHERE path = '/tmp/x/a.jpg'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // Simulate the EXIF phase having processed this file.
        conn.execute(
            "UPDATE files SET exif_scanned = 1 WHERE id = ?1",
            params![file_id],
        )
        .unwrap();

        // Re-scan with unchanged modified/size: exif_scanned is preserved and
        // the row keeps its id.
        upsert_files_in_conn(&mut conn, folder_id, std::slice::from_ref(&sample_file())).unwrap();
        let (id_after, exif_scanned): (i64, i64) = conn
            .query_row(
                "SELECT id, exif_scanned FROM files WHERE path = '/tmp/x/a.jpg'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(id_after, file_id);
        assert_eq!(exif_scanned, 1);
    }

    #[test]
    fn test_upsert_files_conflict_resets_exif_scanned_and_replaces_tags() {
        let (mut conn, folder_id) = setup_conn();
        upsert_files_in_conn(&mut conn, folder_id, std::slice::from_ref(&sample_file())).unwrap();
        conn.execute("UPDATE files SET exif_scanned = 1", [])
            .unwrap();

        let mut changed = sample_file();
        changed.modified = Some(200);
        changed.rating = 5;
        changed.tags = vec![("dog".to_string(), "ai".to_string())];
        upsert_files_in_conn(&mut conn, folder_id, &[changed]).unwrap();

        let (exif_scanned, rating): (i64, i64) = conn
            .query_row(
                "SELECT exif_scanned, rating FROM files WHERE path = '/tmp/x/a.jpg'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((exif_scanned, rating), (0, 5));

        let tags: Vec<String> = {
            let mut stmt = conn.prepare("SELECT tag FROM tags").unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(tags, vec!["dog".to_string()]);
    }

    fn exif_test_map() -> HashMap<String, String> {
        HashMap::from([
            ("Make".to_string(), "Canon".to_string()),
            ("Model".to_string(), "\"EOS R5\"".to_string()),
            ("LensModel".to_string(), "RF 50mm F1.2L".to_string()),
            ("ISOSpeed".to_string(), "400".to_string()),
            ("FNumber".to_string(), "f/2.8".to_string()),
            ("ExposureTime".to_string(), "1/125 s".to_string()),
            ("FocalLength".to_string(), "50 mm".to_string()),
            ("FocalLengthIn35mmFilm".to_string(), "50".to_string()),
            ("Orientation".to_string(), "1".to_string()),
            (
                "DateTimeOriginal".to_string(),
                "2024-05-01 12:30:00".to_string(),
            ),
        ])
    }

    #[test]
    fn test_structured_exif_from_exif_map() {
        let structured = StructuredExif::from_exif_map(&exif_test_map());
        assert_eq!(structured.make.as_deref(), Some("Canon"));
        // Quotes are stripped.
        assert_eq!(structured.model.as_deref(), Some("EOS R5"));
        assert_eq!(structured.lens_model.as_deref(), Some("RF 50mm F1.2L"));
        assert_eq!(structured.iso, Some(400));
        assert_eq!(structured.aperture, Some(2.8));
        assert!((structured.shutter.unwrap() - 1.0 / 125.0).abs() < 1e-9);
        assert_eq!(structured.focal_length, Some(50.0));
        assert_eq!(structured.focal_length_35, Some(50.0));
        assert_eq!(structured.orientation, Some(1));
        assert_eq!(
            structured.date_taken.as_deref(),
            Some("2024-05-01 12:30:00")
        );

        // Long exposures and missing keys.
        let map = HashMap::from([("ExposureTime".to_string(), "2 s".to_string())]);
        let structured = StructuredExif::from_exif_map(&map);
        assert_eq!(structured.shutter, Some(2.0));
        assert_eq!(structured.iso, None);
        assert_eq!(structured.make, None);
    }

    #[test]
    fn test_apex_fallbacks_are_converted_to_real_units() {
        // ShutterSpeedValue/ApertureValue are stored as raw APEX numbers:
        // bare/"f/"-prefixed from the RAW path, " EV"-suffixed from the
        // non-RAW path. 7 EV = 1/128 s, 5.66 APEX = 2^(5.66/2) ≈ f/7.1.
        let expected_aperture = 2f32.powf(5.66 / 2.0);
        for (shutter_value, aperture_value) in [("7", "f/5.66"), ("7 EV", "5.66 EV")] {
            let map = HashMap::from([
                ("ShutterSpeedValue".to_string(), shutter_value.to_string()),
                ("ApertureValue".to_string(), aperture_value.to_string()),
            ]);
            let structured = StructuredExif::from_exif_map(&map);
            assert!((structured.shutter.unwrap() - 1.0 / 128.0).abs() < 1e-6);
            assert!((structured.aperture.unwrap() - expected_aperture).abs() < 1e-6);
        }

        // The true-units keys win when both are present.
        let map = HashMap::from([
            ("ExposureTime".to_string(), "1/125 s".to_string()),
            ("ShutterSpeedValue".to_string(), "99".to_string()),
            ("FNumber".to_string(), "f/2.8".to_string()),
            ("ApertureValue".to_string(), "99".to_string()),
        ]);
        let structured = StructuredExif::from_exif_map(&map);
        assert!((structured.shutter.unwrap() - 1.0 / 125.0).abs() < 1e-9);
        assert_eq!(structured.aperture, Some(2.8));
    }

    #[test]
    fn test_date_taken_colon_format_is_normalized() {
        // The non-RAW path stores the raw EXIF date with colons.
        let map = HashMap::from([(
            "DateTimeOriginal".to_string(),
            "2024:05:01 12:30:00".to_string(),
        )]);
        let structured = StructuredExif::from_exif_map(&map);
        assert_eq!(
            structured.date_taken.as_deref(),
            Some("2024-05-01 12:30:00")
        );

        // Already-normalized (RAW path) stays untouched.
        let map = HashMap::from([(
            "DateTimeOriginal".to_string(),
            "2024-05-01 12:30:00".to_string(),
        )]);
        let structured = StructuredExif::from_exif_map(&map);
        assert_eq!(
            structured.date_taken.as_deref(),
            Some("2024-05-01 12:30:00")
        );
    }

    #[test]
    fn test_non_finite_values_are_rejected() {
        let map = HashMap::from([
            ("FNumber".to_string(), "f/inf".to_string()),
            ("ExposureTime".to_string(), "NaN s".to_string()),
            ("FocalLength".to_string(), "inf mm".to_string()),
        ]);
        let structured = StructuredExif::from_exif_map(&map);
        assert_eq!(structured.aperture, None);
        assert_eq!(structured.shutter, None);
        assert_eq!(structured.focal_length, None);
    }

    #[test]
    fn test_get_files_needing_exif_excludes_scanned_and_virtual_copies() {
        let (mut conn, folder_id) = setup_conn();
        let mut vc = sample_file();
        vc.path = "/tmp/x/a.jpg?vc=abc123".to_string();
        vc.is_virtual_copy = true;
        upsert_files_in_conn(&mut conn, folder_id, &[sample_file(), vc]).unwrap();

        let pending = get_files_needing_exif_in_conn(&conn, folder_id).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].1, "/tmp/x/a.jpg");

        mark_exif_scanned_in_conn(
            &conn,
            pending[0].0,
            "/tmp/x/a.jpg",
            None,
            &StructuredExif::default(),
        )
        .unwrap();
        assert!(
            get_files_needing_exif_in_conn(&conn, folder_id)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn test_mark_exif_scanned_stores_columns_merges_metadata_and_fills_vcs() {
        let (mut conn, folder_id) = setup_conn();
        let mut vc = sample_file();
        vc.path = "/tmp/x/a.jpg?vc=abc123".to_string();
        vc.is_virtual_copy = true;
        upsert_files_in_conn(&mut conn, folder_id, &[sample_file(), vc]).unwrap();
        let base_id: i64 = conn
            .query_row(
                "SELECT id FROM files WHERE path = '/tmp/x/a.jpg'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        let map = exif_test_map();
        let structured = StructuredExif::from_exif_map(&map);
        mark_exif_scanned_in_conn(&conn, base_id, "/tmp/x/a.jpg", Some(&map), &structured).unwrap();

        for path in ["/tmp/x/a.jpg", "/tmp/x/a.jpg?vc=abc123"] {
            let (exif_scanned, iso, aperture, make, metadata_json): (
                i64,
                Option<i64>,
                Option<f64>,
                Option<String>,
                String,
            ) = conn
                .query_row(
                    "SELECT exif_scanned, iso, aperture, make, metadata_json
                     FROM files WHERE path = ?1",
                    params![path],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .unwrap();
            assert_eq!(
                (exif_scanned, iso, make.as_deref()),
                (1, Some(400), Some("Canon"))
            );
            // f32 is stored as SQLite REAL (f64); allow round-trip precision loss.
            assert!((aperture.unwrap() - 2.8).abs() < 1e-6);
            // The EXIF map is merged into the stored ImageFile JSON.
            let parsed: serde_json::Value = serde_json::from_str(&metadata_json).unwrap();
            assert_eq!(parsed["exif"]["Make"], "Canon");
            assert_eq!(parsed["exif"]["ISOSpeed"], "400");
        }
    }

    #[test]
    fn test_mark_exif_scanned_without_map_clears_columns_and_keeps_metadata_json() {
        let (mut conn, folder_id) = setup_conn();
        upsert_files_in_conn(&mut conn, folder_id, std::slice::from_ref(&sample_file())).unwrap();
        let base_id: i64 = conn
            .query_row(
                "SELECT id FROM files WHERE path = '/tmp/x/a.jpg'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // First a successful scan, then the file disappears: the row is
        // marked scanned with cleared columns and metadata_json untouched.
        let map = exif_test_map();
        let structured = StructuredExif::from_exif_map(&map);
        mark_exif_scanned_in_conn(&conn, base_id, "/tmp/x/a.jpg", Some(&map), &structured).unwrap();
        let json_before: String = conn
            .query_row(
                "SELECT metadata_json FROM files WHERE id = ?1",
                params![base_id],
                |r| r.get(0),
            )
            .unwrap();

        mark_exif_scanned_in_conn(
            &conn,
            base_id,
            "/tmp/x/a.jpg",
            None,
            &StructuredExif::default(),
        )
        .unwrap();

        let (exif_scanned, iso, make, json_after): (i64, Option<i64>, Option<String>, String) =
            conn.query_row(
                "SELECT exif_scanned, iso, make, metadata_json FROM files WHERE id = ?1",
                params![base_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!((exif_scanned, iso, make), (1, None, None));
        assert_eq!(json_after, json_before);
    }

    #[test]
    fn test_mark_exif_scanned_with_empty_map_does_not_insert_empty_exif_object() {
        // A file with no EXIF at all still counts as scanned, but the stored
        // ImageFile JSON must keep `exif: null` (an empty object would
        // deserialize as `Some({})` on the frontend).
        let (mut conn, folder_id) = setup_conn();
        upsert_files_in_conn(&mut conn, folder_id, std::slice::from_ref(&sample_file())).unwrap();
        let base_id: i64 = conn
            .query_row(
                "SELECT id FROM files WHERE path = '/tmp/x/a.jpg'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let json_before: String = conn
            .query_row(
                "SELECT metadata_json FROM files WHERE id = ?1",
                params![base_id],
                |r| r.get(0),
            )
            .unwrap();

        let empty_map = HashMap::new();
        let structured = StructuredExif::from_exif_map(&empty_map);
        mark_exif_scanned_in_conn(
            &conn,
            base_id,
            "/tmp/x/a.jpg",
            Some(&empty_map),
            &structured,
        )
        .unwrap();

        let (exif_scanned, iso, json_after): (i64, Option<i64>, String) = conn
            .query_row(
                "SELECT exif_scanned, iso, metadata_json FROM files WHERE id = ?1",
                params![base_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((exif_scanned, iso), (1, None));
        assert_eq!(json_after, json_before);
    }

    #[test]
    fn test_get_file_id_by_path_finds_real_and_virtual_rows() {
        let (mut conn, folder_id) = setup_conn();
        let mut vc = sample_file();
        vc.path = "/tmp/x/a.jpg?vc=abc123".to_string();
        vc.is_virtual_copy = true;
        upsert_files_in_conn(&mut conn, folder_id, &[sample_file(), vc]).unwrap();

        let real_id = get_file_id_by_path_in_conn(&conn, "/tmp/x/a.jpg").unwrap();
        let vc_id = get_file_id_by_path_in_conn(&conn, "/tmp/x/a.jpg?vc=abc123").unwrap();
        assert!(real_id.is_some());
        assert!(vc_id.is_some());
        assert_ne!(real_id, vc_id);

        // Uncataloged paths resolve to None, not an error.
        assert_eq!(
            get_file_id_by_path_in_conn(&conn, "/tmp/x/never-scanned.jpg").unwrap(),
            None
        );
    }

    #[test]
    fn test_get_all_file_paths_includes_virtual_copies_ordered_by_id() {
        let (mut conn, folder_id) = setup_conn();
        let mut vc = sample_file();
        vc.path = "/tmp/x/a.jpg?vc=abc123".to_string();
        vc.is_virtual_copy = true;
        let mut other = sample_file();
        other.path = "/tmp/x/b.jpg".to_string();
        other.name = "b.jpg".to_string();
        upsert_files_in_conn(&mut conn, folder_id, &[sample_file(), vc, other]).unwrap();

        let rows = get_all_file_paths_in_conn(&conn, folder_id).unwrap();
        let paths: Vec<&str> = rows.iter().map(|(_, p)| p.as_str()).collect();
        assert_eq!(
            paths,
            vec!["/tmp/x/a.jpg", "/tmp/x/a.jpg?vc=abc123", "/tmp/x/b.jpg"]
        );
        // Ids are round-trippable through get_file_id_by_path.
        for (id, path) in &rows {
            assert_eq!(get_file_id_by_path_in_conn(&conn, path).unwrap(), Some(*id));
        }

        // Another folder's rows are not included.
        assert!(
            get_all_file_paths_in_conn(&conn, folder_id + 1)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn test_get_folder_file_fingerprints_includes_virtual_copies() {
        let (mut conn, folder_id) = setup_conn();
        let mut vc = sample_file();
        vc.path = "/tmp/x/a.jpg?vc=abc123".to_string();
        vc.is_virtual_copy = true;
        let mut no_sidecar = sample_file();
        no_sidecar.path = "/tmp/x/b.jpg".to_string();
        no_sidecar.name = "b.jpg".to_string();
        upsert_files_in_conn(&mut conn, folder_id, &[sample_file(), vc, no_sidecar]).unwrap();

        let fps = get_folder_file_fingerprints_in_conn(&conn, folder_id).unwrap();
        assert_eq!(fps.len(), 3);
        // `upsert_files` resets metadata_modified to the clean sentinel 0.
        assert_eq!(fps["/tmp/x/a.jpg"], (Some(100), Some(10), Some(0)));
        assert_eq!(
            fps["/tmp/x/a.jpg?vc=abc123"],
            (Some(100), Some(10), Some(0))
        );
        assert_eq!(fps["/tmp/x/b.jpg"], (Some(100), Some(10), Some(0)));

        // Another folder's rows are not included.
        assert!(
            get_folder_file_fingerprints_in_conn(&conn, folder_id + 1)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn test_delete_files_by_paths_removes_rows_and_cascades_tags() {
        let (mut conn, folder_id) = setup_conn();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        let mut vc = sample_file();
        vc.path = "/tmp/x/a.jpg?vc=abc123".to_string();
        vc.is_virtual_copy = true;
        let mut other = sample_file();
        other.path = "/tmp/x/b.jpg".to_string();
        other.name = "b.jpg".to_string();
        upsert_files_in_conn(&mut conn, folder_id, &[sample_file(), vc, other]).unwrap();

        delete_files_by_paths_in_conn(
            &mut conn,
            &[
                "/tmp/x/a.jpg".to_string(),
                "/tmp/x/a.jpg?vc=abc123".to_string(),
                "/tmp/x/never-cataloged.jpg".to_string(),
            ],
        )
        .unwrap();

        let remaining = get_all_file_paths_in_conn(&conn, folder_id).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].1, "/tmp/x/b.jpg");
        // The deleted rows' tags went with them.
        let tag_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tag_count, 2); // only b.jpg's tags remain

        // Empty input is a no-op, not an error.
        delete_files_by_paths_in_conn(&mut conn, &[]).unwrap();
    }

    #[test]
    fn test_relocate_folder_anchors_prefix_and_preserves_vc_suffix() {
        let (mut conn, folder_id) = setup_conn();
        // setup_conn created folder '/tmp/x'; move it to '/tmp/y'.
        let mut sub = sample_file();
        sub.path = "/tmp/x/sub/b.jpg".to_string();
        sub.name = "b.jpg".to_string();
        let mut vc = sample_file();
        vc.path = "/tmp/x/a.jpg?vc=abc123".to_string();
        vc.is_virtual_copy = true;
        let mut lookalike = sample_file();
        lookalike.path = "/tmp/x2/c.jpg".to_string();
        lookalike.name = "c.jpg".to_string();
        upsert_files_in_conn(&mut conn, folder_id, &[sample_file(), sub, vc, lookalike]).unwrap();

        assert!(relocate_folder_in_conn(&conn, "/tmp/x", "/tmp/y").unwrap());

        let folder_path: String = conn
            .query_row(
                "SELECT path FROM folders WHERE id = ?1",
                params![folder_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(folder_path, "/tmp/y");

        let rows = get_all_file_paths_in_conn(&conn, folder_id).unwrap();
        let paths: Vec<&str> = rows.iter().map(|(_, p)| p.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                "/tmp/y/a.jpg",
                "/tmp/y/sub/b.jpg",
                "/tmp/y/a.jpg?vc=abc123",
                // Prefix-anchored: '/tmp/x2/...' does not start with '/tmp/x/'.
                "/tmp/x2/c.jpg",
            ]
        );

        // A trailing separator on the old path still matches.
        assert!(relocate_folder_in_conn(&conn, "/tmp/y/", "/tmp/z").unwrap());
        assert!(
            get_file_id_by_path_in_conn(&conn, "/tmp/z/a.jpg")
                .unwrap()
                .is_some()
        );

        // An uncataloged old path relocates nothing and reports false.
        assert!(!relocate_folder_in_conn(&conn, "/tmp/never-cataloged", "/tmp/w").unwrap());
    }

    #[test]
    fn test_update_folder_last_synced_stamps_timestamp() {
        let (conn, folder_id) = setup_conn();
        assert!(
            conn.query_row(
                "SELECT last_synced_at FROM folders WHERE id = ?1",
                params![folder_id],
                |r| r.get::<_, Option<i64>>(0)
            )
            .unwrap()
            .is_none()
        );

        update_folder_last_synced_in_conn(&conn, folder_id, 1_700_000_000).unwrap();
        let stamped: Option<i64> = conn
            .query_row(
                "SELECT last_synced_at FROM folders WHERE id = ?1",
                params![folder_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stamped, Some(1_700_000_000));
    }

    #[test]
    fn test_update_and_get_file_metadata_round_trip() {
        let (mut conn, folder_id) = setup_conn();
        upsert_files_in_conn(&mut conn, folder_id, std::slice::from_ref(&sample_file())).unwrap();
        let file_id: i64 = conn
            .query_row(
                "SELECT id FROM files WHERE path = '/tmp/x/a.jpg'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        let before = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        update_file_metadata_in_conn(&conn, file_id, r#"{"exposure":0.5}"#, None).unwrap();

        let meta = get_file_metadata_in_conn(&conn, file_id).unwrap().unwrap();
        assert_eq!(meta.adjustments_json, r#"{"exposure":0.5}"#);
        assert_eq!(meta.exif_json, None);
        assert!(
            meta.metadata_modified.unwrap() >= before,
            "metadata_modified should be stamped with the current time"
        );

        update_file_metadata_in_conn(
            &conn,
            file_id,
            r#"{"exposure":1.0}"#,
            Some(r#"{"iso":400}"#),
        )
        .unwrap();

        let meta = get_file_metadata_in_conn(&conn, file_id).unwrap().unwrap();
        assert_eq!(meta.adjustments_json, r#"{"exposure":1.0}"#);
        assert_eq!(meta.exif_json.as_deref(), Some(r#"{"iso":400}"#));
    }

    #[test]
    fn test_get_file_metadata_unknown_file_returns_none() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        assert_eq!(get_file_metadata_in_conn(&conn, 999).unwrap(), None);
    }

    #[test]
    fn test_update_file_rating_flag_tags() {
        let (mut conn, folder_id) = setup_conn();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        upsert_files_in_conn(&mut conn, folder_id, std::slice::from_ref(&sample_file())).unwrap();
        let file_id: i64 = conn
            .query_row(
                "SELECT id FROM files WHERE path = '/tmp/x/a.jpg'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        let tags = Some(vec![
            "user:holiday".to_string(),
            "color:red".to_string(),
            "landscape".to_string(),
        ]);
        let before = now_secs();
        update_file_rating_flag_tags_in_conn(&conn, file_id, 4, -1, tags.as_deref()).unwrap();

        let (rating, flag, metadata_modified): (i64, i64, Option<i64>) = conn
            .query_row(
                "SELECT rating, flag, metadata_modified FROM files WHERE id = ?1",
                params![file_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((rating, flag), (4, -1));
        assert!(
            metadata_modified.unwrap() >= before,
            "metadata_modified should be stamped with the current time"
        );

        let stored_tags: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare("SELECT tag, source FROM tags WHERE file_id = ?1 ORDER BY tag")
                .unwrap();
            stmt.query_map(params![file_id], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(
            stored_tags,
            vec![
                ("holiday".to_string(), "user".to_string()),
                ("landscape".to_string(), "ai".to_string()),
                ("red".to_string(), "color".to_string()),
            ]
        );

        // Updating with no tags clears existing ones.
        update_file_rating_flag_tags_in_conn(&conn, file_id, 4, -1, None).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE file_id = ?1",
                params![file_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_migrate_from_v1_adds_columns_and_history_tables() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1_PRE_MIGRATION).unwrap();
        conn.pragma_update(None, "user_version", 1i32).unwrap();

        migrate(&conn).unwrap();

        let columns: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM pragma_table_info('files')")
                .unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert!(columns.contains(&"adjustments_json".to_string()));
        assert!(columns.contains(&"metadata_modified".to_string()));
        assert!(columns.contains(&"exif_json".to_string()));

        let tables: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert!(tables.contains(&"file_adjustment_deltas".to_string()));
        assert!(tables.contains(&"file_adjustment_snapshots".to_string()));

        let indexes: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
                .unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert!(indexes.contains(&"idx_deltas_file_created".to_string()));
        assert!(indexes.contains(&"idx_snapshots_file_created".to_string()));

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_migrate_from_partial_v3_is_idempotent() {
        // Simulate a crash that added the V3 columns but did not bump
        // user_version. Migration must recover without "duplicate column" errors.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1_PRE_MIGRATION).unwrap();
        conn.execute_batch(SCHEMA_V2).unwrap();
        conn.execute(
            "ALTER TABLE file_adjustment_deltas ADD COLUMN step_index INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .unwrap();
        conn.execute(
            "ALTER TABLE file_adjustment_deltas ADD COLUMN idx INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .unwrap();
        conn.execute(
            "ALTER TABLE file_adjustment_snapshots ADD COLUMN idx INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .unwrap();
        conn.execute("ALTER TABLE files ADD COLUMN history_index INTEGER", [])
            .unwrap();
        conn.pragma_update(None, "user_version", 2i32).unwrap();

        migrate(&conn).unwrap();

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);

        let indexes: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
                .unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert!(indexes.contains(&"idx_deltas_file_step".to_string()));
    }

    fn image_row(name: &str, exif: Option<HashMap<String, String>>) -> FileRowInput {
        let image = ImageFile {
            path: format!("/tmp/x/{}", name),
            modified: 100,
            is_edited: false,
            rating: 0,
            flag: 0,
            tags: None,
            exif,
            is_virtual_copy: false,
            is_cloud_placeholder: false,
        };
        let mut row = sample_file();
        row.path = image.path.clone();
        row.name = name.to_string();
        row.metadata_json = serde_json::to_string(&image).unwrap();
        row
    }

    #[test]
    fn test_load_folder_files_pages_in_name_order_and_skips_corrupt_rows() {
        let (mut conn, folder_id) = setup_conn();
        let exif = HashMap::from([("ISO".to_string(), "400".to_string())]);
        upsert_files_in_conn(
            &mut conn,
            folder_id,
            &[
                image_row("b.jpg", None),
                image_row("A.jpg", Some(exif)),
                image_row("c.jpg", None),
            ],
        )
        .unwrap();
        // A row whose metadata_json is not a valid serialized ImageFile.
        conn.execute(
            "INSERT INTO files(folder_id, path, name, metadata_json)
             VALUES (?1, '/tmp/x/z.jpg', 'z.jpg', 'not json')",
            params![folder_id],
        )
        .unwrap();

        // Page size 2: ordering is by name COLLATE NOCASE (id tiebreaker).
        let page1 = load_folder_files_for_path_in_conn(&conn, "/tmp/x", false, 0, 2).unwrap();
        let page2 = load_folder_files_for_path_in_conn(&conn, "/tmp/x", false, 2, 2).unwrap();
        let page3 = load_folder_files_for_path_in_conn(&conn, "/tmp/x", false, 4, 2).unwrap();
        let names = |files: &[ImageFile]| {
            files
                .iter()
                .map(|f| f.path.rsplit('/').next().unwrap().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&page1), vec!["A.jpg", "b.jpg"]);
        // z.jpg's corrupt JSON is skipped, not an error.
        assert_eq!(names(&page2), vec!["c.jpg"]);
        assert!(page3.is_empty());

        // Deserialized rows carry the EXIF merged by the EXIF phase.
        assert_eq!(page1[0].exif.as_ref().unwrap().get("ISO").unwrap(), "400");

        // The recursive variant also includes direct children of the path.
        assert_eq!(
            names(&load_folder_files_for_path_in_conn(&conn, "/tmp/x", true, 0, 10).unwrap()),
            vec!["A.jpg", "b.jpg", "c.jpg"]
        );
    }

    fn file_row(path: &str) -> FileRowInput {
        let mut row = sample_file();
        row.path = path.to_string();
        row.name = path.rsplit('/').next().unwrap_or(path).to_string();
        row.is_virtual_copy = path.contains("?vc=");
        row
    }

    #[test]
    fn test_save_and_load_edit_history() {
        let (mut conn, folder_id) = setup_conn();
        upsert_files_in_conn(&mut conn, folder_id, &[file_row("/tmp/a.jpg")]).unwrap();
        let file_id: i64 = conn
            .query_row("SELECT id FROM files WHERE path = '/tmp/a.jpg'", [], |r| {
                r.get(0)
            })
            .unwrap();

        let snapshot = AdjustmentSnapshot {
            idx: 0,
            adjustments_json: r#"{"exposure":0.0,"contrast":1.0}"#.to_string(),
            description: Some("base".to_string()),
            created_at: 1000,
            source: "history".to_string(),
        };
        let deltas = vec![
            AdjustmentDelta {
                step_index: 0,
                idx: 0,
                adjustment_key: "exposure".to_string(),
                old_value: Some("0.0".to_string()),
                new_value: "0.5".to_string(),
                description: None,
                created_at: 1001,
                source: "history".to_string(),
            },
            AdjustmentDelta {
                step_index: 1,
                idx: 0,
                adjustment_key: "exposure".to_string(),
                old_value: Some("0.5".to_string()),
                new_value: "1.0".to_string(),
                description: None,
                created_at: 1002,
                source: "history".to_string(),
            },
            AdjustmentDelta {
                step_index: 2,
                idx: 0,
                adjustment_key: "contrast".to_string(),
                old_value: Some("1.0".to_string()),
                new_value: "1.2".to_string(),
                description: None,
                created_at: 1003,
                source: "history".to_string(),
            },
        ];

        save_edit_history_in_conn(
            &conn,
            file_id,
            &snapshot,
            &deltas,
            1,
            r#"{"exposure":1.0,"contrast":1.2}"#,
        )
        .unwrap();

        let history = load_edit_history_in_conn(&conn, file_id).unwrap().unwrap();
        assert_eq!(history.snapshot.adjustments_json, snapshot.adjustments_json);
        assert_eq!(history.deltas.len(), 3);
        assert_eq!(history.history_index, 1);

        let (states, active_index) =
            reconstruct_history(&history.snapshot, &history.deltas, history.history_index).unwrap();
        assert_eq!(states.len(), 4);
        assert_eq!(active_index, 1);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&states[0]).unwrap(),
            json!({"exposure":0.0,"contrast":1.0})
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&states[1]).unwrap(),
            json!({"exposure":0.5,"contrast":1.0})
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&states[2]).unwrap(),
            json!({"exposure":1.0,"contrast":1.0})
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&states[3]).unwrap(),
            json!({"exposure":1.0,"contrast":1.2})
        );
    }

    #[test]
    fn test_edit_history_step_label_is_preserved() {
        let (mut conn, folder_id) = setup_conn();
        upsert_files_in_conn(&mut conn, folder_id, &[file_row("/tmp/a.jpg")]).unwrap();
        let file_id: i64 = conn
            .query_row("SELECT id FROM files WHERE path = '/tmp/a.jpg'", [], |r| {
                r.get(0)
            })
            .unwrap();

        let snapshot = AdjustmentSnapshot {
            idx: 0,
            adjustments_json: r#"{"exposure":0.0}"#.to_string(),
            description: Some("base".to_string()),
            created_at: 1000,
            source: "history".to_string(),
        };
        let deltas = vec![AdjustmentDelta {
            step_index: 0,
            idx: 0,
            adjustment_key: "exposure".to_string(),
            old_value: Some("0.0".to_string()),
            new_value: "0.5".to_string(),
            description: Some("after edit".to_string()),
            created_at: 1001,
            source: "history".to_string(),
        }];

        save_edit_history_in_conn(&conn, file_id, &snapshot, &deltas, 1, r#"{"exposure":0.5}"#)
            .unwrap();

        let history = load_edit_history_in_conn(&conn, file_id).unwrap().unwrap();
        let (states, active_index) =
            reconstruct_history(&history.snapshot, &history.deltas, history.history_index).unwrap();
        assert_eq!(states.len(), 2);
        assert_eq!(active_index, 1);

        // Base snapshot label and per-step label must round-trip.
        assert_eq!(history.snapshot.description, Some("base".to_string()));
        assert_eq!(
            history.deltas[0].description,
            Some("after edit".to_string())
        );
    }

    #[test]
    fn test_edit_history_pruning() {
        let (mut conn, folder_id) = setup_conn();
        upsert_files_in_conn(&mut conn, folder_id, &[file_row("/tmp/a.jpg")]).unwrap();
        let file_id: i64 = conn
            .query_row("SELECT id FROM files WHERE path = '/tmp/a.jpg'", [], |r| {
                r.get(0)
            })
            .unwrap();

        let snapshot = AdjustmentSnapshot {
            idx: 0,
            adjustments_json: r#"{"exposure":0.0}"#.to_string(),
            description: None,
            created_at: 0,
            source: "history".to_string(),
        };
        let deltas: Vec<AdjustmentDelta> = (0..105)
            .map(|step| AdjustmentDelta {
                step_index: step,
                idx: 0,
                adjustment_key: "exposure".to_string(),
                old_value: None,
                new_value: format!("{}", step as f64),
                description: None,
                created_at: step,
                source: "history".to_string(),
            })
            .collect();

        save_edit_history_in_conn(
            &conn,
            file_id,
            &snapshot,
            &deltas,
            104,
            r#"{"exposure":104.0}"#,
        )
        .unwrap();

        let history = load_edit_history_in_conn(&conn, file_id).unwrap().unwrap();
        assert_eq!(history.deltas.len(), 100);
        let min_step = history.deltas.iter().map(|d| d.step_index).min().unwrap();
        let max_step = history.deltas.iter().map(|d| d.step_index).max().unwrap();
        assert_eq!(min_step, 5);
        assert_eq!(max_step, 104);
    }

    #[test]
    fn test_edit_history_virtual_copy_isolation() {
        let (mut conn, folder_id) = setup_conn();
        upsert_files_in_conn(
            &mut conn,
            folder_id,
            &[file_row("/tmp/a.jpg"), file_row("/tmp/a.jpg?vc=copy1")],
        )
        .unwrap();
        let base_id: i64 = conn
            .query_row("SELECT id FROM files WHERE path = '/tmp/a.jpg'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let vc_id: i64 = conn
            .query_row(
                "SELECT id FROM files WHERE path = '/tmp/a.jpg?vc=copy1'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        let base_snapshot = AdjustmentSnapshot {
            idx: 0,
            adjustments_json: r#"{"exposure":0.5}"#.to_string(),
            description: None,
            created_at: 0,
            source: "history".to_string(),
        };
        let base_deltas = vec![AdjustmentDelta {
            step_index: 0,
            idx: 0,
            adjustment_key: "exposure".to_string(),
            old_value: None,
            new_value: "0.6".to_string(),
            description: None,
            created_at: 1,
            source: "history".to_string(),
        }];
        save_edit_history_in_conn(
            &conn,
            base_id,
            &base_snapshot,
            &base_deltas,
            0,
            r#"{"exposure":0.6}"#,
        )
        .unwrap();

        let vc_snapshot = AdjustmentSnapshot {
            idx: 0,
            adjustments_json: r#"{"exposure":2.0}"#.to_string(),
            description: None,
            created_at: 0,
            source: "history".to_string(),
        };
        let vc_deltas = vec![AdjustmentDelta {
            step_index: 0,
            idx: 0,
            adjustment_key: "exposure".to_string(),
            old_value: None,
            new_value: "2.5".to_string(),
            description: None,
            created_at: 1,
            source: "history".to_string(),
        }];
        save_edit_history_in_conn(
            &conn,
            vc_id,
            &vc_snapshot,
            &vc_deltas,
            0,
            r#"{"exposure":2.5}"#,
        )
        .unwrap();

        let base_history = load_edit_history_in_conn(&conn, base_id).unwrap().unwrap();
        let vc_history = load_edit_history_in_conn(&conn, vc_id).unwrap().unwrap();

        assert_eq!(
            base_history.snapshot.adjustments_json,
            r#"{"exposure":0.5}"#
        );
        assert_eq!(vc_history.snapshot.adjustments_json, r#"{"exposure":2.0}"#);
    }

    #[test]
    fn test_reconstruct_history_undone_steps() {
        let snapshot = AdjustmentSnapshot {
            idx: 0,
            adjustments_json: r#"{"exposure":0.0}"#.to_string(),
            description: None,
            created_at: 0,
            source: "history".to_string(),
        };
        let deltas: Vec<AdjustmentDelta> = (0..5)
            .map(|step| AdjustmentDelta {
                step_index: step,
                idx: 0,
                adjustment_key: "exposure".to_string(),
                old_value: None,
                new_value: format!("{:.1}", step as f64 + 1.0),
                description: None,
                created_at: step,
                source: "history".to_string(),
            })
            .collect();

        let (states, active_index) = reconstruct_history(&snapshot, &deltas, 2).unwrap();
        assert_eq!(states.len(), 6);
        assert_eq!(active_index, 2);
        // Future states are still present in the returned vector.
        let last: serde_json::Value = serde_json::from_str(&states[5]).unwrap();
        assert_eq!(last, json!({"exposure":5.0}));
    }

    #[test]
    fn test_reconstruct_history_empty_deltas() {
        let snapshot = AdjustmentSnapshot {
            idx: 0,
            adjustments_json: r#"{"exposure":0.0}"#.to_string(),
            description: None,
            created_at: 0,
            source: "history".to_string(),
        };

        let (states, active_index) = reconstruct_history(&snapshot, &[], 0).unwrap();
        assert_eq!(states.len(), 1);
        assert_eq!(active_index, 0);
        let state: serde_json::Value = serde_json::from_str(&states[0]).unwrap();
        assert_eq!(state, json!({"exposure":0.0}));
    }

    #[test]
    fn test_reconstruct_history_clamps_index() {
        let snapshot = AdjustmentSnapshot {
            idx: 0,
            adjustments_json: r#"{"exposure":0.0}"#.to_string(),
            description: None,
            created_at: 0,
            source: "history".to_string(),
        };
        let deltas: Vec<AdjustmentDelta> = (0..3)
            .map(|step| AdjustmentDelta {
                step_index: step,
                idx: 0,
                adjustment_key: "exposure".to_string(),
                old_value: None,
                new_value: format!("{:.1}", step as f64 + 1.0),
                description: None,
                created_at: step,
                source: "history".to_string(),
            })
            .collect();

        // There are 4 states (snapshot + 3 steps); index 99 clamps to 3.
        let (states, active_index) = reconstruct_history(&snapshot, &deltas, 99).unwrap();
        assert_eq!(states.len(), 4);
        assert_eq!(active_index, 3);
    }

    #[test]
    fn test_backup_counter_increments_and_resets() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        let (pending, last, banner) = get_catalog_backup_state_in_conn(&conn).unwrap();
        assert_eq!(pending, 0);
        assert!(last.is_none());
        assert!(banner.is_none());

        increment_backup_counter_in_conn(&conn, 3).unwrap();
        let (pending, _, _) = get_catalog_backup_state_in_conn(&conn).unwrap();
        assert_eq!(pending, 3);

        touch_backup_banner_in_conn(&conn).unwrap();
        let (_, _, banner) = get_catalog_backup_state_in_conn(&conn).unwrap();
        assert!(banner.is_some());

        reset_backup_counter_in_conn(&conn).unwrap();
        let (pending, last, _) = get_catalog_backup_state_in_conn(&conn).unwrap();
        assert_eq!(pending, 0);
        assert!(last.is_some());
    }
}
