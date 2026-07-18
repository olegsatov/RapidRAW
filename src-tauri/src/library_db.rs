use rusqlite::{Connection, OptionalExtension, params};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

use crate::file_management::ImageFile;

const CURRENT_SCHEMA_VERSION: i32 = 2;

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
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let user_version: i32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if user_version < CURRENT_SCHEMA_VERSION {
        if user_version < 1 {
            conn.execute_batch(SCHEMA_V1).map_err(|e| e.to_string())?;
        } else {
            conn.execute_batch(SCHEMA_V2).map_err(|e| e.to_string())?;
        }
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)
            .map_err(|e| e.to_string())?;
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
    adjustments_json TEXT NOT NULL DEFAULT '{}',
    metadata_modified INTEGER,
    exif_json TEXT,

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

pub fn upsert_folder<R: Runtime>(app_handle: &AppHandle<R>, path: &str, recursive: bool) -> Result<i64, String> {
    let conn = open_connection(app_handle)?;
    upsert_folder_in_conn(&conn, path, recursive)
}

fn upsert_folder_in_conn(conn: &Connection, path: &str, recursive: bool) -> Result<i64, String> {
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
pub fn get_file_id_by_path<R: Runtime>(app_handle: &AppHandle<R>, file_path: &str) -> Result<Option<i64>, String> {
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
    let conn = open_connection(app_handle)?;
    conn.execute(
        "UPDATE files SET color = ?1, metadata_modified = ?2 WHERE id = ?3",
        params![color, now_secs(), file_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns `(id, path)` for every catalog row in `folder_id`, real files and
/// virtual copies alike. Thumbnails are per row, not per source file: each
/// virtual copy has its own sidecar (adjustments) and gets its own
/// file_id-keyed cache entry — matching the frontend, which requests
/// thumbnails per (virtual) path.
pub fn get_all_file_paths(
    app_handle: &AppHandle,
    folder_id: i64,
) -> Result<Vec<(i64, String)>, String> {
    let conn = open_connection(app_handle)?;
    get_all_file_paths_in_conn(&conn, folder_id)
}

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

/// Loads one page of a folder's cataloged files as fully-populated
/// `ImageFile`s by deserializing each row's `metadata_json` (which the EXIF
/// phase has already merged `exif` into). Rows are ordered by `name`
/// (case-insensitive via the column's COLLATE NOCASE) with the row id as a
/// tiebreaker — virtual-copy rows share the base row's `name` — so paging is
/// deterministic. A row whose `metadata_json` fails to deserialize is skipped
/// with a log line: one corrupt row must not blank the whole folder listing.
pub fn load_folder_files(
    app_handle: &AppHandle,
    path: &str,
    recursive: bool,
    offset: usize,
    limit: usize,
) -> Result<Vec<ImageFile>, String> {
    let conn = open_connection(app_handle)?;
    load_folder_files_in_conn(&conn, path, recursive, offset, limit)
}

fn load_folder_files_in_conn(
    conn: &Connection,
    path: &str,
    recursive: bool,
    offset: usize,
    limit: usize,
) -> Result<Vec<ImageFile>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT f.metadata_json FROM files f
             JOIN folders fo ON fo.id = f.folder_id
             WHERE fo.path = ?1 AND fo.recursive = ?2
             ORDER BY f.name, f.id
             LIMIT ?3 OFFSET ?4",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![path, recursive as i32, limit as i64, offset as i64],
            |row| row.get::<_, String>(0),
        )
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

    // Virtual copies share the source file's EXIF. `instr(...) = 1` is an
    // exact prefix match, unlike LIKE which would treat `%`/`_` in paths as
    // wildcards.
    let vc_prefix = format!("{}?vc=", source_path);
    let vc_rows: Vec<(i64, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, metadata_json FROM files WHERE instr(path, ?1) = 1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![vc_prefix], |row| Ok((row.get(0)?, row.get(1)?)))
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
    .map(|v| v.map(|ts| ts as u64))
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        upsert_files_in_conn(&mut conn, folder_id, std::slice::from_ref(&sample_file()))
            .unwrap();
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
        upsert_files_in_conn(&mut conn, folder_id, std::slice::from_ref(&sample_file()))
            .unwrap();
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
        let page1 = load_folder_files_in_conn(&conn, "/tmp/x", false, 0, 2).unwrap();
        let page2 = load_folder_files_in_conn(&conn, "/tmp/x", false, 2, 2).unwrap();
        let page3 = load_folder_files_in_conn(&conn, "/tmp/x", false, 4, 2).unwrap();
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

        // The recursive variant of the same path is a different folder.
        assert!(
            load_folder_files_in_conn(&conn, "/tmp/x", true, 0, 10)
                .unwrap()
                .is_empty()
        );
    }
}
