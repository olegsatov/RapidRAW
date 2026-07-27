# Design: Intelligent catalog backup (Archive to... safety net)

## 1. Goal

Add a **user-prompted, change-aware backup mechanism** for the SQLite catalog so that a corrupted or lost `library.db` does not wipe out months of edits, ratings, flags, tags and archive-to moves.

The application tracks how many catalog rows changed since the last backup, nudges the user when the backlog is large enough, and lets the user create a compact, versioned backup with one click or hotkey. The backup itself is always initiated by the user; there are no silent automatic copies.

## 2. Background

- Catalog path: `<app_data_dir>/library.db`.
- Current production catalog size: ~1.9 GB for ~90 000 files.
- ~1.2 GB of that is dead space in the SQLite freelist (page churn from imports, migrations and updates). A `VACUUM`/`VACUUM INTO` shrinks the file to roughly 700 MB.
- User edits (adjustments, history deltas/snapshots) are tied to `files.id`, not to the file path, so the catalog is the single source of truth for non-destructive edits.
- The existing `init_catalog` recovery path renames a broken DB to `library.db.corrupt` and starts fresh. A separate backup is the only way to recover the previous state.

## 3. Non-goals

- **Not** a continuous/automatic background backup.
- **Not** an export of adjustments into sidecar files (that may come later, but is out of scope).
- **Not** cloud upload or network sync.
- **Not** a one-click in-app restore wizard for the first version. Restore is documented as a manual file replacement; an in-app restore command can be added later.

## 4. Design

### 4.1 State tracking

Two persistence layers are used:

1. **Catalog state (inside `library.db`)** — tied to the DB itself, survives rename/recovery only if the DB survives.
   - Stored in the existing `meta` table:
     - `backup_pending_count` (integer) — number of files changed since last backup.
     - `backup_last_at` (unix seconds) — timestamp of the last successful backup.
     - `backup_last_banner_at` (unix seconds) — timestamp when the banner was last shown, to throttle reminders.
   - These keys are updated in the same transactions that modify file state, so the counter is durable across crashes.

2. **User preferences (in `settings.json`)** — survive catalog corruption/loss.
   - `catalogBackupFolder: Option<String>` — user-chosen destination folder.
   - `catalogBackupThreshold: u32` — default `50`, number of pending changes that triggers the banner.
   - `catalogBackupBannerIntervalMinutes: u32` — default `60`, minimum time between banners.
   - `catalogBackupKeepCount: u32` — default `10`, number of backups to keep.

### 4.2 What counts as a changed file

`backup_pending_count` is incremented whenever a write touches a row in `files` or its related history tables:

- Saving edit history (`save_edit_history`).
- Updating rating / flag / color / tags (`update_file_rating_flag_tags`).
- Moving a file via archive-to (`update_file_path_in_conn`).
- Creating or deleting a virtual copy.
- Importing new files (each imported file counts as +1; a 1000-photo import therefore immediately crosses most thresholds).

The increment happens in the same SQL transaction as the change, using a small helper `increment_backup_counter_in_conn`. If the transaction rolls back, the counter rolls back with it.

### 4.3 Backup process

When the user confirms a backup (banner, exit dialog, settings button, or hotkey):

1. **Resolve destination.**
   - If `catalogBackupFolder` is not set, open the native folder picker and persist the choice.
   - If a one-off destination is supplied (future UI), use it instead.

2. **Create a compact copy on a separate connection.**
   - Open a fresh read-only or auto-commit connection to `library.db` and run `VACUUM INTO '<dest>/library-backup-<timestamp>.db'`.
   - `VACUUM INTO` cannot run inside a transaction, so the backup operation uses its own connection while the main app connection stays unchanged.
   - This produces a clean, defragmented DB without the freelist bloat.

3. **Compress.**
   - Gzip the resulting file to `library-backup-<timestamp>.db.gz` using `flate2` (or the gzip crate already present in the dependency tree).
   - Remove the uncompressed intermediate file.

4. **Rotate old backups.**
   - `<timestamp>` is a Unix timestamp (e.g. `library-backup-1753500000.db.gz`) so lexicographic order matches chronological order.
   - Delete oldest `library-backup-*.db.gz` files until at most `catalogBackupKeepCount` remain.

5. **Update state.**
   - Set `backup_pending_count = 0`.
   - Set `backup_last_at = now()`.
   - Keep `backup_last_banner_at` as is.

6. **Report result.**
   - Return `{ path, uncompressed_size, compressed_size }` to the frontend for a toast/notification.

If any step fails, the state is **not** reset and the user sees an error toast.

### 4.4 Banner throttling and exit dialog

- **Banner** is shown when:
  - `backup_pending_count >= catalogBackupThreshold`, and
  - `now - backup_last_banner_at >= catalogBackupBannerIntervalMinutes * 60`.
- Clicking «Later» updates `backup_last_banner_at = now()` and hides the banner until the next interval.
- **Exit dialog** is shown whenever the user closes the app and `backup_pending_count > 0`, regardless of banner timing.
- **Indicator** in the main status bar always shows the current pending count and acts as a quick backup button.

### 4.5 UI / UX

| Element | Behavior |
|---|---|
| Status-bar indicator | Shield/disk icon + pending count. Click opens the backup dialog. Hidden or dimmed when count is 0. |
| Banner | Non-blocking toast/banner at the bottom: «You have edited 127 files. Back up the catalog?» Buttons: **Back up now** / **Later**. |
| Exit dialog | Modal on app close: «You have 127 unsaved catalog changes. Back up before quitting?» Buttons: **Back up** / **Quit without backup** / **Cancel**. |
| Settings panel | Pick backup folder, threshold, reminder interval, keep count, and a **Back up now** button. |
| Hotkey | `Ctrl/Cmd + Shift + B` triggers immediate backup. |

### 4.6 Commands and events

New Rust commands:

- `get_catalog_backup_state() -> CatalogBackupState`
- `create_catalog_backup(destination: Option<String>) -> BackupResult`
- `set_catalog_backup_destination(path: String)`
- `dismiss_catalog_backup_banner()`

Frontend pieces:

- `CatalogBackupIndicator` component.
- `CatalogBackupBanner` component.
- Hook `useCatalogBackup()` wrapping the commands and banner/exit logic.
- Integration into the existing settings modal and global exit handler.

### 4.7 Error handling and recovery

- **Backup failure:** show error toast, do not reset pending count, keep banner/exit reminder active.
- **No disk space:** estimate required space as `library.db size × 0.4` and report it.
- **Destination unavailable:** ask the user to pick a different folder.
- **Restore (manual):** close the app, decompress the chosen `.gz` backup, replace `library.db` with it, delete `library.db-wal` and `library.db-shm`, restart.
- **Existing corrupt-catalog recovery:** keeps working as today (`library.db.corrupt` rename). The user can then manually restore from a backup file.

## 5. Security and privacy

- The backup contains the full catalog metadata, EXIF and edit history. It is stored where the user chooses; the app does not upload it.
- Compressed backups are ordinary gzip files; no encryption in the first version. Users who need encryption can place backups on an encrypted volume.

## 6. Future work

- In-app restore wizard that lists available backups and replaces `library.db` safely.
- Optional sidecar export of adjustments as an additional safety layer.
- Cloud destination plugins (SMB, S3, WebDAV) if requested.

## 7. Approval

Design approved: user confirmed the hybrid, user-prompted approach with banner throttling, status indicator, exit dialog, gzip-compressed `VACUUM INTO` backups, and `Ctrl/Cmd+Shift+B` hotkey.
