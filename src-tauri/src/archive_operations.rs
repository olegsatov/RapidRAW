use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

use crate::file_management::find_all_associated_files;
use crate::library_db::{self, open_connection};

const DATE_FOLDER_FORMAT: &str = "%Y/%Y-%m/%Y-%m-%d";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveProgress {
    pub current: usize,
    pub total: usize,
    pub current_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveResult {
    pub archived: Vec<String>,
    pub failed: Vec<(String, String)>,
}

fn normalize_folder_path(path: &str) -> String {
    path.trim_end_matches(|c| c == '/' || c == '\\')
        .replace('\\', "/")
}

fn parse_date_to_folder_name(date_taken: Option<&str>) -> Result<String, String> {
    if let Some(dt) = date_taken {
        if let Ok(parsed) = chrono::NaiveDateTime::parse_from_str(dt, "%Y-%m-%d %H:%M:%S") {
            return Ok(parsed.format(DATE_FOLDER_FORMAT).to_string());
        }
        if let Ok(parsed) = chrono::NaiveDate::parse_from_str(dt, "%Y-%m-%d") {
            return Ok(parsed.format(DATE_FOLDER_FORMAT).to_string());
        }
    }
    Err("No usable date".to_string())
}

fn resolve_unique_dest_path(dest_dir: &Path, file_name: &str) -> PathBuf {
    let mut dest = dest_dir.join(file_name);
    if !dest.exists() {
        return dest;
    }

    let stem = Path::new(file_name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let extension = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();

    for counter in 1.. {
        let new_name = if extension.is_empty() {
            format!("{}_{}", stem, counter)
        } else {
            format!("{}_{}.{}", stem, counter, extension)
        };
        dest = dest_dir.join(&new_name);
        if !dest.exists() {
            return dest;
        }
    }

    unreachable!()
}

fn copy_associated_files(
    source_image_path: &Path,
    dest_dir: &Path,
) -> Result<PathBuf, String> {
    let associated = find_all_associated_files(source_image_path)
        .map_err(|e| format!("failed to find associated files: {}", e))?;

    let mut new_image_path: Option<PathBuf> = None;

    for source_file in associated {
        let file_name = source_file
            .file_name()
            .ok_or("missing file name")?
            .to_string_lossy()
            .to_string();
        let dest_file = resolve_unique_dest_path(dest_dir, &file_name);

        fs::copy(&source_file, &dest_file)
            .map_err(|e| format!("copy failed for {}: {}", source_file.display(), e))?;

        let source_meta = fs::metadata(&source_file)
            .map_err(|e| format!("failed to stat {}: {}", source_file.display(), e))?;
        let dest_meta = fs::metadata(&dest_file)
            .map_err(|e| format!("failed to stat {}: {}", dest_file.display(), e))?;

        if source_meta.len() != dest_meta.len() {
            let _ = fs::remove_file(&dest_file);
            return Err(format!(
                "size mismatch after copy: {} vs {}",
                source_meta.len(),
                dest_meta.len()
            ));
        }

        if source_file == source_image_path {
            new_image_path = Some(dest_file);
        }
    }

    new_image_path.ok_or_else(|| "primary image path not copied".to_string())
}

#[tauri::command]
pub async fn archive_folder_to<R: Runtime>(
    source_path: String,
    target_root: String,
    app_handle: AppHandle<R>,
) -> Result<ArchiveResult, String> {
    let source = normalize_folder_path(&source_path);
    let target = normalize_folder_path(&target_root);

    if source == target {
        return Err("Source and target folders are the same.".to_string());
    }

    let target_path = PathBuf::from(&target);
    if !target_path.is_dir() {
        return Err(format!("Target is not a folder: {}", target));
    }

    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
            let files = library_db::get_files_for_archive(&app_handle_clone, &source)?;
            let total = files.len();

            let _ = app_handle_clone.emit(
                "archive-progress",
                ArchiveProgress {
                    current: 0,
                    total,
                    current_file: None,
                },
            );

            // Group files by target date folder so we can create each directory once.
            let mut grouped: HashMap<String, Vec<(i64, String, i64)>> = HashMap::new();
            for (file_id, path, date_taken, folder_id) in files {
                let folder_name = match parse_date_to_folder_name(date_taken.as_deref()) {
                    Ok(name) => name,
                    Err(_) => {
                        log::warn!("[archive] skipping file without usable date: {}", path);
                        continue;
                    }
                };
                grouped
                    .entry(folder_name)
                    .or_default()
                    .push((file_id, path, folder_id));
            }

            let mut archived: Vec<String> = Vec::new();
            let mut failed: Vec<(String, String)> = Vec::new();
            let mut progress = 0;

            let mut conn = open_connection(&app_handle_clone)?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;

            for (folder_name, group) in grouped {
                let dest_dir = target_path.join(&folder_name);
                if let Err(e) = fs::create_dir_all(&dest_dir) {
                    for (_, path, _) in group {
                        failed.push((path, format!("failed to create target dir: {}", e)));
                        progress += 1;
                    }
                    continue;
                }

                for (_file_id, source_file_path, _old_folder_id) in group {
                    let source_path_obj = PathBuf::from(&source_file_path);
                    let emit_name = source_path_obj
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    let _ = app_handle_clone.emit(
                        "archive-progress",
                        ArchiveProgress {
                            current: progress,
                            total,
                            current_file: Some(emit_name),
                        },
                    );

                    match copy_associated_files(&source_path_obj, &dest_dir) {
                        Ok(new_image_path) => {
                            let new_path_str = new_image_path
                                .to_str()
                                .ok_or_else(|| "invalid target path".to_string())?
                                .to_string();
                            let new_folder_path = new_image_path
                                .parent()
                                .ok_or_else(|| "missing parent dir".to_string())?
                                .to_string_lossy()
                                .to_string();
                            let new_modified = fs::metadata(&new_image_path)
                                .ok()
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| {
                                    t.duration_since(std::time::UNIX_EPOCH)
                                        .ok()
                                        .map(|d| d.as_secs() as i64)
                                });

                            let new_folder_id =
                                library_db::upsert_folder(&app_handle_clone, &new_folder_path, false)?;

                            if let Err(e) = library_db::update_file_path_in_conn(
                                &tx,
                                &source_file_path,
                                &new_path_str,
                                new_folder_id,
                                new_modified,
                            ) {
                                failed.push((source_file_path.clone(), e));
                            } else {
                                archived.push(source_file_path);
                            }
                        }
                        Err(e) => {
                            failed.push((source_file_path, e));
                        }
                    }

                    progress += 1;
                }
            }

            if archived.is_empty() {
                tx.rollback().map_err(|e| e.to_string())?;
                return Err(format!(
                    "Archive failed for all files ({} failed). No catalog changes were made.",
                    failed.len()
                ));
            }

            tx.commit().map_err(|e| e.to_string())?;

            let _ = app_handle_clone.emit(
                "archive-progress",
                ArchiveProgress {
                    current: total,
                    total,
                    current_file: None,
                },
            );

            Ok(ArchiveResult { archived, failed })
        })
        .await
        .map_err(|e| format!("archive task failed: {}", e))?
}

#[tauri::command]
pub fn delete_archived_sources(paths: Vec<String>) -> Result<Vec<(String, String)>, String> {
    let mut failures: Vec<(String, String)> = Vec::new();

    for path in paths {
        if let Err(e) = fs::remove_file(&path) {
            failures.push((path, e.to_string()));
        }
    }

    Ok(failures)
}
