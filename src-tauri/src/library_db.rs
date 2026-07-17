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
                    exif_scanned=CASE
                        WHEN files.modified IS NOT excluded.modified
                          OR files.size IS NOT excluded.size
                        THEN 0 ELSE files.exif_scanned END,
                    metadata_json=excluded.metadata_json
                 RETURNING id",
                params![
                    folder_id,
                    &f.path,
                    &f.name,
                    f.modified.map(|v| v as i64),
                    f.size.map(|v| v as i64),
                    f.sidecar_modified.map(|v| v as i64),
                    &f.extension,
                    f.is_raw as i32,
                    f.is_edited as i32,
                    f.is_virtual_copy as i32,
                    f.is_cloud_placeholder as i32,
                    f.rating as i32,
                    f.flag as i32,
                    &f.color,
                    0i32,
                    &f.metadata_json
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
            sidecar_modified: Some(90),
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
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
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
            .query_row("SELECT id FROM files WHERE path = '/tmp/x/a.jpg'", [], |r| {
                r.get(0)
            })
            .unwrap();

        // Simulate the EXIF phase having processed this file.
        conn.execute("UPDATE files SET exif_scanned = 1 WHERE id = ?1", params![file_id])
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
        conn.execute("UPDATE files SET exif_scanned = 1", []).unwrap();

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
}
