# Sync stuck on network volume — root cause analysis

## Symptoms

1. Importing parent folder `Photo/` (which contains subfolders 2009–2025) does not
   discover subfolders that were never imported before.
2. After restart, `Photo/` disappears from the folder list entirely.
3. Sync counter stays at 0/0 indefinitely.

## Root causes (three independent bugs)

### Bug 1: Frontend short-circuits import for cataloged folders

**File:** `src/hooks/useAppNavigation.ts`, `handleSelectSubfolder` (line ~433)

```typescript
const cataloged = await invoke(Invokes.IsFolderCataloged, { path });
if (cataloged) {
    const files = await loadFolderFromCatalog(path, recursive);  // DB only
    // openFolder() is NEVER called → backend never scans disk
} else {
    openFolder(path, recursive);  // triggers backend import
}
```

`IsFolderCataloged` returns `true` because subfolders (2023, 2024, 2025) exist in the
`folders` table. `loadFolderFromCatalog` loads only already-cataloged files from DB.
`openFolder()` — which triggers `start_folder_import` on the backend — is
**never called**. No disk scan happens. New subfolders (2009–2022) that were
never imported remain invisible.

**Fix applied:** Added `openFolder(path, recursive)` call after catalog load to
trigger a background sync.

### Bug 2: Backend emits catalog-ready instead of syncing

**File:** `src-tauri/src/folder_import.rs`, `start_folder_import` (line ~89)

```rust
if let Some(folder_id) = library_db::get_folder_id(&app_handle, &normalized, recursive)? {
    let _ = app_handle.emit("folder-import-catalog-ready", ...);
    return Ok(key);  // returns immediately, no scan
}
```

When `openFolder` WAS called (e.g., first-time import), the backend found the
folder already in the `folders` table and emitted `catalog-ready` without
scanning the disk. The frontend loaded the existing catalog contents — missing
any files added since the last import.

**Fix applied:** Replaced `catalog-ready` emission with call to `sync_folder`,
which performs a delta scan comparing disk state to catalog fingerprints.

### Bug 3: Settings not persisted before crash/restart

**File:** `src/hooks/useAppNavigation.ts`, `handleOpenFolder` (line ~541)

```typescript
handleSettingsChange({ ...appSettings, rootFolders: newRootPaths } as any);
// No `await` — settings save is fire-and-forget
```

`handleSettingsChange` calls `invoke('save_settings')` asynchronously. If the
app crashes or is force-quit before the promise resolves, the new `rootFolders`
entry (e.g., `Photo/`) is lost. On restart, the folder is missing from the list.

**Fix applied:** Added `await` before `handleSettingsChange`.

### Bug 4 (critical): Sync data-loss on disconnected network volume

**File:** `src-tauri/src/folder_import.rs`, `run_sync_job`

```rust
let entries = collect_image_paths(...);  // walk returns 0 entries on disconnected volume
// ...
let (to_upsert, removed) = compute_sync_delta(entries, &fingerprints, &cancel);
// ALL cataloged files are marked as "removed" because disk has 0 entries
library_db::delete_files_by_paths(&app_handle, &removed);  // DELETES EVERYTHING
```

The guard `!Path::new(&path).is_dir()` is insufficient — macOS caches
`is_dir()` for disconnected SMB/AFP mounts, returning `true` even when the
share is unreachable.  `WalkDir` then returns 0 entries, `compute_sync_delta`
treats all cataloged files as deleted, and the sync **wipes the entire catalog**
for that folder.

**Fix applied:** Load catalog fingerprints BEFORE computing the delta. If the
walk returns 0 entries but the catalog has >0 files, emit an error and abort
the sync instead of deleting everything.

### Bug 5: WalkDir hangs on stale SMB mount

**File:** `src-tauri/src/folder_import.rs`, `run_sync_job`

`collect_image_paths` uses `WalkDir` which calls `std::fs::read_dir` — a
blocking syscall. On macOS, `getdirentries64` on a stale SMB mount can hang
indefinitely (D-state, uninterruptible sleep). There is no timeout.

This blocks one tokio blocking thread permanently. The async task waiting on
`spawn_blocking` also hangs. The `folder_import_jobs` entry remains, so
subsequent sync requests SHOULD find the existing job and return early.

**However**, logs show NEW sync tasks being spawned every 10–14 seconds for
the same path, suggesting the job map check is failing. Additional diagnostic
logging was added to `start_job` to determine whether the check passes or fails.

**Not yet fixed.** The walk timeout and the duplicate-sync issue require more
investigation.

### Bug 6: Walk errors silently dropped

**File:** `src-tauri/src/folder_import.rs`, `collect_image_paths`

```rust
.filter_map(Result::ok)  // silently drops all WalkDir/read_dir errors
```

On network volumes, permission errors or stale directory entries are silently
swallowed. The walk continues but entire subtrees may be missing with no
indication to the user.

**Fix applied:** Replaced `filter_map(Result::ok)` with explicit error logging
via `log::warn!`.

### Bug 7: Orphan folder rows accumulate

**File:** `src-tauri/src/folder_import.rs`, `run_import_job`

When importing a parent folder whose subfolders were previously imported
separately, `upsert_files` reassigns all files to the parent's `folder_id`
(via `ON CONFLICT(path) DO UPDATE SET folder_id=...`). The old folder rows
remain in the `folders` table with zero files.

**Fix applied:** Added `delete_orphan_folders_under()` — runs after Phase 1
scan, deletes sub-folder rows that have `COUNT(files) = 0`. Safe because of
the `HAVING COUNT = 0` guard — `ON DELETE CASCADE` on `files.folder_id`
cannot delete files that don't exist.

## Changes summary

| File | Change |
|------|--------|
| `src/hooks/useAppNavigation.ts` | `await handleSettingsChange` (Bug 3) |
| `src/hooks/useAppNavigation.ts` | `openFolder()` for cataloged folders (Bug 1) |
| `src-tauri/src/folder_import.rs` | `sync_folder` instead of `catalog-ready` (Bug 2) |
| `src-tauri/src/folder_import.rs` | Walk error logging (Bug 6) |
| `src-tauri/src/folder_import.rs` | Empty-walk guard (Bug 4) |
| `src-tauri/src/folder_import.rs` | Diagnostic logging in `start_job`/`run_sync_job` (Bug 5) |
| `src-tauri/src/library_db.rs` | `delete_orphan_folders_under` (Bug 7) |

## Remaining issues

1. **WalkDir timeout on SMB** — need a way to abort a stuck walk without
   leaking blocking threads. Options:
   - `tokio::time::timeout` on `spawn_blocking` (aborts wait, but leaks thread)
   - Spawn walk in a dedicated OS thread that can be killed (unsafe, but
     sometimes necessary for network I/O)
   - Avoid triggering sync automatically; make it a manual user action

2. **Duplicate sync spawning** — need to determine why `folder_import_jobs`
   check fails. The new diagnostic logging (`[sync] start_job check: key=...`)
   will show whether the existing job is found or not.

3. **Two mount points for same share** — `/Volumes/192.168.1.60/Photo` and
   `/Volumes/192.168.1.60-1/Photo` refer to the same network share. Files
   cataloged under one path are invisible under the other. The `locate_folder`
   command can fix this manually; auto-detection would require matching files
   by `file_id` (content hash or inode-equivalent).
