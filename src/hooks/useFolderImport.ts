import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { folderJobKey, useFolderImportStore, type FolderImportJob } from '../store/useFolderImportStore';
import { LibraryViewMode } from '../components/ui/AppProperties';

// A job in one of these phases no longer receives events and only lingers
// for the auto-dismiss window, so it is safe to drop before a fresh import.
const isTerminalPhase = (phase: FolderImportJob['phase']): boolean =>
  phase === 'complete' || phase === 'cancelled' || phase === 'error';

// The start/sync invokes return the backend's canonical job key
// ("path|recursive", path normalized by normalize_folder_path). When it
// differs from the optimistic raw-path key, re-home the job so the optimistic
// entry does not shadow the real one the folder-import-* event listeners
// update. A sync re-emits the folder's files, so any stale job at the
// canonical key is dropped first to avoid appendBatch duplicating its files;
// an import drops it only when terminal (an active one keeps streaming).
// The subsequent startJob then no-ops only if listeners already created a
// fresh entry there.
function rehomeJob(returnedKey: string, optimisticKey: string, recursive: boolean, kind?: 'import' | 'sync') {
  if (returnedKey === optimisticKey) {
    return;
  }
  const store = useFolderImportStore.getState();
  store.clearJob(optimisticKey);
  const existing = store.jobs[returnedKey];
  if (kind === 'sync' || (existing && isTerminalPhase(existing.phase))) {
    store.clearJob(returnedKey);
  }
  const separator = returnedKey.lastIndexOf('|');
  const canonicalPath = separator > -1 ? returnedKey.substring(0, separator) : returnedKey;
  store.startJob(canonicalPath, recursive, kind);
}

// Jobs are keyed by the canonical path the invokes return (see rehomeJob), so
// an exact lookup normally hits. The trailing-separator-insensitive fallback
// remains for entries created from event payloads before the invoke resolved.
function findJobForFolder(
  jobs: Record<string, FolderImportJob>,
  path: string,
  recursive: boolean,
): FolderImportJob | undefined {
  const exact = jobs[folderJobKey(path, recursive)];
  if (exact) {
    return exact;
  }
  const trimmed = path.replace(/[/\\]+$/, '');
  return Object.values(jobs).find((job) => job.recursive === recursive && job.path.replace(/[/\\]+$/, '') === trimmed);
}

// Pure folder-import command API. Safe to call from any component (e.g. the
// Task 12 ImportJobsIndicator): it mounts no effects and subscribes to no
// store slices. The imageList mirror lives in useFolderImportMirror below,
// which must be mounted exactly once.
export function useFolderImport() {
  const openFolder = useCallback(async (path: string, recursive: boolean) => {
    const store = useFolderImportStore.getState();
    const optimisticKey = folderJobKey(path, recursive);
    // A finished job lingers for the auto-dismiss window; if the folder is
    // re-opened meanwhile, drop it first or the fresh import's batches would
    // append duplicates to its stale file list. Never clear an active job —
    // the backend would keep streaming to it and its files would be lost.
    const existing = store.jobs[optimisticKey];
    if (existing && isTerminalPhase(existing.phase)) {
      store.clearJob(optimisticKey);
    }
    store.startJob(path, recursive, 'import');
    try {
      // Returns the canonical job key immediately; progress and file batches
      // arrive as folder-import-* events.
      // TODO(Task 14): for an already-cataloged folder the backend emits
      // folder-import-catalog-ready and runs no job, so no batches ever
      // arrive — load the file list from the catalog there instead.
      const key = await invoke<string>('start_folder_import', { path, recursive });
      rehomeJob(key, optimisticKey, recursive, 'import');
    } catch (err) {
      store.failJob(optimisticKey, String(err));
      console.error('Failed to start folder import:', err);
    }
  }, []);

  const syncFolder = useCallback(async (path: string, recursive: boolean) => {
    const store = useFolderImportStore.getState();
    const optimisticKey = folderJobKey(path, recursive);
    // A sync re-emits the folder's files, so drop any previous job instead of
    // appending duplicates to its file list.
    store.clearJob(optimisticKey);
    store.startJob(path, recursive, 'sync');
    try {
      const key = await invoke<string>('sync_folder', { path, recursive });
      rehomeJob(key, optimisticKey, recursive, 'sync');
    } catch (err) {
      store.failJob(optimisticKey, String(err));
      console.error('Failed to sync folder:', err);
    }
  }, []);

  const cancelFolderImport = useCallback(async (path: string, recursive: boolean) => {
    const key = folderJobKey(path, recursive);
    useFolderImportStore.getState().cancelJob(key);
    try {
      await invoke('cancel_folder_import', { path, recursive });
    } catch (err) {
      console.error('Failed to cancel folder import:', err);
    }
  }, []);

  return { openFolder, syncFolder, cancelFolderImport };
}

// Mirrors the current folder job's streamed file list into the library store.
// Mount exactly once (done by useAppNavigation at the App root); a second
// mount would duplicate every imageList write.
export function useFolderImportMirror() {
  const currentFolderPath = useLibraryStore((state) => state.currentFolderPath);
  const recursive = useSettingsStore((state) => state.appSettings?.libraryViewMode === LibraryViewMode.Recursive);
  // Select only the files array: its identity changes once per emitted batch,
  // so exif/thumbnail per-file progress updates on the same job do not
  // re-render the App-root component this hook is mounted in.
  const files = useFolderImportStore((state) =>
    currentFolderPath ? findJobForFolder(state.jobs, currentFolderPath, recursive)?.files : undefined,
  );

  useEffect(() => {
    // Mirror the current folder job's file list into the library. This covers
    // both an actively streaming job (files grow batch by batch through the
    // scan/exif/thumbnails phases) and returning to a folder whose job
    // already completed — its file list restores instantly. An empty file
    // list is never mirrored: a freshly started job (or one for an
    // already-cataloged folder, which emits no batches) must not wipe the
    // current imageList.
    // TODO(Task 14): batch files carry exif: null (phase 2 writes EXIF only
    // to the catalog DB). The complete-time catalog refresh planned there
    // restores exif into imageList for sorting and the metadata columns.
    if (!files || files.length === 0) {
      return;
    }
    const ratings: Record<string, number> = {};
    const flags: Record<string, number> = {};
    files.forEach((f) => {
      if (f.rating !== undefined) {
        ratings[f.path] = f.rating;
      }
      if (f.flag !== undefined) {
        flags[f.path] = f.flag;
      }
    });
    useLibraryStore.getState().setLibrary((state) => ({
      imageList: files,
      // Merge rather than replace: batches arrive incrementally, and a
      // wholesale replace would drop ratings/flags the user set mid-scan.
      imageRatings: { ...state.imageRatings, ...ratings },
      imageFlags: { ...state.imageFlags, ...flags },
    }));
  }, [files]);
}
