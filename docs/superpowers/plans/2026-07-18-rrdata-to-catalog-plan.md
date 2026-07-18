# Move `.rrdata` contents into the SQLite catalog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SQLite library catalog the single source of truth for image metadata, stop writing `.rrdata`, keep `.rrdata` as a read-only legacy fallback, and prepare schema/infrastructure for per-image edit history.

**Architecture:** Add `adjustments_json`, `metadata_modified`, and `exif_json` to `files`; create `file_adjustment_deltas` and `file_adjustment_snapshots` tables; introduce a `metadata_store` module as the single API for all metadata reads/writes with lazy `.rrdata` fallback; route all existing `.rrdata` read/write sites through this module.

**Tech Stack:** Rust (Tauri 2, rusqlite), React/TypeScript, SQLite.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src-tauri/src/library_db.rs` | Schema migration; CRUD helpers for `adjustments_json`, `metadata_modified`, `exif_json`; history table creation. |
| `src-tauri/src/metadata_store.rs` | New module: single entry point for metadata read/write, lazy `.rrdata` fallback, history hooks. |
| `src-tauri/src/folder_import.rs` | Delta sync fingerprint switches from `sidecar_modified` to `metadata_modified`. |
| `src-tauri/src/file_management.rs` | Editor save, apply/reset/auto adjustments, rating/flag/color, virtual copy, duplicate, import, rename, thumbnail, load_metadata no longer touch `.rrdata`. |
| `src-tauri/src/exif_processing.rs` | `persist_exif_if_missing` and `write_rrexif_sidecar` write EXIF into DB instead of `.rrdata`; `load_sidecar` becomes a legacy helper. |
| `src-tauri/src/tagging.rs` | Tag edits write into DB via `metadata_store`. |
| `src-tauri/src/export_processing.rs` | Reads adjustments from DB. |
| `src-tauri/src/image_loader.rs` | `load_image` reads metadata from DB. |
| `src-tauri/src/lib.rs` | Register any new commands if needed. |

---

## Task 1: Schema migration

**Files:**
- Modify: `src-tauri/src/library_db.rs`

- [ ] **Step 1: Add new columns and tables to `SCHEMA_V1`**

Inside the existing `SCHEMA_V1` const, add the new columns directly into the `files` table `CREATE TABLE`:

```sql
adjustments_json TEXT NOT NULL DEFAULT '{}',
metadata_modified INTEGER,
exif_json TEXT,
```

And add after the `files` table creation:

```sql
CREATE TABLE file_adjustment_deltas (
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

CREATE TABLE file_adjustment_snapshots (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    adjustments_json TEXT NOT NULL,
    source TEXT NOT NULL,
    description TEXT
);

CREATE INDEX idx_deltas_file_created ON file_adjustment_deltas(file_id, created_at);
CREATE INDEX idx_snapshots_file_created ON file_adjustment_snapshots(file_id, created_at);
```

- [ ] **Step 2: Bump schema version and add migration**

Change `CURRENT_SCHEMA_VERSION` from `1` to `2`. Add a new `SCHEMA_V2` const for existing databases:

```sql
ALTER TABLE files ADD COLUMN adjustments_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE files ADD COLUMN metadata_modified INTEGER;
ALTER TABLE files ADD COLUMN exif_json TEXT;

CREATE TABLE file_adjustment_deltas (...);
CREATE TABLE file_adjustment_snapshots (...);
CREATE INDEX idx_deltas_file_created ON file_adjustment_deltas(file_id, created_at);
CREATE INDEX idx_snapshots_file_created ON file_adjustment_snapshots(file_id, created_at);
```

In `migrate()`, if `user_version < 2`, execute `SCHEMA_V2`.

- [ ] **Step 3: Add helper to check/get file metadata columns**

Add `pub fn get_file_metadata(app, file_id) -> Result<Option<(String, Option<i64>, Option<String>)>, String>` that returns `(adjustments_json, metadata_modified, exif_json)`.

- [ ] **Step 4: Add helper to update metadata columns**

Add:

```rust
pub fn update_file_metadata(
    app_handle: &AppHandle,
    file_id: i64,
    adjustments_json: &str,
    exif_json: Option<&str>,
) -> Result<(), String>
```

It sets `metadata_modified = CURRENT_TIMESTAMP` (Unix seconds) and updates `adjustments_json`/`exif_json`.

- [ ] **Step 5: Verify cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes (pre-existing warnings OK).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/library_db.rs
git commit -m "schema: add adjustments_json, metadata_modified, exif_json and history tables"
```

---

## Task 2: `metadata_store` core module

**Files:**
- Create: `src-tauri/src/metadata_store.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create module skeleton and imports**

```rust
use rusqlite::OptionalExtension;
use serde_json::Value;
use std::path::Path;
use tauri::{AppHandle, Manager};

use crate::exif_processing;
use crate::image_processing::ImageMetadata;
use crate::library_db;

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
```

- [ ] **Step 2: Implement `load_image_metadata`**

```rust
pub fn load_image_metadata(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
) -> Result<ImageMetadata, String> {
    let file_id = match file_id {
        Some(id) => id,
        None => match library_db::get_file_id_by_path(app_handle, path)? {
            Some(id) => id,
            None => return load_sidecar_legacy(path),
        },
    };

    if let Some((adj_json, metadata_modified, exif_json)) =
        library_db::get_file_metadata(app_handle, file_id)?
    {
        if metadata_modified.is_some() {
            return parse_db_metadata(&adj_json, exif_json.as_deref());
        }
    }

    // Catalog has no metadata yet — try legacy .rrdata.
    let legacy = load_sidecar_legacy(path)?;
    save_image_metadata(app_handle, Some(file_id), path, &legacy)?;
    Ok(legacy)
}
```

Create small private helpers `parse_db_metadata` and `load_sidecar_legacy` that use existing `exif_processing::load_sidecar`.

- [ ] **Step 3: Implement `save_image_metadata`**

```rust
pub fn save_image_metadata(
    app_handle: &AppHandle,
    file_id: Option<i64>,
    path: &str,
    metadata: &ImageMetadata,
) -> Result<(), String> {
    let file_id = resolve_file_id(app_handle, file_id, path)?;
    let adjustments_json = serde_json::to_string(&metadata.adjustments)
        .map_err(|e| e.to_string())?;
    let exif_json = metadata
        .exif
        .as_ref()
        .map(|m| serde_json::to_string(m).map_err(|e| e.to_string()))
        .transpose()?;
    library_db::update_file_metadata(app_handle, file_id, &adjustments_json, exif_json.as_deref())?;
    library_db::update_file_rating_flag_tags(app_handle, file_id, metadata.rating, metadata.flag, &metadata.tags)?;
    Ok(())
}
```

Add `resolve_file_id` helper that creates a catalog row if needed.

- [ ] **Step 4: Implement field-level setters**

```rust
pub fn set_rating(app_handle: &AppHandle, file_id: Option<i64>, path: &str, rating: u8) -> Result<(), String>
pub fn set_flag(app_handle: &AppHandle, file_id: Option<i64>, path: &str, flag: i8) -> Result<(), String>
pub fn set_color(app_handle: &AppHandle, file_id: Option<i64>, path: &str, color: Option<&str>) -> Result<(), String>
pub fn set_tags(app_handle: &AppHandle, file_id: Option<i64>, path: &str, tags: &[String]) -> Result<(), String>
```

Each resolves `file_id`, updates the relevant catalog columns, and sets `metadata_modified`.

- [ ] **Step 5: Implement history stub hooks**

```rust
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

pub fn take_snapshot(
    _app_handle: &AppHandle,
    _file_id: i64,
    _description: &str,
    _source: &str,
) {
    // Stub for the next task: insert into file_adjustment_snapshots.
}
```

- [ ] **Step 6: Register module in `lib.rs`**

Add `mod metadata_store;` near other module declarations.

- [ ] **Step 7: Verify cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/metadata_store.rs src-tauri/src/lib.rs
git commit -m "feat: add metadata_store module with db read/write and legacy fallback"
```

---

## Task 3: Update `library_db` helpers for rating/flag/tags and metadata columns

**Files:**
- Modify: `src-tauri/src/library_db.rs`

- [ ] **Step 1: Add `update_file_rating_flag_tags`**

```rust
pub fn update_file_rating_flag_tags(
    app_handle: &AppHandle,
    file_id: i64,
    rating: u8,
    flag: i8,
    tags: &Option<Vec<String>>,
) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE files SET rating = ?1, flag = ?2, metadata_modified = ?3 WHERE id = ?4",
        rusqlite::params![rating as i32, flag as i32, now_secs(), file_id],
    ).map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM tags WHERE file_id = ?1", rusqlite::params![file_id])
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
            tx.execute(
                "INSERT INTO tags(file_id, tag, source) VALUES (?1, ?2, ?3)",
                rusqlite::params![file_id, tag_name, source],
            ).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}
```

Helper `now_secs()` returns `i64` Unix timestamp.

- [ ] **Step 2: Add `update_file_metadata` body**

Implement it from Task 1 using a transaction that updates `adjustments_json`, `exif_json`, and `metadata_modified`.

- [ ] **Step 3: Add `get_file_metadata` body**

```rust
pub fn get_file_metadata(
    app_handle: &AppHandle,
    file_id: i64,
) -> Result<Option<(String, Option<i64>, Option<String>)>, String> {
    let conn = open_connection(app_handle)?;
    conn.query_row(
        "SELECT adjustments_json, metadata_modified, exif_json FROM files WHERE id = ?1",
        rusqlite::params![file_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Add tests**

Add unit tests in `library_db::tests`:

```rust
#[test]
fn test_update_file_metadata_stamps_timestamp() { /* ... */ }

#[test]
fn test_update_file_rating_flag_tags() { /* ... */ }
```

- [ ] **Step 5: Verify cargo test**

Run: `cd src-tauri && cargo test --lib library_db::tests`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/library_db.rs
git commit -m "feat: add library_db helpers for metadata columns and tags"
```

---

## Task 4: Delta sync uses `metadata_modified`

**Files:**
- Modify: `src-tauri/src/folder_import.rs`

- [ ] **Step 1: Replace `sidecar_modified` fingerprint**

Find `get_folder_file_fingerprints` and change the returned tuple from `(modified, size, sidecar_modified)` to `(modified, size, metadata_modified)`. Update the SQL:

```rust
"SELECT path, modified, size, metadata_modified FROM files WHERE folder_id = ?1"
```

- [ ] **Step 2: Update delta computation**

In the sync logic, compare disk `(modified, size)` with catalog `(modified, size, metadata_modified)`. Metadata-only changes are detected via `metadata_modified` (set by `metadata_store` on every write).

- [ ] **Step 3: Remove `sidecar_modified` from `FileRowInput`**

Drop the `sidecar_modified` field and its usage in `upsert_files`.

- [ ] **Step 4: Verify cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/folder_import.rs
git commit -m "feat: use metadata_modified instead of sidecar_modified in delta sync"
```

---

## Task 5: Editor write commands use `metadata_store`

**Files:**
- Modify: `src-tauri/src/file_management.rs`

- [ ] **Step 1: Update `save_metadata_and_update_thumbnail`**

Replace the sidecar write with:

```rust
metadata_store::save_image_metadata(app_handle, None, &path_str, &metadata)?;
```

Keep thumbnail invalidation/queue logic unchanged.

- [ ] **Step 2: Update `apply_adjustments_to_paths`**

For each target path, load metadata from `metadata_store`, merge `patch_adjustments` using the same merge logic currently in `apply_adjustments_to_paths`, save back.

```rust
let mut metadata = metadata_store::load_image_metadata(app_handle, None, path)?;
// merge patch into metadata.adjustments (preserve existing merge semantics)
metadata_store::save_image_metadata(app_handle, None, path, &metadata)?;
```

- [ ] **Step 3: Update `reset_adjustments_for_paths`**

Set `metadata.adjustments = serde_json::Value::Object(Default::default())` and save via `metadata_store`.

- [ ] **Step 4: Update `apply_auto_adjustments_to_paths`**

Same pattern: load, apply auto patch, save via `metadata_store`.

- [ ] **Step 5: Verify cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/file_management.rs
git commit -m "feat: route editor save and adjustment commands through metadata_store"
```

---

## Task 6: Rating / flag / color / tag commands use `metadata_store`

**Files:**
- Modify: `src-tauri/src/file_management.rs`, `src-tauri/src/tagging.rs`

- [ ] **Step 1: Update `set_rating_for_paths`**

Replace sidecar read/write with:

```rust
for path in paths {
    metadata_store::set_rating(app_handle, None, &path, rating)?;
}
```

- [ ] **Step 2: Update `set_flag_for_paths`**

Similarly use `metadata_store::set_flag`.

- [ ] **Step 3: Update `set_color_label_for_paths`**

Use `metadata_store::set_color`.

- [ ] **Step 4: Update tag editing in `tagging.rs`**

In `modify_tags_for_path`, `add_tag_for_paths`, `remove_tag_for_paths`:

```rust
let mut metadata = metadata_store::load_image_metadata(app_handle, None, path)?;
// mutate metadata.tags
metadata_store::save_image_metadata(app_handle, None, path, &metadata)?;
```

- [ ] **Step 5: Verify cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/file_management.rs src-tauri/src/tagging.rs
git commit -m "feat: route rating, flag, color, and tag commands through metadata_store"
```

---

## Task 7: EXIF caching writes to DB

**Files:**
- Modify: `src-tauri/src/exif_processing.rs`

- [ ] **Step 1: Update `persist_exif_if_missing`**

After reading EXIF, instead of writing `.rrdata`, call `metadata_store::save_image_metadata` (or a dedicated helper) to store `exif_json` and structured EXIF columns.

- [ ] **Step 2: Update `write_rrexif_sidecar`**

Rename/redirect to write EXIF into `files.exif_json` via `metadata_store` or `library_db::update_file_metadata`. Keep the function signature if many callers use it, but change the body.

- [ ] **Step 3: Update `load_sidecar` legacy behavior**

Keep `load_sidecar` as a private legacy reader used only by `metadata_store`. Ensure it does not rewrite/heal sidecars (no write-back).

- [ ] **Step 4: Verify cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/exif_processing.rs
git commit -m "feat: write cached exif into catalog instead of .rrdata"
```

---

## Task 8: Read paths use `metadata_store`

**Files:**
- Modify: `src-tauri/src/file_management.rs`, `src-tauri/src/image_loader.rs`, `src-tauri/src/export_processing.rs`, `src-tauri/src/film_grain.rs`

- [ ] **Step 1: Update `load_metadata` command**

Return `metadata_store::load_image_metadata(app_handle, None, &path)`.

- [ ] **Step 2: Update `load_image` in `image_loader.rs`**

Replace sidecar load with `metadata_store::load_image_metadata`.

- [ ] **Step 3: Update thumbnail generation**

In `generate_thumbnail_data` and `generate_single_thumbnail_and_cache`, read adjustments via `metadata_store::load_adjustments` or `load_image_metadata`.

- [ ] **Step 4: Update `get_cache_key_hash` / `compute_thumbnail_cache_hash`**

Read adjustments JSON from DB (via `metadata_store::load_adjustments`) instead of sidecar.

- [ ] **Step 5: Update export and film grain**

Replace `load_sidecar` calls with `metadata_store::load_image_metadata`.

- [ ] **Step 6: Verify cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/file_management.rs src-tauri/src/image_loader.rs src-tauri/src/export_processing.rs src-tauri/src/film_grain.rs
git commit -m "feat: read metadata from catalog in load_image, thumbnails, export, and grain"
```

---

## Task 9: Virtual copy, duplicate, import, rename

**Files:**
- Modify: `src-tauri/src/file_management.rs`

- [ ] **Step 1: Update `create_virtual_copy`**

After inserting the VC row into `files`, copy the source image's metadata via `metadata_store::save_image_metadata` for the VC path.

- [ ] **Step 2: Update `duplicate_file`**

Copy metadata through the catalog instead of copying `.rrdata` files.

- [ ] **Step 3: Update `import_files`**

Copy source metadata from DB (if source is cataloged) or read `.rrdata` fallback and save to DB for the destination.

- [ ] **Step 4: Update `rename_files`**

Update catalog `files.path` for the renamed file and any virtual-copy rows; no `.rrdata` rename.

- [ ] **Step 5: Verify cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/file_management.rs
git commit -m "feat: route virtual copy, duplicate, import, and rename through catalog"
```

---

## Task 10: Remove remaining `.rrdata` writes

**Files:**
- Modify: `src-tauri/src/file_management.rs`, `src-tauri/src/exif_processing.rs`, other files

- [ ] **Step 1: Audit all `.rrdata` writes**

Run: `cd src-tauri && grep -Rn "write.*rrdata\|save.*rrdata\|\.rrdata" src/`
Confirm no production code still writes `.rrdata`.

- [ ] **Step 2: Rename or mark legacy helpers**

Rename `save_primary_metadata` to `save_primary_metadata_legacy` if still used by tests, or make it `#[cfg(test)]` only. Keep `load_sidecar` available for the legacy fallback path.

- [ ] **Step 3: Remove `.rrdata` copy/rename/delete logic**

Remove any remaining file-system operations on `.rrdata` in `import_files`, `duplicate_file`, `rename_files`.

- [ ] **Step 4: Verify cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/file_management.rs src-tauri/src/exif_processing.rs
git commit -m "chore: remove remaining .rrdata production writes"
```

---

## Task 11: Frontend command signatures and verification

**Files:**
- Modify: frontend callers if any command signatures changed

- [ ] **Step 1: Check command signatures**

Most commands keep the same invoke names and payloads; only the backend storage changes. If any command now returns a different shape, update `Invokes` enum and frontend types in `AppProperties.tsx`.

- [ ] **Step 2: Run npm run build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/AppProperties.tsx  # if changed
git commit -m "feat: update frontend types for catalog-backed metadata"
```

---

## Task 12: Tests and final verification

**Files:**
- Modify: `src-tauri/src/metadata_store.rs` (add tests), `src-tauri/src/library_db.rs`

- [ ] **Step 1: Add `metadata_store` unit tests**

Add a `#[cfg(test)]` module with tests:

```rust
#[test]
fn test_load_defaults_when_missing() { /* ... */ }

#[test]
fn test_lazy_import_from_rrdata() { /* ... */ }

#[test]
fn test_save_updates_metadata_modified() { /* ... */ }

#[test]
fn test_no_rrdata_write_after_save() { /* ... */ }
```

Use temp directories and `Connection::open_in_memory` where possible.

- [ ] **Step 2: Run full Rust test suite**

Run: `cd src-tauri && cargo test --lib`
Expected: all pass.

- [ ] **Step 3: Run cargo check**

Run: `cd src-tauri && cargo check`
Expected: passes.

- [ ] **Step 4: Run prettier**

Run: `npx prettier --check <changed frontend files>`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/metadata_store.rs
git commit -m "test: add metadata_store unit tests"
```

---

## Verification Gates (run at end)

- `cd src-tauri && cargo check` — must pass.
- `cd src-tauri && cargo test --lib` — must pass.
- `npm run build` — must pass.
- `npx prettier --check <changed files>` — must be clean.
- No `.rrdata` writes remain in production code (`grep -Rn "\.rrdata" src-tauri/src/` should only show legacy read helpers and comments).

---

## Self-Review Checklist

- [ ] Schema covers `adjustments_json`, `metadata_modified`, `exif_json`, deltas, snapshots.
- [ ] `metadata_store` is the single entry point for metadata read/write.
- [ ] Legacy `.rrdata` fallback is lazy and read-only.
- [ ] All write commands route through `metadata_store`.
- [ ] All read commands route through `metadata_store`.
- [ ] Delta sync uses `metadata_modified`.
- [ ] XMP remains untouched as external sidecar.
- [ ] History hooks are stubs ready for the next task.
- [ ] Tests cover core behavior.
