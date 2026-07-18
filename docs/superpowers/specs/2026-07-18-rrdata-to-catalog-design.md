# Design: Move `.rrdata` contents into the SQLite catalog

## Goal

Make the SQLite library catalog the single source of truth for all image metadata that currently lives in `.rrdata` sidecar files. After this change:

- Nothing writes `.rrdata` anymore.
- Existing `.rrdata` files become a read-only legacy fallback: when a photo is opened, if the catalog has no metadata or the sidecar is newer, its contents are imported into the catalog once.
- XMP sidecars remain the supported external/interchange format.
- The schema is ready for the next separate task: Lightroom-style per-image edit history (deltas for step undo + full snapshots).

## Background

`.rrdata` is a JSON sidecar next to the source image that stores the `ImageMetadata` struct:

```rust
pub struct ImageMetadata {
    pub version: u32,
    pub rating: u8,
    pub flag: i8,
    pub adjustments: Value,           // opaque blob of every edit
    pub tags: Option<Vec<String>>,
    pub exif: Option<HashMap<String, String>>,
}
```

Today it is read and written from many places: editor auto-save, rating/flag/color commands, tag editing, virtual-copy creation, export, thumbnail generation, EXIF caching, etc. The new catalog (`library_db.rs`) already stores `rating`, `flag`, color label, tags, structured EXIF columns, and a serialized `ImageFile` in `metadata_json`, but it does **not** store the opaque `adjustments` blob.

## Schema changes

### `files` table

Add hot-path columns so the most common metadata reads need no joins:

```sql
ALTER TABLE files ADD COLUMN adjustments_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE files ADD COLUMN metadata_modified INTEGER;
ALTER TABLE files ADD COLUMN exif_json TEXT;
```

- `adjustments_json` — current full `adjustments` blob.
- `metadata_modified` — Unix timestamp of the last metadata write. Used for conflict resolution against legacy `.rrdata` and for delta-sync fingerprinting.
- `exif_json` — full formatted EXIF map as JSON, complementing the existing structured columns.

Existing columns (`rating`, `flag`, `color`, `is_edited`, etc.) continue to be authoritative for listing/sorting/filtering. `metadata_json` keeps storing the serialized `ImageFile` used by `load_folder_files`.

### History infrastructure (stub for the next task)

Two tables support the upcoming edit-history feature:

```sql
CREATE TABLE file_adjustment_deltas (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    adjustment_key TEXT NOT NULL,      -- e.g. "global.exposure"
    old_value TEXT,                    -- JSON value before
    new_value TEXT NOT NULL,           -- JSON value after
    source TEXT NOT NULL,              -- 'user', 'auto', 'paste', 'reset'
    description TEXT,
    is_undone INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE file_adjustment_snapshots (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    adjustments_json TEXT NOT NULL,    -- full adjustments state
    source TEXT NOT NULL,
    description TEXT
);

CREATE INDEX idx_deltas_file_created ON file_adjustment_deltas(file_id, created_at);
CREATE INDEX idx_snapshots_file_created ON file_adjustment_snapshots(file_id, created_at);
```

For the current task these tables are created but only used through stub hooks in `metadata_store`. The next task will implement delta recording, undo navigation, and snapshot management.

## Metadata store API

New module: `src-tauri/src/metadata_store.rs`. It is the single entry point for all metadata read/write after this change.

```rust
/// Read full ImageMetadata for a file. Falls back to legacy .rrdata if the
/// catalog has no entry or the sidecar is newer. Imports the sidecar into the
/// catalog when used.
pub fn load_image_metadata(
    app: &AppHandle,
    file_id: Option<i64>,
    path: &str,
) -> Result<ImageMetadata, String>;

/// Read only the adjustments blob.
pub fn load_adjustments(
    app: &AppHandle,
    file_id: Option<i64>,
    path: &str,
) -> Result<Value, String>;

/// Replace full metadata. Updates metadata_modified and triggers history hooks.
pub fn save_image_metadata(
    app: &AppHandle,
    file_id: Option<i64>,
    path: &str,
    metadata: &ImageMetadata,
) -> Result<(), String>;

/// Patch a subset of adjustments (merge/overwrite semantics depend on patch).
pub fn patch_adjustments(
    app: &AppHandle,
    file_id: Option<i64>,
    path: &str,
    patch: Value,
) -> Result<(), String>;

/// Individual field updates.
pub fn set_rating(app: &AppHandle, file_id: Option<i64>, path: &str, rating: u8) -> Result<(), String>;
pub fn set_flag(app: &AppHandle, file_id: Option<i64>, path: &str, flag: i8) -> Result<(), String>;
pub fn set_color(app: &AppHandle, file_id: Option<i64>, path: &str, color: Option<&str>) -> Result<(), String>;
pub fn set_tags(app: &AppHandle, file_id: Option<i64>, path: &str, tags: &[String]) -> Result<(), String>;

/// History hooks (stubs for the next task).
pub fn record_delta(
    app: &AppHandle,
    file_id: i64,
    key: &str,
    old: Option<&Value>,
    new: &Value,
    source: &str,
);
pub fn take_snapshot(
    app: &AppHandle,
    file_id: i64,
    description: &str,
    source: &str,
);
```

- `file_id` is preferred when known. If `None`, the store looks up the file by path and creates/upserts a catalog row when necessary.
- All writes update `files.metadata_modified`.
- All writes route through this module; no other code writes `.rrdata`.

## Migration / legacy fallback

No global migration. When `load_image_metadata` is called:

1. If `file_id` is known and `files.metadata_modified IS NOT NULL`, return catalog data.
2. Else look for `<path>.rrdata` (and virtual-copy sidecars `.<vcid>.rrdata`).
3. If the sidecar exists and either the catalog has no metadata row or `sidecar_mtime > files.metadata_modified`, parse the sidecar and save it into the catalog.
4. If no sidecar exists, return default `ImageMetadata` and optionally create a default catalog row.

`.rrdata` is never written after this change. Existing files stay on disk as a safety net but are not updated.

## Write path integration

Replace every `.rrdata` write with a call through `metadata_store`. Affected commands and functions include:

- `save_metadata_and_update_thumbnail` → `metadata_store::save_image_metadata`
- `apply_adjustments_to_paths` → `metadata_store::patch_adjustments` (or `save_image_metadata`)
- `reset_adjustments_for_paths` → `metadata_store::patch_adjustments` with `{}`
- `apply_auto_adjustments_to_paths` → `metadata_store::patch_adjustments`
- `set_rating_for_paths` / `set_flag_for_paths` / `set_color_label_for_paths` → corresponding `metadata_store::set_*`
- Tag editing in `tagging.rs` → `metadata_store::set_tags`
- `create_virtual_copy` → `metadata_store::save_image_metadata` for the new virtual-copy row
- `update_exif_fields` → update `files.exif_json` and structured columns
- `persist_exif_if_missing` / `write_rrexif_sidecar` → write EXIF into `files.exif_json`
- `import_files` / `duplicate_file` → copy metadata through the catalog instead of copying `.rrdata`
- `rename_files` → update catalog paths; no `.rrdata` rename

Batch commands should use SQLite transactions to avoid partial writes.

## Read path integration

Replace direct `load_sidecar` usage with `metadata_store::load_image_metadata` or `load_adjustments`:

- Editor `load_image`
- Thumbnail generation (`generate_thumbnail_data`, `generate_single_thumbnail_and_cache`)
- Export / size estimation (`export_processing.rs`)
- `load_metadata` command
- Film grain preview
- Any other place that currently reads `.rrdata`

`read_exif_for_paths` can return data from `files.exif_json` / structured columns.

## Delta sync changes

`folder_import` delta sync currently fingerprints `(modified, size, sidecar_modified)`. Replace `sidecar_modified` with `metadata_modified` from `files`:

- On scan, compare disk `(modified, size)` with catalog `(modified, size, metadata_modified)`.
- Metadata-only edits no longer depend on a sidecar mtime; `metadata_modified` is updated by `metadata_store` on every write.
- Unchanged files keep their existing metadata.

## Virtual copies

Virtual copies are already rows in `files` with `is_virtual_copy = 1` and a `?vc=<id>` suffix in `path`. Each VC has its own `adjustments_json`, `rating`, `flag`, etc.

- `create_virtual_copy` inserts a new `files` row and writes its metadata through `metadata_store`.
- `delete_files_by_paths` cascades to remove VC rows and their deltas/snapshots.
- Relocation (`relocate_folder`) updates VC paths by prefix replacement, same as real files.

## XMP sidecars

XMP remains the supported external/interchange format:

- If XMP sync is enabled in settings, metadata writes also update the `.xmp` sidecar.
- XMP read is kept as a fallback/import path where it already exists.
- This task does not need to implement new XMP logic; existing XMP code is updated to source current metadata from `metadata_store` instead of `.rrdata`.

## Error handling

- DB write failures are returned to the caller and surfaced to the user (existing toast/error paths).
- Legacy `.rrdata` read failures during fallback are logged but not fatal; the command falls back to default metadata.
- If a batch command partially fails inside a transaction, the transaction is rolled back so DB and frontend stay consistent.
- Catalog recovery (`library.db.corrupt` rename) remains in place; after recovery, `.rrdata` legacy fallback repopulates metadata on demand.

## Performance

- `adjustments_json` can be large (masks, AI patches). Keep it in `files` as a single TEXT column to avoid joins on the hot path.
- Thumbnail/export code should avoid re-parsing `adjustments_json` multiple times per call; callers can pass the parsed `Value` or `ImageMetadata` down.
- History tables are write-mostly and queried only by `file_id`; the indexes above are sufficient.

## Testing

- Unit tests in `metadata_store.rs`:
  - default metadata when catalog and sidecar are missing;
  - lazy import from `.rrdata` when catalog is empty;
  - overwrite catalog when `.rrdata` is newer;
  - no write to `.rrdata` after `save_image_metadata`;
  - updates to `metadata_modified`;
  - virtual-copy metadata read/write.
- Update existing `library_db` tests for the new columns.
- `cargo check` and `cargo test --lib` must pass.
- `npm run build` must pass.
- Manual QA: open existing folder with `.rrdata`, edit, restart app, verify edits persist without `.rrdata` being updated.

## Future edit-history integration

The next separate task will build Lightroom-style undo + snapshots on top of this schema:

- `record_delta` will insert into `file_adjustment_deltas`.
- `take_snapshot` will insert into `file_adjustment_snapshots`.
- Undo navigation will mark deltas as `is_undone = 1` and rebuild `files.adjustments_json` from the remaining deltas or the nearest snapshot.
- The current task only creates the tables and stubs; no undo UI or logic is required now.

## Delta to upstream

- New file: `src-tauri/src/metadata_store.rs`.
- Modified files: `src-tauri/src/library_db.rs` (schema), `src-tauri/src/folder_import.rs` (sync fingerprint), `src-tauri/src/file_management.rs`, `src-tauri/src/exif_processing.rs`, `src-tauri/src/tagging.rs`, `src-tauri/src/export_processing.rs`, `src-tauri/src/image_loader.rs`, and other `.rrdata` read/write sites.
- Old `.rrdata` read/write commands are left as legacy helpers but are no longer called from production paths, keeping the fork merge-friendly.
