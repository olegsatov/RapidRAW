use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, Runtime};

use crate::formats::is_raw_file;
use crate::image_processing::ImageMetadata;
use crate::library_db;

/// Read full `ImageMetadata` for a file from the catalog. Legacy `.rrdata`
/// sidecars are no longer read at runtime; migration into the catalog is the
/// responsibility of the import/sync flow.
pub fn load_image_metadata<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: Option<i64>,
    path: &str,
) -> Result<ImageMetadata, String> {
    log::debug!(
        "[metadata] load_image_metadata file_id={:?} path={}",
        file_id,
        path
    );
    let file_id = match file_id {
        Some(id) => id,
        None => match library_db::get_file_id_by_path(app_handle, path)? {
            Some(id) => id,
            None => return Ok(ImageMetadata::default()),
        },
    };

    if let Some(file_metadata) = library_db::get_file_metadata(app_handle, file_id)? {
        return parse_db_metadata(app_handle, file_id, &file_metadata);
    }

    Ok(ImageMetadata::default())
}

fn inject_dodge_burn_masks(
    adjustments: &mut Value,
    masks: &HashMap<String, String>,
    migrated: &mut Vec<(String, String)>,
) {
    fn inject_submasks(
        submasks: Option<&mut Vec<Value>>,
        masks: &HashMap<String, String>,
        migrated: &mut Vec<(String, String)>,
    ) {
        let Some(arr) = submasks else { return };
        for submask in arr {
            let id = submask.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let mask_type = submask.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if mask_type != "dodge-burn" {
                continue;
            }
            let inline_bitmap = submask
                .get("parameters")
                .and_then(|p| p.get("maskBitmap"))
                .and_then(|v| v.as_str());
            if let Some(data_url) = inline_bitmap.filter(|s| !s.is_empty()) {
                // Migrate legacy inline bitmaps to the dedicated table on first read.
                if !masks.contains_key(id) {
                    migrated.push((id.to_string(), data_url.to_string()));
                }
            }
            let needs_bitmap = inline_bitmap.map(|v| v.is_empty()).unwrap_or(true);
            if !needs_bitmap {
                continue;
            }
            if let Some(data_url) = masks.get(id) {
                if let Some(params) = submask.get_mut("parameters").and_then(|p| p.as_object_mut()) {
                    params.insert("maskBitmap".to_string(), Value::String(data_url.clone()));
                }
            }
        }
    }

    if let Some(containers) = adjustments.get_mut("masks").and_then(|v| v.as_array_mut()) {
        for container in containers {
            inject_submasks(container.get_mut("subMasks").and_then(|v| v.as_array_mut()), masks, migrated);
        }
    }
    if let Some(patches) = adjustments.get_mut("aiPatches").and_then(|v| v.as_array_mut()) {
        for patch in patches {
            inject_submasks(patch.get_mut("subMasks").and_then(|v| v.as_array_mut()), masks, migrated);
        }
    }
}

fn parse_db_metadata<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: i64,
    file_metadata: &library_db::FileMetadata,
) -> Result<ImageMetadata, String> {
    let mut adjustments: Value =
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

    // Restore dodge/burn mask bitmaps from their dedicated table. They are kept
    // out of the adjustments JSON so metadata saves stay small and fast.
    let masks = library_db::load_dodge_burn_masks(app_handle, file_id).unwrap_or_default();
    let mut migrated = Vec::new();
    inject_dodge_burn_masks(&mut adjustments, &masks, &mut migrated);
    for (sub_mask_id, data_url) in migrated {
        if let Err(e) = library_db::save_dodge_burn_mask(app_handle, file_id, &sub_mask_id, &data_url) {
            log::warn!(
                "[metadata] failed to migrate inline dodge/burn mask {} for file_id {}: {}",
                sub_mask_id,
                file_id,
                e
            );
        }
    }

    Ok(ImageMetadata {
        version: 1,
        rating,
        flag,
        adjustments,
        tags: if tags.is_empty() { None } else { Some(tags) },
        exif,
    })
}

/// Persist full `ImageMetadata` to the catalog, stamping `metadata_modified`.
pub fn save_image_metadata<R: Runtime>(
    app_handle: &AppHandle<R>,
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

    let mut conn = library_db::open_connection(app_handle)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    library_db::update_file_metadata_in_conn(
        &tx,
        file_id,
        &adjustments_json,
        exif_json.as_deref(),
    )?;
    library_db::update_file_rating_flag_tags_in_conn(
        &tx,
        file_id,
        metadata.rating,
        metadata.flag,
        metadata.tags.as_deref(),
    )?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn resolve_file_id<R: Runtime>(
    app_handle: &AppHandle<R>,
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
    // Virtual-copy paths carry a `?vc=<id>` query suffix; strip it before
    // deriving file-level attributes, but keep the full path in the catalog.
    let base_path = path
        .split_once("?vc=")
        .map(|(base, _)| base)
        .unwrap_or(path);
    let path_obj = Path::new(base_path);
    let folder_path = path_obj
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();
    let folder_id = library_db::upsert_folder(app_handle, &folder_path, false)?;

    let name = path_obj
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(base_path)
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
        extension,
        is_raw: is_raw_file(base_path),
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
pub fn load_adjustments<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: Option<i64>,
    path: &str,
) -> Result<Value, String> {
    Ok(load_image_metadata(app_handle, file_id, path)?.adjustments)
}

/// Apply a deep patch to the current adjustments and persist the result.
pub fn patch_adjustments<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: Option<i64>,
    path: &str,
    patch: Value,
) -> Result<(), String> {
    let mut metadata = load_image_metadata(app_handle, file_id, path)?;
    merge_values(&mut metadata.adjustments, &patch);
    save_image_metadata(app_handle, file_id, path, &metadata)
}

fn merge_values(current: &mut Value, patch: &Value) {
    if current.is_null() && patch.is_object() {
        *current = patch.clone();
        return;
    }
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

pub fn set_rating<R: Runtime>(
    app_handle: &AppHandle<R>,
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

pub fn set_flag<R: Runtime>(
    app_handle: &AppHandle<R>,
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

pub fn set_color<R: Runtime>(
    app_handle: &AppHandle<R>,
    file_id: Option<i64>,
    path: &str,
    color: Option<&str>,
) -> Result<(), String> {
    let file_id = resolve_file_id(app_handle, file_id, path)?;
    library_db::update_file_color(app_handle, file_id, color)
}

pub fn set_tags<R: Runtime>(
    app_handle: &AppHandle<R>,
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
    // Phase 2 persists history through save_edit_history; this hook is reserved
    // for future internal callers that want to record a single delta directly.
}

pub fn take_snapshot(_app_handle: &AppHandle, _file_id: i64, _description: &str, _source: &str) {
    // Phase 2 persists history through save_edit_history; this hook is reserved
    // for future internal callers that want to capture a snapshot directly.
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{Connection, OptionalExtension};
    use serde_json::json;
    use std::path::PathBuf;
    use tauri::{Manager, test::mock_app};

    fn app_data_db_path<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
        app_handle.path().app_data_dir().unwrap().join("library.db")
    }

    fn metadata_modified_for_path(path: &str, db_path: &std::path::Path) -> Option<i64> {
        let conn = Connection::open(db_path).unwrap();
        conn.query_row(
            "SELECT metadata_modified FROM files WHERE path = ?1",
            [path],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()
        .unwrap()
        .flatten()
    }

    #[test]
    fn test_load_defaults_when_missing() {
        let app = mock_app();
        let handle = app.app_handle();
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("a.jpg");
        let path_str = path.to_str().unwrap();

        let meta = load_image_metadata(handle, None, path_str).unwrap();
        assert_eq!(meta.version, 1);
        assert_eq!(meta.rating, 0);
        assert_eq!(meta.flag, 0);
        assert_eq!(meta.adjustments, Value::Null);
        assert_eq!(meta.tags, None);
        assert_eq!(meta.exif, None);
    }

    #[test]
    fn test_no_rrdata_import_at_runtime() {
        let app = mock_app();
        let handle = app.app_handle();
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("a.jpg");
        let path_str = path.to_str().unwrap();
        let sidecar = format!("{}.rrdata", path_str);

        let legacy = ImageMetadata {
            version: 1,
            rating: 4,
            flag: 1,
            adjustments: json!({"exposure": 0.5}),
            tags: Some(vec!["trip".to_string()]),
            exif: None,
        };
        std::fs::write(&sidecar, serde_json::to_string(&legacy).unwrap()).unwrap();

        let meta = load_image_metadata(handle, None, path_str).unwrap();
        assert_eq!(
            meta.rating, 0,
            "runtime load should not import legacy rrdata"
        );
        assert_eq!(meta.adjustments, Value::Null);
    }

    #[test]
    fn test_save_updates_metadata_modified() {
        let app = mock_app();
        let handle = app.app_handle();
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("a.jpg");
        let path_str = path.to_str().unwrap();

        let meta = ImageMetadata {
            version: 1,
            rating: 2,
            flag: 0,
            adjustments: json!({"contrast": 1.1}),
            tags: None,
            exif: None,
        };
        save_image_metadata(handle, None, path_str, &meta).unwrap();

        let db_path = app_data_db_path(handle);
        let modified = metadata_modified_for_path(path_str, &db_path);
        assert!(
            modified.unwrap() > 0,
            "metadata_modified should be set after save"
        );
    }

    #[test]
    fn test_no_rrdata_write_after_save() {
        let app = mock_app();
        let handle = app.app_handle();
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("a.jpg");
        let path_str = path.to_str().unwrap();
        let sidecar = format!("{}.rrdata", path_str);

        let meta = ImageMetadata {
            version: 1,
            rating: 0,
            flag: 0,
            adjustments: json!({}),
            tags: None,
            exif: None,
        };
        save_image_metadata(handle, None, path_str, &meta).unwrap();

        assert!(
            !std::path::Path::new(&sidecar).exists(),
            "save should not write .rrdata"
        );
    }

    #[test]
    fn test_virtual_copy_metadata() {
        let app = mock_app();
        let handle = app.app_handle();
        let temp = tempfile::tempdir().unwrap();
        let base_path = temp.path().join("a.jpg");
        let base_str = base_path.to_str().unwrap();
        let vc_path = format!("{}?vc=copy1", base_str);

        let base_meta = ImageMetadata {
            version: 1,
            rating: 3,
            flag: 0,
            adjustments: json!({"base": true}),
            tags: Some(vec!["base-tag".to_string()]),
            exif: None,
        };
        save_image_metadata(handle, None, base_str, &base_meta).unwrap();

        let vc_meta = ImageMetadata {
            version: 1,
            rating: 5,
            flag: -1,
            adjustments: json!({"vc": true}),
            tags: Some(vec!["vc-tag".to_string()]),
            exif: None,
        };
        save_image_metadata(handle, None, &vc_path, &vc_meta).unwrap();

        let loaded_base = load_image_metadata(handle, None, base_str).unwrap();
        let loaded_vc = load_image_metadata(handle, None, &vc_path).unwrap();

        assert_eq!(loaded_base.rating, 3);
        assert_eq!(loaded_base.adjustments, json!({"base": true}));
        assert_eq!(loaded_base.tags, Some(vec!["base-tag".to_string()]));

        assert_eq!(loaded_vc.rating, 5);
        assert_eq!(loaded_vc.flag, -1);
        assert_eq!(loaded_vc.adjustments, json!({"vc": true}));
        assert_eq!(loaded_vc.tags, Some(vec!["vc-tag".to_string()]));
    }
}
