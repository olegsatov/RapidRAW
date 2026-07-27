# Catalog backup implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-prompted, change-aware backup for the SQLite catalog with banner throttling, status indicator, exit dialog, gzip-compressed `VACUUM INTO` backups, and a `Ctrl/Cmd+Shift+B` hotkey.

**Architecture:** Track a durable pending-change counter inside `library.db`'s `meta` table. Hook existing write paths so every edit, rating change, archive-to move, virtual-copy creation and import increments the counter. Expose Tauri commands to read state, create a backup, and dismiss the banner. The frontend polls/observes state, shows a banner when the threshold is crossed, and intercepts app close when there are pending changes.

**Tech Stack:** Rust (Tauri, rusqlite, flate2), TypeScript/React (Zustand, Tauri JS API), SQLite `VACUUM INTO`, gzip.

---

## Task 1: Add gzip dependency

**Files:**
- Modify: `src-tauri/Cargo.toml:72`

- [ ] **Step 1: Add `flate2` to dependencies**

```toml
flate2 = "1.0"
```

Place it near the other compression/image crates, e.g. after `filetime = "0.2"`.

- [ ] **Step 2: Verify cargo can resolve the dependency**

Run: `cargo check -p RapidRAW --manifest-path src-tauri/Cargo.toml`
Expected: resolves without errors (other pre-existing errors may remain).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "deps: add flate2 for catalog backup compression"
```

---

## Task 2: Add backup preference fields to AppSettings

**Files:**
- Modify: `src-tauri/src/app_settings.rs:368-504`
- Modify: `src-tauri/src/app_settings.rs:506-603`
- Modify: `src/components/ui/AppProperties.tsx:203-265`

- [ ] **Step 1: Add four new optional fields to the Rust `AppSettings` struct**

Inside the `AppSettings` struct, add near the bottom (before `flag_auto_advance`):

```rust
#[serde(default)]
pub catalog_backup_folder: Option<String>,
#[serde(default)]
pub catalog_backup_threshold: Option<u32>,
#[serde(default)]
pub catalog_backup_banner_interval_minutes: Option<u32>,
#[serde(default)]
pub catalog_backup_keep_count: Option<u32>,
```

- [ ] **Step 2: Add defaults in `Default for AppSettings`**

In the `default()` impl, add:

```rust
catalog_backup_folder: None,
catalog_backup_threshold: Some(50),
catalog_backup_banner_interval_minutes: Some(60),
catalog_backup_keep_count: Some(10),
```

- [ ] **Step 3: Mirror the fields in the TypeScript `AppSettings` interface**

In `src/components/ui/AppProperties.tsx`, add inside `export interface AppSettings`:

```tsx
catalogBackupFolder?: string;
catalogBackupThreshold?: number;
catalogBackupBannerIntervalMinutes?: number;
catalogBackupKeepCount?: number;
```

- [ ] **Step 4: Run cargo check**

Run: `cargo check -p RapidRAW --manifest-path src-tauri/Cargo.toml`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/app_settings.rs src/components/ui/AppProperties.tsx
git commit -m "settings: add catalog backup preference fields"
```

---

## Task 3: Add backup-state helpers in library_db.rs

**Files:**
- Modify: `src-tauri/src/library_db.rs:10-17`
- Modify: `src-tauri/src/library_db.rs:32-43`
- Create: `src-tauri/src/catalog_backup.rs` (not yet; helpers live here first)

We will add small helpers directly in `library_db.rs` because they need access to the same connection as the write operations.

- [ ] **Step 1: Add helper functions after `open_connection`**

Insert after `open_connection` (around line 30):

```rust
const BACKUP_PENDING_COUNT_KEY: &str = "backup_pending_count";
const BACKUP_LAST_AT_KEY: &str = "backup_last_at";
const BACKUP_LAST_BANNER_AT_KEY: &str = "backup_last_banner_at";

fn get_meta_i64(conn: &Connection, key: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT value FROM meta WHERE key = ?1",
        params![key],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn set_meta_i64(conn: &Connection, key: &str, value: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn increment_backup_counter_in_conn(conn: &Connection, delta: i64) -> Result<(), String> {
    if delta <= 0 {
        return Ok(());
    }
    let current = get_meta_i64(conn, BACKUP_PENDING_COUNT_KEY)?.unwrap_or(0);
    let next = current.saturating_add(delta);
    set_meta_i64(conn, BACKUP_PENDING_COUNT_KEY, next)
}

pub fn get_catalog_backup_state_in_conn(
    conn: &Connection,
) -> Result<(i64, Option<i64>, Option<i64>), String> {
    Ok((
        get_meta_i64(conn, BACKUP_PENDING_COUNT_KEY)?.unwrap_or(0),
        get_meta_i64(conn, BACKUP_LAST_AT_KEY)?,
        get_meta_i64(conn, BACKUP_LAST_BANNER_AT_KEY)?,
    ))
}

pub fn reset_backup_counter_in_conn(conn: &Connection) -> Result<(), String> {
    let now = now_secs();
    set_meta_i64(conn, BACKUP_PENDING_COUNT_KEY, 0)?;
    set_meta_i64(conn, BACKUP_LAST_AT_KEY, now as i64)?;
    Ok(())
}

pub fn touch_backup_banner_in_conn(conn: &Connection) -> Result<(), String> {
    set_meta_i64(conn, BACKUP_LAST_BANNER_AT_KEY, now_secs() as i64)
}
```

- [ ] **Step 2: Ensure `meta` table is created in migrations**

It already is in `SCHEMA_V1`. No change needed.

- [ ] **Step 3: Add a unit test for the counter**

Append to the `#[cfg(test)] mod tests` block at the end of `library_db.rs`:

```rust
#[test]
fn test_backup_counter_increments_and_resets() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA_V1).unwrap();
    let (pending, last, banner) = get_catalog_backup_state_in_conn(&conn).unwrap();
    assert_eq!(pending, 0);
    assert!(last.is_none());
    assert!(banner.is_none());

    increment_backup_counter_in_conn(&conn, 3).unwrap();
    let (pending, _, _) = get_catalog_backup_state_in_conn(&conn).unwrap();
    assert_eq!(pending, 3);

    reset_backup_counter_in_conn(&conn).unwrap();
    let (pending, last, _) = get_catalog_backup_state_in_conn(&conn).unwrap();
    assert_eq!(pending, 0);
    assert!(last.is_some());
}
```

- [ ] **Step 4: Run cargo check and tests**

Run:
```bash
cd src-tauri && cargo test -p rapidaw_lib library_db::tests::test_backup_counter_increments_and_resets -- --nocapture
```
Expected: test passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/library_db.rs
git commit -m "catalog-backup: add backup counter helpers and tests"
```

---

## Task 4: Increment the counter on every relevant write

**Files:**
- Modify: `src-tauri/src/library_db.rs:487-538`
- Modify: `src-tauri/src/library_db.rs:894-898`
- Modify: `src-tauri/src/library_db.rs:1076-1100`
- Modify: `src-tauri/src/library_db.rs:1839-1865`
- Modify: `src-tauri/src/file_management.rs:3690-3711`

- [ ] **Step 1: Increment on file import/upsert**

In `upsert_files_in_conn`, just before `tx.commit()` (around line 544), add:

```rust
increment_backup_counter_in_conn(&tx, files.len() as i64)?;
```

`INSERT ... ON CONFLICT(...) DO UPDATE ...` touches one row per input file, so `files.len()` is the correct change count.

- [ ] **Step 2: Increment on edit history save**

At the end of `save_edit_history_in_conn` (after the final `UPDATE files` and before `Ok(())`), add:

```rust
increment_backup_counter_in_conn(conn, 1)?;
```

- [ ] **Step 3: Increment on rating/flag/tags/color update**

At the end of `update_file_rating_flag_tags_in_conn`, add:

```rust
increment_backup_counter_in_conn(conn, 1)?;
```

Also modify `update_file_color` (around line 1147) to add the same line at the end.

- [ ] **Step 4: Increment on archive-to path update**

At the end of `update_file_path_in_conn`, add:

```rust
increment_backup_counter_in_conn(conn, updated as i64)?;
```

This counts both the primary file and its virtual copies.

- [ ] **Step 5: Increment on virtual-copy creation**

In `file_management.rs`, at the end of `create_virtual_copy`, add:

```rust
if let Ok(conn) = library_db::open_connection(&app_handle) {
    let _ = library_db::increment_backup_counter_in_conn(&conn, 1);
}
```

Add `use crate::library_db;` at the top of `file_management.rs` if not already present.

- [ ] **Step 6: Run cargo check**

Run: `cargo check -p RapidRAW --manifest-path src-tauri/Cargo.toml`
Expected: compiles.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/library_db.rs src-tauri/src/file_management.rs
git commit -m "catalog-backup: increment pending counter on edits, imports, archive-to and virtual copies"
```

---

## Task 5: Create the catalog backup module

**Files:**
- Create: `src-tauri/src/catalog_backup.rs`
- Modify: `src-tauri/src/lib.rs:1-20`
- Modify: `src-tauri/src/lib.rs:2642`

- [ ] **Step 1: Create `src-tauri/src/catalog_backup.rs`**

```rust
use std::fs;
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};

use flate2::write::GzEncoder;
use flate2::Compression;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

use crate::app_settings::{load_settings, save_settings, AppSettings};
use crate::library_db::{open_connection, reset_backup_counter_in_conn, touch_backup_banner_in_conn};

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

fn db_path<R: Runtime>(app_handle: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(data_dir.join("library.db"))
}

fn timestamp_name() -> String {
    format!(
        "library-backup-{}.db.gz",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
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
    let conn = Connection::open(source_str).map_err(|e| format!("failed to open source db: {}", e))?;
    // VACUUM INTO needs the target path as a literal. Parameter binding is not
    // reliably supported across SQLite versions, so quote it safely.
    let escaped = target_str.replace('\'', "''");
    conn.execute(&format!("VACUUM INTO '{}'", escaped), [])
        .map_err(|e| format!("VACUUM INTO failed: {}", e))?;
    Ok(())
}

fn gzip_file(source: &Path, target: &Path) -> Result<u64, String> {
    let input = fs::File::open(source).map_err(|e| format!("failed to open uncompressed backup: {}", e))?;
    let output = fs::File::create(target).map_err(|e| format!("failed to create compressed backup: {}", e))?;
    let mut reader = BufReader::new(input);
    let mut encoder = GzEncoder::new(BufWriter::new(output), Compression::default());
    std::io::copy(&mut reader, &mut encoder)
        .map_err(|e| format!("gzip compression failed: {}", e))?;
    let finished = encoder.finish().map_err(|e| format!("failed to finalize gzip: {}", e))?;
    let metadata = finished.into_inner().map_err(|e| format!("failed to unwrap writer: {}", e))?
        .metadata().map_err(|e| format!("failed to read compressed metadata: {}", e))?;
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
            let _ = fs::remove_file(old);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_catalog_backup_state<R: Runtime>(app_handle: AppHandle<R>) -> Result<CatalogBackupState, String> {
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
pub async fn create_catalog_backup<R: Runtime>(
    destination: Option<String>,
    app_handle: AppHandle<R>,
) -> Result<CatalogBackupResult, String> {
    let settings = load_settings(app_handle.clone())?;
    let dest_dir = match destination {
        Some(d) => d,
        None => settings.catalog_backup_folder.ok_or("backup destination not set")?,
    };
    let dest_path = ensure_destination_dir(&dest_dir)?;

    let source_db = db_path(&app_handle)?;
    let temp_name = format!("library-backup-{}.db.tmp", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs());
    let temp_path = dest_path.join(&temp_name);
    let final_path = dest_path.join(timestamp_name());

    vacuum_into(&source_db, &temp_path)?;
    let uncompressed_size = fs::metadata(&temp_path)
        .map_err(|e| format!("failed to stat temp backup: {}", e))?
        .len();
    let compressed_size = gzip_file(&temp_path, &final_path)?;
    fs::remove_file(&temp_path).map_err(|e| format!("failed to remove temp backup: {}", e))?;

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
pub async fn set_catalog_backup_destination<R: Runtime>(
    path: String,
    app_handle: AppHandle<R>,
) -> Result<(), String> {
    let mut settings = load_settings(app_handle.clone())?;
    settings.catalog_backup_folder = Some(path);
    save_settings(settings, app_handle)?;
    Ok(())
}

#[tauri::command]
pub async fn dismiss_catalog_backup_banner<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), String> {
    let conn = open_connection(&app_handle)?;
    touch_backup_banner_in_conn(&conn)?;
    Ok(())
}
```

**Note:** `VACUUM INTO` runs on a separate connection so the main catalog connection remains unaffected.

- [ ] **Step 2: Register the module and commands**

At the top of `src-tauri/src/lib.rs`, add:

```rust
mod catalog_backup;
```

In the `generate_handler!` list, add before the closing `])`:

```rust
catalog_backup::get_catalog_backup_state,
catalog_backup::create_catalog_backup,
catalog_backup::set_catalog_backup_destination,
catalog_backup::dismiss_catalog_backup_banner,
```

- [ ] **Step 3: Run cargo check**

Run: `cargo check -p RapidRAW --manifest-path src-tauri/Cargo.toml`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/catalog_backup.rs src-tauri/src/lib.rs
git commit -m "catalog-backup: add Rust backup module and commands"
```

---

## Task 6: Intercept app close to show backup dialog

**Files:**
- Modify: `src-tauri/src/lib.rs:2659-2674`
- Modify: `src-tauri/src/lib.rs:2517-2642`

Currently the app immediately exits on `ExitRequested`. We need to emit an event to the frontend and delay exit.

- [ ] **Step 1: Add a pending-exit flag to `AppState`**

Open `src-tauri/src/app_state.rs` and add inside `pub struct AppState` (after the last field):

```rust
pub exit_backup_requested: Mutex<bool>,
```

Open `src-tauri/src/lib.rs` and add to the `.manage(AppState { ... })` block:

```rust
exit_backup_requested: Mutex::new(false),
```

- [ ] **Step 2: Modify the exit handler**

Replace the `RunEvent::ExitRequested` branch with:

```rust
tauri::RunEvent::ExitRequested { api, .. } => {
    let state = app_handle.state::<AppState>();
    let already_waiting = *state.exit_backup_requested.lock().unwrap();
    if already_waiting {
        api.prevent_exit();
        return;
    }

    match crate::catalog_backup::should_prompt_before_exit(app_handle) {
        Ok(true) => {
            *state.exit_backup_requested.lock().unwrap() = true;
            api.prevent_exit();
            let _ = app_handle.emit("catalog-backup-exit-prompt", ());
        }
        _ => {
            #[cfg(target_os = "macos")]
            unsafe { libc::_exit(0); }
            #[cfg(not(target_os = "macos"))]
            std::process::exit(0);
        }
    }
}
```

- [ ] **Step 3: Add `should_prompt_before_exit` helper**

In `src-tauri/src/catalog_backup.rs`, add:

```rust
pub fn should_prompt_before_exit<R: Runtime>(app_handle: &AppHandle<R>) -> Result<bool, String> {
    let conn = open_connection(app_handle)?;
    let (pending, _, _) = crate::library_db::get_catalog_backup_state_in_conn(&conn)?;
    Ok(pending > 0)
}
```

- [ ] **Step 4: Add frontend-exit command**

Add a command in `catalog_backup.rs`:

```rust
#[tauri::command]
pub fn confirm_exit(app_handle: AppHandle) {
    std::process::exit(0);
}
```

Register it in `lib.rs` `generate_handler!` as `catalog_backup::confirm_exit`.

- [ ] **Step 5: Run cargo check**

Run: `cargo check -p RapidRAW --manifest-path src-tauri/Cargo.toml`
Expected: compiles.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/catalog_backup.rs src-tauri/src/app_state.rs
git commit -m "catalog-backup: prompt frontend before exit when changes are pending"
```

---

## Task 7: Add the frontend backup hook

**Files:**
- Create: `src/hooks/useCatalogBackup.ts`
- Modify: `src/App.tsx` (or wherever global listeners are wired)

- [ ] **Step 1: Create `src/hooks/useCatalogBackup.ts`**

```typescript
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { useSettingsStore } from '../store/useSettingsStore';

export interface CatalogBackupState {
  pendingCount: number;
  lastBackupAt: number | null;
  lastBannerAt: number | null;
  destination: string | null;
}

export function useCatalogBackup() {
  const { t } = useTranslation();
  const [state, setState] = useState<CatalogBackupState>({
    pendingCount: 0,
    lastBackupAt: null,
    lastBannerAt: null,
    destination: null,
  });
  const [showBanner, setShowBanner] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const appSettings = useSettingsStore((s) => s.appSettings);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<CatalogBackupState>('get_catalog_backup_state');
      setState(result);
    } catch (err) {
      console.error('[catalog-backup] failed to fetch state', err);
    }
  }, []);

  const createBackup = useCallback(async (destination?: string) => {
    try {
      const result = await invoke<{ path: string; uncompressed_size: number; compressed_size: number }>(
        'create_catalog_backup',
        { destination: destination ?? null }
      );
      toast.success(
        t('catalogBackup.toasts.success', {
          path: result.path,
          size: formatBytes(result.compressed_size),
        })
      );
      await refresh();
      return true;
    } catch (err) {
      const message = typeof err === 'string' ? err : String(err);
      toast.error(t('catalogBackup.toasts.error', { error: message }));
      return false;
    }
  }, [t, refresh]);

  const dismissBanner = useCallback(async () => {
    setShowBanner(false);
    try {
      await invoke('dismiss_catalog_backup_banner');
      await refresh();
    } catch (err) {
      console.error('[catalog-backup] failed to dismiss banner', err);
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const threshold = appSettings?.catalogBackupThreshold ?? 50;
    const intervalMinutes = appSettings?.catalogBackupBannerIntervalMinutes ?? 60;
    const now = Date.now() / 1000;
    const lastBanner = state.lastBannerAt ?? 0;
    if (state.pendingCount >= threshold && now - lastBanner >= intervalMinutes * 60) {
      setShowBanner(true);
    }
  }, [state, appSettings]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('catalog-backup-completed', () => {
      refresh();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [refresh]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('catalog-backup-exit-prompt', () => {
      setShowExitDialog(true);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  return {
    ...state,
    showBanner,
    setShowBanner,
    showExitDialog,
    setShowExitDialog,
    createBackup,
    dismissBanner,
    refresh,
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useCatalogBackup.ts
git commit -m "catalog-backup: add frontend backup hook"
```

---

## Task 8: Add UI components

**Files:**
- Create: `src/components/ui/CatalogBackupIndicator.tsx`
- Create: `src/components/ui/CatalogBackupBanner.tsx`
- Create: `src/components/ui/CatalogBackupExitDialog.tsx`

- [ ] **Step 1: Create `CatalogBackupIndicator.tsx`**

```tsx
import { HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Text from './Text';

interface CatalogBackupIndicatorProps {
  pendingCount: number;
  onClick(): void;
}

export default function CatalogBackupIndicator({ pendingCount, onClick }: CatalogBackupIndicatorProps) {
  const { t } = useTranslation();
  if (pendingCount === 0) {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-text-secondary hover:bg-surface transition-colors"
        data-tooltip={t('catalogBackup.indicator.upToDate')}
      >
        <HardDrive size={16} />
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
      data-tooltip={t('catalogBackup.indicator.tooltip', { count: pendingCount })}
    >
      <HardDrive size={16} />
      <Text variant="small" className="font-medium">
        {t('catalogBackup.indicator.label', { count: pendingCount })}
      </Text>
    </button>
  );
}
```

- [ ] **Step 2: Create `CatalogBackupBanner.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import Button from './Button';
import Text from './Text';

interface CatalogBackupBannerProps {
  pendingCount: number;
  onBackup(): void;
  onDismiss(): void;
}

export default function CatalogBackupBanner({ pendingCount, onBackup, onDismiss }: CatalogBackupBannerProps) {
  const { t } = useTranslation();
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-4 py-3 rounded-lg bg-bg-secondary border border-border-color shadow-lg">
      <Text>
        {t('catalogBackup.banner.message', { count: pendingCount })}
      </Text>
      <div className="flex items-center gap-2">
        <Button onClick={onBackup}>{t('catalogBackup.banner.backup')}</Button>
        <Button variant="ghost" onClick={onDismiss}>
          {t('catalogBackup.banner.later')}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `CatalogBackupExitDialog.tsx`**

`ConfirmModal` only supports two buttons, so build a small custom modal:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import Text from './Text';
import { TextVariants } from '../../types/typography';

interface CatalogBackupExitDialogProps {
  isOpen: boolean;
  pendingCount: number;
  onBackup(): void;
  onQuitWithoutBackup(): void;
  onCancel(): void;
}

export default function CatalogBackupExitDialog({
  isOpen,
  pendingCount,
  onBackup,
  onQuitWithoutBackup,
  onCancel,
}: CatalogBackupExitDialogProps) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    setShow(false);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0'}`}
      onClick={onCancel}
    >
      <div
        className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-md transform transition-all duration-300 ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t('catalogBackup.exitDialog.title')}
        </Text>
        <Text className="mb-6 whitespace-pre-wrap">
          {t('catalogBackup.exitDialog.message', { count: pendingCount })}
        </Text>
        <div className="flex justify-end gap-3 mt-5">
          <Button variant="ghost" onClick={onCancel}>
            {t('catalogBackup.exitDialog.cancel')}
          </Button>
          <Button variant="ghost" onClick={onQuitWithoutBackup}>
            {t('catalogBackup.exitDialog.quitWithoutBackup')}
          </Button>
          <Button onClick={onBackup}>
            {t('catalogBackup.exitDialog.backup')}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/CatalogBackupIndicator.tsx src/components/ui/CatalogBackupBanner.tsx src/components/ui/CatalogBackupExitDialog.tsx
git commit -m "catalog-backup: add indicator, banner and exit dialog components"
```

---

## Task 9: Wire components into the main layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/panel/BottomBar.tsx` (optional, if indicator lives in the bottom bar)

- [ ] **Step 1: Import and use the hook/components in `App.tsx`**

Add imports:

```tsx
import { invoke } from '@tauri-apps/api/core';
import { useCatalogBackup } from './hooks/useCatalogBackup';
import CatalogBackupIndicator from './components/ui/CatalogBackupIndicator';
import CatalogBackupBanner from './components/ui/CatalogBackupBanner';
import CatalogBackupExitDialog from './components/ui/CatalogBackupExitDialog';
```

Inside the main component (or the window wrapper), add:

```tsx
const backup = useCatalogBackup();
```

Render the indicator in the header/status bar. If the app uses a custom title bar, place it there; otherwise place it in `BottomBar`. Example in the top-right area:

```tsx
<CatalogBackupIndicator
  pendingCount={backup.pendingCount}
  onClick={() => backup.createBackup()}
/>
```

Render the banner:

```tsx
{backup.showBanner && (
  <CatalogBackupBanner
    pendingCount={backup.pendingCount}
    onBackup={async () => {
      const ok = await backup.createBackup();
      if (ok) backup.setShowBanner(false);
    }}
    onDismiss={() => backup.dismissBanner()}
  />
)}
```

Render the exit dialog:

```tsx
<CatalogBackupExitDialog
  isOpen={backup.showExitDialog}
  pendingCount={backup.pendingCount}
  onBackup={async () => {
    const ok = await backup.createBackup();
    if (ok) {
      backup.setShowExitDialog(false);
      await invoke('confirm_exit');
    }
  }}
  onQuitWithoutBackup={() => {
    backup.setShowExitDialog(false);
    invoke('confirm_exit').catch(console.error);
  }}
  onCancel={() => backup.setShowExitDialog(false)}
/>
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "catalog-backup: wire indicator, banner and exit dialog into App"
```

---

## Task 10: Add backup settings section

**Files:**
- Modify: `src/components/panel/SettingsPanel.tsx:560-568`
- Modify: `src/components/panel/SettingsPanel.tsx` (add JSX section)

- [ ] **Step 1: Add a new settings category**

Add to `settingCategories`:

```tsx
{ id: 'backup', label: t('settings.categories.backup'), icon: HardDrive },
```

Import `HardDrive` from `lucide-react`.

- [ ] **Step 2: Import the folder picker**

Ensure `src/components/panel/SettingsPanel.tsx` imports:

```tsx
import { open } from '@tauri-apps/plugin-dialog';
```

- [ ] **Step 3: Render the backup settings panel**

Add a new conditional block when `activeCategory === 'backup'`:

```tsx
{activeCategory === 'backup' && (
  <div className="space-y-6">
    <SettingItem label={t('settings.backup.destination')}>
      <div className="flex items-center gap-2">
        <Input
          value={appSettings?.catalogBackupFolder || ''}
          readOnly
          placeholder={t('settings.backup.destinationPlaceholder')}
        />
        <Button onClick={async () => {
          const dir = await open({ directory: true, multiple: false });
          if (dir && typeof dir === 'string') {
            await invoke('set_catalog_backup_destination', { path: dir });
            onSettingsChange({ ...appSettings, catalogBackupFolder: dir });
          }
        }}>
          {t('settings.backup.chooseFolder')}
        </Button>
      </div>
    </SettingItem>

    <SettingItem label={t('settings.backup.threshold')}>
      <Input
        type="number"
        value={appSettings?.catalogBackupThreshold ?? 50}
        onChange={(e) => onSettingsChange({ ...appSettings, catalogBackupThreshold: parseInt(e.target.value, 10) || 0 })}
      />
    </SettingItem>

    <SettingItem label={t('settings.backup.intervalMinutes')}>
      <Input
        type="number"
        value={appSettings?.catalogBackupBannerIntervalMinutes ?? 60}
        onChange={(e) => onSettingsChange({ ...appSettings, catalogBackupBannerIntervalMinutes: parseInt(e.target.value, 10) || 0 })}
      />
    </SettingItem>

    <SettingItem label={t('settings.backup.keepCount')}>
      <Input
        type="number"
        value={appSettings?.catalogBackupKeepCount ?? 10}
        onChange={(e) => onSettingsChange({ ...appSettings, catalogBackupKeepCount: parseInt(e.target.value, 10) || 1 })}
      />
    </SettingItem>

    <Button onClick={() => backup.createBackup()}>
      {t('settings.backup.backupNow')}
    </Button>
  </div>
)}
```

Inside `SettingsPanel`, add:

```tsx
const backup = useCatalogBackup();
```

near the other hook calls at the top of the component. Use `backup.createBackup()` for the **Back up now** button.

- [ ] **Step 4: Commit**

```bash
git add src/components/panel/SettingsPanel.tsx
git commit -m "catalog-backup: add backup section to settings panel"
```

---

## Task 11: Add keyboard shortcut

**Files:**
- Modify: `src/utils/keyboardUtils.ts`
- Modify: `src/hooks/useKeyboardShortcuts.ts:76-530`

- [ ] **Step 1: Register the keybind definition**

In `src/utils/keyboardUtils.ts`, find `KEYBIND_DEFINITIONS` and add:

```tsx
{
  action: 'backup_catalog',
  description: 'keybinds.backupCatalog',
  defaultCombo: ['ctrl', 'shift', 'b'],
},
```

On macOS `Ctrl+Shift+B` is fine; users can rebind to `Cmd+Shift+B` in settings.

- [ ] **Step 2: Add the action handler in useKeyboardShortcuts**

In the `actions` record, add:

```tsx
backup_catalog: {
  shouldFire: () => true,
  execute: (e: any) => {
    e.preventDefault();
    invoke('create_catalog_backup').catch(console.error);
  },
},
```

Import `invoke` at the top if not already imported.

- [ ] **Step 3: Commit**

```bash
git add src/utils/keyboardUtils.ts src/hooks/useKeyboardShortcuts.ts
git commit -m "catalog-backup: add Ctrl+Shift+B backup hotkey"
```

---

## Task 12: Add locale strings

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json` (if present and maintained)

- [ ] **Step 1: Add English strings**

Add under a new top-level key `catalogBackup`:

```json
"catalogBackup": {
  "indicator": {
    "upToDate": "Catalog backup up to date",
    "label": "{{count}} pending",
    "tooltip": "{{count}} files changed since last backup"
  },
  "banner": {
    "message": "You have edited {{count}} files. Back up the catalog?",
    "backup": "Back up now",
    "later": "Later"
  },
  "exitDialog": {
    "title": "Back up catalog?",
    "message": "You have {{count}} unsaved catalog changes. Back up before quitting?",
    "backup": "Back up",
    "quitWithoutBackup": "Quit without backup",
    "cancel": "Cancel"
  },
  "toasts": {
    "success": "Catalog backed up to {{path}} ({{size}})",
    "error": "Backup failed: {{error}}"
  }
}
```

Add under `settings.categories`:

```json
"backup": "Backup"
```

Add under `settings`:

```json
"backup": {
  "destination": "Backup folder",
  "destinationPlaceholder": "Choose a folder...",
  "chooseFolder": "Choose",
  "threshold": "Reminder threshold (changed files)",
  "intervalMinutes": "Minimum minutes between reminders",
  "keepCount": "Backups to keep",
  "backupNow": "Back up now"
}
```

Add under `keybinds`:

```json
"backupCatalog": "Back up catalog"
```

- [ ] **Step 2: Add Russian strings**

Mirror the English structure with Russian translations:

```json
"catalogBackup": {
  "indicator": {
    "upToDate": "Бэкап каталога актуален",
    "label": "{{count}} изменений",
    "tooltip": "{{count}} файлов изменено с последнего бэкапа"
  },
  "banner": {
    "message": "Вы изменили {{count}} файлов. Создать бэкап каталога?",
    "backup": "Создать бэкап",
    "later": "Позже"
  },
  "exitDialog": {
    "title": "Создать бэкап каталога?",
    "message": "У вас {{count}} несохранённых в бэкап изменений. Создать бэкап перед выходом?",
    "backup": "Создать бэкап",
    "quitWithoutBackup": "Выйти без бэкапа",
    "cancel": "Отмена"
  },
  "toasts": {
    "success": "Каталог сохранён: {{path}} ({{size}})",
    "error": "Ошибка бэкапа: {{error}}"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "catalog-backup: add locale strings"
```

---

## Task 13: Add a Rust unit test for backup rotation

**Files:**
- Modify: `src-tauri/src/catalog_backup.rs`

- [ ] **Step 1: Add a test module at the bottom**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn backup_rotation_keeps_only_n_files() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..5 {
            fs::write(tmp.path().join(format!("library-backup-100{}.db.gz", i)), "x").unwrap();
        }
        rotate_backups(tmp.path(), 3).unwrap();
        let remaining: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().to_string()))
            .collect();
        assert_eq!(remaining.len(), 3);
        assert!(remaining.iter().all(|n| n.starts_with("library-backup-")));
    }
}
```

- [ ] **Step 2: Run the test**

Run: `cd src-tauri && cargo test -p rapidaw_lib catalog_backup::tests::backup_rotation_keeps_only_n_files -- --nocapture`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/catalog_backup.rs
git commit -m "catalog-backup: add rotation unit test"
```

---

## Task 14: Final verification

- [ ] **Step 1: Rust side**

Run: `cd src-tauri && cargo check`
Expected: no new errors.

- [ ] **Step 2: TypeScript side**

Run: `npm run build`
Expected: bundle succeeds; judge new TypeScript errors against the pre-existing baseline if any.

- [ ] **Step 3: Formatting**

Run: `npx prettier --check src/hooks/useCatalogBackup.ts src/components/ui/CatalogBackupIndicator.tsx src/components/ui/CatalogBackupBanner.tsx src/components/ui/CatalogBackupExitDialog.tsx src/App.tsx src/components/panel/SettingsPanel.tsx src/utils/keyboardUtils.ts src/hooks/useKeyboardShortcuts.ts src/i18n/locales/en.json src/i18n/locales/ru.json`
Expected: files are formatted.

- [ ] **Step 4: Manual smoke test checklist**

1. Edit a file → indicator increments.
2. Cross the threshold → banner appears once per interval.
3. Press `Ctrl/Cmd+Shift+B` → backup file created and gzipped.
4. Open settings → choose backup folder, change threshold, click Back up now.
5. Close app with pending changes → exit dialog appears.
6. Restore: replace `library.db` with decompressed backup, delete `-wal`/`-shm`, restart.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "catalog-backup: final verification fixes"
```

---

## Self-review coverage

| Spec requirement | Task |
|---|---|
| Durable pending counter in `meta` | Task 3 |
| Increment on edits, ratings, archive-to, virtual copies, imports | Task 4 |
| `VACUUM INTO` + gzip + rotation | Task 5 |
| User-prompted (no auto silent backup) | Tasks 7–10 |
| Banner with throttling | Tasks 8–9 |
| Status indicator | Task 8, 9 |
| Exit dialog | Tasks 6, 8, 9 |
| Settings panel | Task 10 |
| `Ctrl/Cmd+Shift+B` hotkey | Task 11 |
| Locale strings | Task 12 |
| Tests | Tasks 3, 13 |
