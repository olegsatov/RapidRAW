use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CURRENT_SCHEMA_VERSION: i32 = 1;

fn db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
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
    )
    .map_err(|e| e.to_string())?;
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

pub fn upsert_folder(app_handle: &AppHandle, path: &str, recursive: bool) -> Result<i64, String> {
    let conn = open_connection(app_handle)?;
    conn.execute(
        "INSERT INTO folders(path, recursive) VALUES (?1, ?2)
         ON CONFLICT(path, recursive) DO UPDATE SET path=excluded.path",
        params![path, recursive as i32],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
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
}
