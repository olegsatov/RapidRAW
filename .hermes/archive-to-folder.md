# Archive-to-folder operation

## What it is

A context-menu action on a folder tree node that moves **imported** images from a
temporary/inbox location into a date-structured archive folder chosen by the user.
The intended workflow is:

1. Ingest photos from a flash card / temporary drive into the catalog.
2. Review, rate, flag and cull them inside the app.
3. Right-click the inbox folder → **Archive to…** and pick the archive root.
4. The app creates `YYYY/YYYY-MM/YYYY-MM-DD` sub-folders and copies the remaining
   (not deleted) images there, grouped by EXIF capture date.
5. After the copy is verified, the catalog paths are updated so ratings, flags,
   edit history and virtual copies stay attached to the moved files.
6. The user is then asked once whether to delete the original source files that
   were successfully archived.

The operation is a manual, explicit disk access — it is allowed under the
project's catalog/disk-access rules (see `AGENTS.md`).

## UX flow

- Entry point: right-click any folder in the library tree → **Archive to…**.
- A system folder dialog asks for the archive root (can be local disk, external
  HDD, network volume, etc.).
- A `window.confirm` shows the source folder name and the chosen root; on OK the
  job starts.
- A floating progress indicator (`ArchiveProgressIndicator`) shows the current
  file and `current/total` count. The job runs in a Tauri blocking task so the
  UI stays responsive.
- When the job finishes the user gets one more `window.confirm`:
  "Successfully archived N files. Delete the original files from …?".
- Only the successfully archived source files are offered for deletion; other
  files in the source folder (video, non-imported files, failed moves) are never
  touched.

## Date grouping

Files are grouped by the `date_taken` value stored in the SQLite catalog during
import (EXIF `DateTimeOriginal`). If the catalog has no `date_taken`, the file is
skipped with a log warning.

The default layout under the chosen archive root is:

```
<archive_root>/YYYY/YYYY-MM/YYYY-MM-DD/<filename>
```

If the archive root itself is named with a four-digit year (for example
`/Pictures/2026`), that folder is treated as the year level and photos from that
year are placed directly inside it using month/day folders:

```
<archive_root>/MM/DD/<filename>
```

Photos from a different year still get the full `YYYY/YYYY-MM/YYYY-MM-DD` path
(so a 2025 photo archived into `/Pictures/2026` lands at
`/Pictures/2026/2025/2025-MM/2025-MM-DD/<filename>`).

## Year offset

If the camera's clock was set to the wrong year, the archive dialog can shift all
photo dates for this operation without touching the catalog or EXIF. When the
chosen archive root is a four-digit year, a prompt asks how many years to add or
subtract (for example `+1` to archive 2025-dated photos inside a `/Pictures/2026`
folder as `MM/DD`). The offset applies only to the current archive job.

If a file with the same name already exists in the target day folder, the copied
file is auto-renamed:

```
DSC_0001.NEF  →  DSC_0001_1.NEF  →  DSC_0001_2.NEF  …
```

## Resume support

The archive job can be interrupted (for example the app loses focus, the process
is suspended, or the destination volume disconnects). Re-running the same
**Archive to…** operation on the same source/target resumes where it left off:

- Before copying a file, the backend checks whether a file with the same name
  already exists in the target day folder.
- If it exists and its **size and modification time** both match the source file,
  the copy is skipped and the existing destination path is used for the catalog
  update.
- If it exists but differs in size or mtime, the copied file is auto-renamed
  (`_1`, `_2`, …) exactly like before.
- When a file is actually copied, the source modification time is preserved on
  the destination file so the skip check remains reliable.

This means a partially copied day folder can be completed safely without
re-copying the files that already arrived intact.

## Catalog update optimization

To avoid keeping the SQLite write transaction open while files are being copied
from the source volume, the archive job now:

- Copies/skips files **outside** of any database transaction.
- Opens a short per-file transaction only to update the catalog entry for the
  file that just succeeded.
- Caches destination folder IDs so the `folders` table is only upserted once per
  target day folder.
- Updates each file with direct `UPDATE ... WHERE path = ?` and
  `UPDATE ... WHERE path LIKE ?` statements instead of fetching every matching
  row first.

This keeps the `database locked` window tiny and lets the rest of the app keep
reading/writing the catalog while archiving runs.

## Verification

After each actual file copy the destination size is compared to the source size.
If they mismatch the destination file is removed and the file is recorded as
failed. Skipped files do not run the size check. The SQLite catalog is only
updated for files whose destination path succeeded (copied or skipped). The
entire catalog update runs inside a single transaction; if no files were archived
successfully the transaction is rolled back.

## Sidecars / associated files

The operation reuses `file_management::find_all_associated_files` to discover any
`.rrexif` sidecar files next to the RAW. Those sidecars are copied together with
the image and renamed the same way if a conflict occurs. The app does not create
or manage XMP sidecars; modern metadata lives in the catalog.

## Catalog updates

Two helpers were added to `library_db.rs`:

- `get_files_for_archive(source_path)` — returns all non-virtual-copy,
  non-cloud-placeholder files under the source folder (recursively by catalog
  path), with their stored `date_taken`.
- `update_file_path_in_conn(old_path, new_path, new_folder_id, new_modified)` —
  rewrites the `path`, `name`, `folder_id` and optionally `modified` columns for
  the master file row and any virtual-copy rows that share the same physical
  file (`old_path?vc=<id>`).

## Backend commands

Registered in `src-tauri/src/lib.rs`:

- `archive_folder_to(source_path, target_root)` → `ArchiveResult { archived,
failed }`. Runs in `tauri::async_runtime::spawn_blocking`, emits
  `archive-progress` events.
- `delete_archived_sources(paths)` → list of `(path, error)` for files that could
  not be deleted.

## Frontend files

- `src/hooks/useArchiveToFolder.ts` — dialog flow, confirmation, invocation,
  delete-sources confirmation, refresh of folder tree/image list.
- `src/store/useArchiveStore.ts` — lightweight state for the archive job.
- `src/components/ui/ArchiveProgressIndicator.tsx` — floating progress card.
- `src/hooks/useTauriListeners.ts` — listener for `archive-progress` events.
- `src/hooks/useAppContextMenus.ts` — **Archive to…** context-menu item on
  folders.
- `src/App.tsx` — mounts the progress indicator.
- `src/i18n/locales/en.json` and `ru.json` — user-facing strings.

## Limitations / future improvements

- Currently only English and Russian strings are translated; other locales fall
  back to English.
- The `modified` timestamp is updated to the new file's mtime; thumbnails for
  moved files will be regenerated.
- If a file is copied successfully but the catalog update for it fails, the
  copied file remains in the archive as an orphan. A future cleanup step could
  delete such orphans before rolling back.
- The availability badge for root folders is a separate feature
  (`useFolderAvailability`). Archiving is allowed regardless of whether the
  source folder is currently marked online/offline, because the user explicitly
  chose the action.
- Date grouping falls back to skipping files without `date_taken`; a file-system
  mtime fallback could be added later.

## Related rules

See `AGENTS.md`:

- Catalog and disk-access rules — archiving is an explicit user action and is
  therefore allowed to touch the source filesystem.
- Delta map — archive-to-folder is listed as a local feature under
  `src-tauri/src/archive_operations.rs` and related files.
