use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Datelike;
use filetime::{FileTime, set_file_mtime};
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

fn archive_date_folder_name(
    date_taken: Option<&str>,
    target_root_basename: &str,
    year_offset: i32,
) -> Result<String, String> {
    if let Some(dt) = date_taken {
        if let Ok(parsed) = chrono::NaiveDateTime::parse_from_str(dt, "%Y-%m-%d %H:%M:%S") {
            return Ok(format_date_folder(
                shift_year(parsed.date(), year_offset)?,
                target_root_basename,
            ));
        }
        if let Ok(parsed) = chrono::NaiveDate::parse_from_str(dt, "%Y-%m-%d") {
            return Ok(format_date_folder(
                shift_year(parsed, year_offset)?,
                target_root_basename,
            ));
        }
    }
    Err("No usable date".to_string())
}

fn shift_year(date: chrono::NaiveDate, offset: i32) -> Result<chrono::NaiveDate, String> {
    if offset == 0 {
        return Ok(date);
    }
    let new_year = date.year() + offset as i32;
    if !(1..=9999).contains(&new_year) {
        return Err(format!("shifted year {} out of range", new_year));
    }
    date.with_year(new_year)
        .ok_or_else(|| format!("failed to shift date {} by {} years", date, offset))
}

fn parse_year_from_basename(name: &str) -> Option<i32> {
    if name.len() == 4 && name.chars().all(|c| c.is_ascii_digit()) {
        name.parse().ok()
    } else {
        None
    }
}

fn format_date_folder(date: chrono::NaiveDate, target_root_basename: &str) -> String {
    if parse_year_from_basename(target_root_basename) == Some(date.year()) {
        date.format("%m/%d").to_string()
    } else {
        date.format(DATE_FOLDER_FORMAT).to_string()
    }
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

fn candidate_matches_source(source_meta: &fs::Metadata, dest_meta: &fs::Metadata) -> bool {
    let size_matches = source_meta.len() == dest_meta.len();
    let mtime_matches = source_meta
        .modified()
        .ok()
        .zip(dest_meta.modified().ok())
        .map(|(s, d)| s == d)
        .unwrap_or(false);
    size_matches && mtime_matches
}

fn copy_associated_files(source_image_path: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    let associated = find_all_associated_files(source_image_path)
        .map_err(|e| format!("failed to find associated files: {}", e))?;

    let mut new_image_path: Option<PathBuf> = None;

    for source_file in associated {
        let file_name = source_file
            .file_name()
            .ok_or("missing file name")?
            .to_string_lossy()
            .to_string();
        let candidate = dest_dir.join(&file_name);

        let source_meta = fs::metadata(&source_file)
            .map_err(|e| format!("failed to stat {}: {}", source_file.display(), e))?;

        let (dest_file, copied) = if candidate.exists() {
            match fs::metadata(&candidate) {
                Ok(dest_meta) if candidate_matches_source(&source_meta, &dest_meta) => {
                    log::info!(
                        "[archive] skipping identical file, using existing: {}",
                        candidate.display()
                    );
                    (candidate, false)
                }
                _ => {
                    log::debug!(
                        "[archive] destination exists but differs, renaming: {}",
                        candidate.display()
                    );
                    (resolve_unique_dest_path(dest_dir, &file_name), true)
                }
            }
        } else {
            (candidate, true)
        };

        if copied {
            fs::copy(&source_file, &dest_file)
                .map_err(|e| format!("copy failed for {}: {}", source_file.display(), e))?;

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

            if let Ok(source_mtime) = source_meta.modified() {
                let ft = FileTime::from(source_mtime);
                if let Err(e) = set_file_mtime(&dest_file, ft) {
                    log::warn!(
                        "[archive] failed to preserve mtime for {}: {}",
                        dest_file.display(),
                        e
                    );
                }
            }
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
    year_offset: Option<i32>,
    app_handle: AppHandle<R>,
) -> Result<ArchiveResult, String> {
    let source = normalize_folder_path(&source_path);
    let target = normalize_folder_path(&target_root);
    let year_offset = year_offset.unwrap_or(0);

    if source == target {
        return Err("Source and target folders are the same.".to_string());
    }

    let target_path = PathBuf::from(&target);
    if !target_path.is_dir() {
        return Err(format!("Target is not a folder: {}", target));
    }

    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        log::info!(
            "[archive] starting: source={} target={} year_offset={}",
            source,
            target,
            year_offset
        );
        let files = library_db::get_files_for_archive(&app_handle_clone, &source)?;
        let total = files.len();
        log::info!("[archive] found {} files eligible for archiving", total);

        let _ = app_handle_clone.emit(
            "archive-progress",
            ArchiveProgress {
                current: 0,
                total,
                current_file: None,
            },
        );

        let target_basename = target_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        // Group files by target date folder so we can create each directory once.
        let mut grouped: HashMap<String, Vec<(i64, String, i64)>> = HashMap::new();
        for (file_id, path, date_taken, folder_id) in files {
            let folder_name =
                match archive_date_folder_name(date_taken.as_deref(), target_basename, year_offset)
                {
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
        let mut folder_id_cache: HashMap<String, i64> = HashMap::new();

        for (folder_name, group) in grouped {
            let dest_dir = target_path.join(&folder_name);
            log::info!(
                "[archive] creating/entering folder {} ({} files)",
                dest_dir.display(),
                group.len()
            );
            if let Err(e) = fs::create_dir_all(&dest_dir) {
                log::error!(
                    "[archive] failed to create target dir {}: {}",
                    dest_dir.display(),
                    e
                );
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
                log::info!(
                    "[archive] copying {}/{}: {}",
                    progress + 1,
                    total,
                    source_file_path
                );
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
                        log::info!("[archive] copied to {}", new_image_path.display());
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

                        let tx = conn.transaction().map_err(|e| e.to_string())?;

                        let new_folder_id = match folder_id_cache.get(&new_folder_path) {
                            Some(&id) => id,
                            None => {
                                let id = library_db::upsert_folder_in_conn(
                                    &tx,
                                    &new_folder_path,
                                    false,
                                )?;
                                folder_id_cache.insert(new_folder_path.clone(), id);
                                id
                            }
                        };

                        match library_db::update_file_path_in_conn(
                            &tx,
                            &source_file_path,
                            &new_path_str,
                            new_folder_id,
                            new_modified,
                        ) {
                            Ok(updated) => {
                                tx.commit().map_err(|e| e.to_string())?;
                                log::info!(
                                    "[archive] updated catalog for {} ({} row(s))",
                                    source_file_path,
                                    updated
                                );
                                archived.push(source_file_path);
                            }
                            Err(e) => {
                                let _ = tx.rollback();
                                log::error!(
                                    "[archive] failed to update catalog for {}: {}",
                                    source_file_path,
                                    e
                                );
                                failed.push((source_file_path, e));
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("[archive] failed to copy {}: {}", source_file_path, e);
                        failed.push((source_file_path, e));
                    }
                }

                progress += 1;
            }
        }

        if archived.is_empty() {
            return Err(format!(
                "Archive failed for all files ({} failed). No catalog changes were made.",
                failed.len()
            ));
        }

        log::info!(
            "[archive] finished: {} archived, {} failed",
            archived.len(),
            failed.len()
        );

        let _ = app_handle_clone.emit(
            "archive-progress",
            ArchiveProgress {
                current: total,
                total,
                current_file: None,
            },
        );

        log::info!(
            "[archive] finished: {} archived, {} failed",
            archived.len(),
            failed.len()
        );
        Ok(ArchiveResult { archived, failed })
    })
    .await
    .map_err(|e| {
        log::error!("[archive] blocking task failed: {}", e);
        format!("archive task failed: {}", e)
    })?
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn year_named_root_omits_year_for_matching_date() {
        assert_eq!(
            archive_date_folder_name(Some("2026-01-15"), "2026", 0).unwrap(),
            "01/15"
        );
    }

    #[test]
    fn year_named_root_keeps_year_for_other_years() {
        assert_eq!(
            archive_date_folder_name(Some("2025-12-31"), "2026", 0).unwrap(),
            "2025/2025-12/2025-12-31"
        );
    }

    #[test]
    fn non_year_root_uses_full_date_path() {
        assert_eq!(
            archive_date_folder_name(Some("2026-01-15"), "Archive", 0).unwrap(),
            "2026/2026-01/2026-01-15"
        );
    }

    #[test]
    fn year_offset_shifts_into_root_year() {
        assert_eq!(
            archive_date_folder_name(Some("2025-12-31"), "2026", 1).unwrap(),
            "12/31"
        );
    }

    #[test]
    fn year_offset_shifts_full_path_for_non_year_root() {
        assert_eq!(
            archive_date_folder_name(Some("2025-12-31"), "Archive", 1).unwrap(),
            "2026/2026-12/2026-12-31"
        );
    }

    #[test]
    fn negative_year_offset_works() {
        assert_eq!(
            archive_date_folder_name(Some("2026-01-15"), "2025", -1).unwrap(),
            "01/15"
        );
    }

    #[test]
    fn missing_date_returns_error() {
        assert!(archive_date_folder_name(None, "2026", 0).is_err());
    }
}
