use std::fs;
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};

use flate2::Compression;
use flate2::write::GzEncoder;
use once_cell::sync::Lazy;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::Mutex as TokioMutex;

use crate::app_settings::{load_settings, save_settings};
use crate::library_db::{
    open_connection, reset_backup_counter_in_conn, touch_backup_banner_in_conn,
};

static BACKUP_LOCK: Lazy<TokioMutex<()>> = Lazy::new(|| TokioMutex::new(()));

struct TempFileGuard<'a> {
    path: &'a Path,
}

impl<'a> Drop for TempFileGuard<'a> {
    fn drop(&mut self) {
        if self.path.exists() {
            let _ = fs::remove_file(self.path);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogBackupState {
    pub pending_count: i64,
    pub last_backup_at: Option<i64>,
    pub last_banner_at: Option<i64>,
    pub destination: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogBackupResult {
    pub path: String,
    pub uncompressed_size: u64,
    pub compressed_size: u64,
}

fn db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(data_dir.join("library.db"))
}

fn timestamp_name() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!(
        "library-backup-{}-{}.db.gz",
        now.as_secs(),
        now.subsec_nanos()
    )
}

fn ensure_destination_dir(dest: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(dest);
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| format!("failed to create backup dir: {}", e))?;
    }
    if !path.is_dir() {
        return Err(format!("backup destination is not a directory: {}", dest));
    }
    Ok(path)
}

fn vacuum_into(source: &Path, target: &Path) -> Result<(), String> {
    let source_str = source.to_str().ok_or("invalid source path")?;
    let target_str = target.to_str().ok_or("invalid target path")?;
    let conn =
        Connection::open(source_str).map_err(|e| format!("failed to open source db: {}", e))?;
    // VACUUM INTO needs the target path as a literal. Parameter binding is not
    // reliably supported across SQLite versions, so quote it safely.
    let escaped = target_str.replace('\'', "''");
    conn.execute(&format!("VACUUM INTO '{}'", escaped), [])
        .map_err(|e| format!("VACUUM INTO failed: {}", e))?;
    Ok(())
}

fn gzip_file(source: &Path, target: &Path) -> Result<u64, String> {
    let input =
        fs::File::open(source).map_err(|e| format!("failed to open uncompressed backup: {}", e))?;
    let output = fs::File::create(target)
        .map_err(|e| format!("failed to create compressed backup: {}", e))?;
    let mut reader = BufReader::new(input);
    let mut encoder = GzEncoder::new(BufWriter::new(output), Compression::default());
    std::io::copy(&mut reader, &mut encoder)
        .map_err(|e| format!("gzip compression failed: {}", e))?;
    let finished = encoder
        .finish()
        .map_err(|e| format!("failed to finalize gzip: {}", e))?;
    let metadata = finished
        .into_inner()
        .map_err(|e| format!("failed to unwrap writer: {}", e))?
        .metadata()
        .map_err(|e| format!("failed to read compressed metadata: {}", e))?;
    Ok(metadata.len())
}

fn rotate_backups(dest_dir: &Path, keep_count: usize) -> Result<(), String> {
    let mut backups: Vec<PathBuf> = fs::read_dir(dest_dir)
        .map_err(|e| format!("failed to read backup dir: {}", e))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("library-backup-") && n.ends_with(".db.gz"))
                .unwrap_or(false)
        })
        .collect();
    backups.sort();
    if backups.len() > keep_count {
        for old in backups.iter().take(backups.len() - keep_count) {
            if let Err(e) = fs::remove_file(old) {
                log::warn!(
                    "[catalog-backup] failed to remove old backup {}: {}",
                    old.display(),
                    e
                );
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_catalog_backup_state(app_handle: AppHandle) -> Result<CatalogBackupState, String> {
    let conn = open_connection(&app_handle)?;
    let (pending_count, last_backup_at, last_banner_at) =
        crate::library_db::get_catalog_backup_state_in_conn(&conn)?;
    let settings = load_settings(app_handle)?;
    Ok(CatalogBackupState {
        pending_count,
        last_backup_at,
        last_banner_at,
        destination: settings.catalog_backup_folder,
    })
}

#[tauri::command]
pub async fn create_catalog_backup(
    destination: Option<String>,
    app_handle: AppHandle,
) -> Result<CatalogBackupResult, String> {
    let _guard = BACKUP_LOCK.lock().await;

    let settings = load_settings(app_handle.clone())?;
    let dest_dir = match destination {
        Some(d) => d,
        None => settings
            .catalog_backup_folder
            .ok_or("backup destination not set")?,
    };
    let dest_path = ensure_destination_dir(&dest_dir)?;

    let source_db = db_path(&app_handle)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let temp_name = format!(
        "library-backup-{}-{}.db.tmp",
        now.as_secs(),
        now.subsec_nanos()
    );
    let temp_path = dest_path.join(&temp_name);
    let final_path = dest_path.join(timestamp_name());

    let _temp_guard = TempFileGuard { path: &temp_path };
    vacuum_into(&source_db, &temp_path)?;
    let uncompressed_size = fs::metadata(&temp_path)
        .map_err(|e| format!("failed to stat temp backup: {}", e))?
        .len();
    let compressed_size = gzip_file(&temp_path, &final_path)?;

    let keep_count = settings.catalog_backup_keep_count.unwrap_or(10) as usize;
    rotate_backups(&dest_path, keep_count)?;

    let conn = open_connection(&app_handle)?;
    reset_backup_counter_in_conn(&conn)?;

    let _ = app_handle.emit("catalog-backup-completed", ());

    Ok(CatalogBackupResult {
        path: final_path.to_string_lossy().to_string(),
        uncompressed_size,
        compressed_size,
    })
}

#[tauri::command]
pub async fn set_catalog_backup_destination(
    path: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    let mut settings = load_settings(app_handle.clone())?;
    settings.catalog_backup_folder = Some(path);
    save_settings(settings, app_handle)?;
    Ok(())
}

#[tauri::command]
pub async fn dismiss_catalog_backup_banner(app_handle: AppHandle) -> Result<(), String> {
    let conn = open_connection(&app_handle)?;
    touch_backup_banner_in_conn(&conn)?;
    Ok(())
}

pub fn should_prompt_before_exit<R: Runtime>(app_handle: &AppHandle<R>) -> Result<bool, String> {
    let conn = open_connection(app_handle)?;
    let (pending, _, _) = crate::library_db::get_catalog_backup_state_in_conn(&conn)?;
    Ok(pending > 0)
}

#[tauri::command]
pub fn cancel_exit_request(app_handle: AppHandle) {
    let state = app_handle.state::<crate::app_state::AppState>();
    if let Ok(mut flag) = state.exit_backup_requested.lock() {
        *flag = false;
    }
}

#[tauri::command]
pub fn confirm_exit() {
    #[cfg(target_os = "macos")]
    unsafe {
        libc::_exit(0);
    }
    #[cfg(not(target_os = "macos"))]
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rotate_backups_keeps_newest() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();

        for i in 1..=5 {
            let name = format!("library-backup-{:04}-0.db.gz", i);
            let path = dir.join(&name);
            fs::write(&path, b"").expect("failed to create test backup file");
        }

        let result = rotate_backups(dir, 3);
        assert!(
            result.is_ok(),
            "rotate_backups returned an error: {:?}",
            result
        );

        let mut remaining: Vec<String> = fs::read_dir(dir)
            .expect("failed to read temp dir")
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().to_string()))
            .collect();
        remaining.sort();

        assert_eq!(
            remaining.len(),
            3,
            "expected 3 backups to remain, got {:?}",
            remaining
        );
        assert_eq!(
            remaining,
            vec![
                "library-backup-0003-0.db.gz".to_string(),
                "library-backup-0004-0.db.gz".to_string(),
                "library-backup-0005-0.db.gz".to_string(),
            ]
        );
    }
}
