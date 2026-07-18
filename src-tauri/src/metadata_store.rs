use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::time::SystemTime;
use tauri::AppHandle;

use crate::formats::is_raw_file;
use crate::image_processing::ImageMetadata;
use crate::library_db;

/// Read full `ImageMetadata` for a file. When the catalog already has metadata,
/// the catalog copy wins. Otherwise the legacy `.rrdata` sidecar is read and
/// imported into the catalog on demand.
pub fn load_image_metadata(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
) -> Result<ImageMetadata, String> {
    let file_id = match file_id {
        Some(id) => id,
        None => match library_db::get_file_id_by_path(app_handle, path)? {
            Some(id) => id,
            None => {
                // Not cataloged — import legacy sidecar if it exists and parses.
                if let Some(legacy) = parse_sidecar_legacy(path) {
                    save_image_metadata(app_handle, None, path, &legacy)?;
                    return Ok(legacy);
                }
                return Ok(ImageMetadata::default());
            }
        },
    };

    if let Some(file_metadata) = library_db::get_file_metadata(app_handle, file_id)?
        && let Some(metadata_modified) = file_metadata.metadata_modified
    {
        // If the sidecar is newer than the catalog, re-import it.
        if let Some(sidecar_mtime) = sidecar_mtime(path)
            && sidecar_mtime > metadata_modified
        {
            let legacy = load_sidecar_legacy(path);
            save_image_metadata(app_handle, Some(file_id), path, &legacy)?;
            return Ok(legacy);
        }
        return parse_db_metadata(app_handle, file_id, &file_metadata);
    }

    // Catalog has no metadata yet — try legacy .rrdata.
    let legacy = load_sidecar_legacy(path);
    save_image_metadata(app_handle, Some(file_id), path, &legacy)?;
    Ok(legacy)
}

fn parse_db_metadata(
    app_handle: &AppHandle,
    file_id: i64,
    file_metadata: &library_db::FileMetadata,
) -> Result<ImageMetadata, String> {
    let adjustments: Value =
        serde_json::from_str(&file_metadata.adjustments_json).map_err(|e| e.to_string())?;
    let exif = file_metadata
        .exif_json
        .as_deref()
        .map(|json| {
            serde_json::from_str::<HashMap<String, String>>(json).map_err(|e| e.to_string())
        })
        .transpose()?;

    let (rating, flag, tags) =
        library_db::get_file_rating_flag_tags(app_handle, file_id)?.unwrap_or((0, 0, Vec::new()));

    Ok(ImageMetadata {
        version: 1,
        rating,
        flag,
        adjustments,
        tags: if tags.is_empty() { None } else { Some(tags) },
        exif,
    })
}

fn sidecar_path(path: &str) -> String {
    let (base_path, vc_id) = match path.split_once("?vc=") {
        Some((base, id)) => (base, Some(id)),
        None => (path, None),
    };
    match vc_id {
        Some(id) => format!("{}.{}.rrdata", base_path, id),
        None => format!("{}.rrdata", base_path),
    }
}

fn sidecar_mtime(path: &str) -> Option<i64> {
    let mtime = std::fs::metadata(sidecar_path(path)).ok()?.modified().ok()?;
    let secs = mtime
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    Some(secs)
}

fn parse_sidecar_legacy(path: &str) -> Option<ImageMetadata> {
    let sidecar = sidecar_path(path);
    let content = std::fs::read_to_string(&sidecar).ok()?;
    serde_json::from_str::<ImageMetadata>(&content).ok()
}

fn load_sidecar_legacy(path: &str) -> ImageMetadata {
    parse_sidecar_legacy(path).unwrap_or_default()
}

/// Persist full `ImageMetadata` to the catalog, stamping `metadata_modified`.
pub fn save_image_metadata(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
    metadata: &ImageMetadata,
) -> Result<(), String> {
    let file_id = resolve_file_id(app_handle, file_id, path)?;
    let adjustments_json =
        serde_json::to_string(&metadata.adjustments).map_err(|e| e.to_string())?;
    let exif_json = metadata
        .exif
        .as_ref()
        .map(|m| serde_json::to_string(m).map_err(|e| e.to_string()))
        .transpose()?;
    library_db::update_file_metadata(app_handle, file_id, &adjustments_json, exif_json.as_deref())?;
    library_db::update_file_rating_flag_tags(
        app_handle,
        file_id,
        metadata.rating,
        metadata.flag,
        metadata.tags.clone(),
    )?;
    Ok(())
}

fn resolve_file_id(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
) -> Result<i64, String> {
    if let Some(id) = file_id {
        return Ok(id);
    }
    if let Some(id) = library_db::get_file_id_by_path(app_handle, path)? {
        return Ok(id);
    }

    // The file is not in the catalog yet; create a minimal stub row so writes
    // have a target. Folder import will flesh out the remaining columns later.
    let path_obj = Path::new(path);
    let folder_path = path_obj
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();
    let folder_id = library_db::upsert_folder(app_handle, &folder_path, false)?;

    let name = path_obj
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string();
    let extension = path_obj
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let file_row = library_db::FileRowInput {
        path: path.to_string(),
        name,
        modified: None,
        size: None,
        sidecar_modified: None,
        extension,
        is_raw: is_raw_file(path),
        is_edited: false,
        is_virtual_copy: path.contains("?vc="),
        is_cloud_placeholder: false,
        rating: 0,
        flag: 0,
        color: None,
        metadata_json: "{}".to_string(),
        tags: Vec::new(),
    };
    library_db::upsert_files(app_handle, folder_id, std::slice::from_ref(&file_row))?;

    library_db::get_file_id_by_path(app_handle, path)?
        .ok_or_else(|| "failed to create catalog row".to_string())
}

/// Read the current adjustments blob from the catalog or the legacy `.rrdata`
/// sidecar. Returns `Value::Null` when neither has data.
pub fn load_adjustments(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
) -> Result<Value, String> {
    let catalog_id = file_id
        .or_else(|| library_db::get_file_id_by_path(app_handle, path).ok().flatten());
    if let Some(file_id) = catalog_id
        && let Some(file_metadata) = library_db::get_file_metadata(app_handle, file_id)?
        && file_metadata.metadata_modified.is_some()
    {
        return serde_json::from_str(&file_metadata.adjustments_json)
            .map_err(|e| e.to_string());
    }
    Ok(load_sidecar_legacy(path).adjustments)
}

/// Apply a deep patch to the current adjustments and persist the result.
pub fn patch_adjustments(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
    patch: Value,
) -> Result<(), String> {
    let mut metadata = load_image_metadata(app_handle, file_id, path)?;
    merge_values(&mut metadata.adjustments, &patch);
    save_image_metadata(app_handle, file_id, path, &metadata)
}

fn merge_values(current: &mut Value, patch: &Value) {
    if let (Some(current_obj), Some(patch_obj)) = (current.as_object_mut(), patch.as_object()) {
        for (key, patch_val) in patch_obj {
            match current_obj.get_mut(key) {
                Some(current_val) if current_val.is_object() && patch_val.is_object() => {
                    merge_values(current_val, patch_val);
                }
                _ => {
                    current_obj.insert(key.clone(), patch_val.clone());
                }
            }
        }
    }
}

pub fn set_rating(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
    rating: u8,
) -> Result<(), String> {
    let file_id = resolve_file_id(app_handle, file_id, path)?;
    let (_, flag, tags) =
        library_db::get_file_rating_flag_tags(app_handle, file_id)?.unwrap_or((0, 0, Vec::new()));
    library_db::update_file_rating_flag_tags(
        app_handle,
        file_id,
        rating,
        flag,
        if tags.is_empty() { None } else { Some(tags) },
    )
}

pub fn set_flag(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
    flag: i8,
) -> Result<(), String> {
    let file_id = resolve_file_id(app_handle, file_id, path)?;
    let (rating, _, tags) =
        library_db::get_file_rating_flag_tags(app_handle, file_id)?.unwrap_or((0, 0, Vec::new()));
    library_db::update_file_rating_flag_tags(
        app_handle,
        file_id,
        rating,
        flag,
        if tags.is_empty() { None } else { Some(tags) },
    )
}

pub fn set_color(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
    color: Option<&str>,
) -> Result<(), String> {
    let file_id = resolve_file_id(app_handle, file_id, path)?;
    library_db::update_file_color(app_handle, file_id, color)
}

pub fn set_tags(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
    tags: &[String],
) -> Result<(), String> {
    let file_id = resolve_file_id(app_handle, file_id, path)?;
    let (rating, flag, _) =
        library_db::get_file_rating_flag_tags(app_handle, file_id)?.unwrap_or((0, 0, Vec::new()));
    library_db::update_file_rating_flag_tags(
        app_handle,
        file_id,
        rating,
        flag,
        if tags.is_empty() {
            None
        } else {
            Some(tags.to_vec())
        },
    )
}

pub fn record_delta(
    _app_handle: &AppHandle,
    _file_id: i64,
    _key: &str,
    _old: Option<&Value>,
    _new: &Value,
    _source: &str,
) {
    // Stub for the next task: insert into file_adjustment_deltas.
}

pub fn take_snapshot(_app_handle: &AppHandle, _file_id: i64, _description: &str, _source: &str) {
    // Stub for the next task: insert into file_adjustment_snapshots.
}
