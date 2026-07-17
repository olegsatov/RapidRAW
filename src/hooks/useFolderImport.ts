import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { folderJobKey, useFolderImportStore, type FolderImportJob } from '../store/useFolderImportStore';
import { LibraryViewMode } from '../components/ui/AppProperties';

// The backend canonicalizes folder paths (and trims trailing separators)
// before keying its job map, and the folder-import-* event listeners key the
// store by those normalized paths. `currentFolderPath` comes from the folder
// tree and is not canonicalized, so look up the exact key first and fall back
// to a trailing-separator-insensitive match.
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

export function useFolderImport() {
  const openFolder = useCallback(async (path: string, recursive: boolean) => {
    const store = useFolderImportStore.getState();
    store.startJob(path, recursive, 'import');
    try {
      // Returns the job key immediately; progress and file batches arrive as
      // folder-import-* events.
      // TODO(Task 14): for an already-cataloged folder the backend emits
      // folder-import-catalog-ready and runs no job, so no batches ever
      // arrive — load the file list from the catalog there instead.
      await invoke<string>('start_folder_import', { path, recursive });
    } catch (err) {
      store.failJob(folderJobKey(path, recursive), String(err));
      console.error('Failed to start folder import:', err);
    }
  }, []);

  const syncFolder = useCallback(async (path: string, recursive: boolean) => {
    const store = useFolderImportStore.getState();
    const key = folderJobKey(path, recursive);
    // A sync re-emits the folder's files, so drop any previous job instead of
    // appending duplicates to its file list.
    store.clearJob(key);
    store.startJob(path, recursive, 'sync');
    try {
      await invoke<string>('sync_folder', { path, recursive });
    } catch (err) {
      store.failJob(key, String(err));
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

  const currentFolderPath = useLibraryStore((state) => state.currentFolderPath);
  const recursive = useSettingsStore((state) => state.appSettings?.libraryViewMode === LibraryViewMode.Recursive);
  const job = useFolderImportStore((state) =>
    currentFolderPath ? findJobForFolder(state.jobs, currentFolderPath, recursive) : undefined,
  );
  const files = job?.files;

  useEffect(() => {
    // Mirror the current folder job's file list into the library. This covers
    // both an actively streaming job (files grow batch by batch through the
    // scan/exif/thumbnails phases) and returning to a folder whose job
    // already completed — its file list restores instantly. An empty file
    // list is never mirrored: a freshly started job (or one for an
    // already-cataloged folder, which emits no batches) must not wipe the
    // current imageList.
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

  return { openFolder, syncFolder, cancelFolderImport };
}
