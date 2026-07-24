import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { folderJobKey, useFolderImportStore, type FolderImportJob } from '../store/useFolderImportStore';
import { LibraryViewMode, type ImageFile, type AppSettings } from '../components/ui/AppProperties';
import type { FolderTree } from '../components/panel/FolderTree';

// A job in one of these phases no longer receives events and only lingers
// for the auto-dismiss window, so it is safe to drop before a fresh import.
const isTerminalPhase = (phase: FolderImportJob['phase']): boolean =>
  phase === 'complete' || phase === 'cancelled' || phase === 'error';

// The start/sync invokes return the backend's canonical job key
// ("path|recursive", path normalized by normalize_folder_path). When it
// differs from the optimistic raw-path key, re-home the job so the optimistic
// entry does not shadow the real one the folder-import-* event listeners
// update. A stale finished job at the canonical key is dropped first so a
// re-import's batches do not append duplicates to its file list; a
// non-terminal job there IS the current stream (the backend emits
// folder-import-started, and possibly early batches, before the invoke
// resolves), so it is never cleared. The subsequent startJob then no-ops
// only if listeners already created a fresh entry there.
function rehomeJob(returnedKey: string, optimisticKey: string, recursive: boolean, kind?: 'import' | 'sync') {
  if (returnedKey === optimisticKey) {
    return;
  }
  const folderImportStore = useFolderImportStore.getState();
  folderImportStore.clearJob(optimisticKey);
  const existing = folderImportStore.jobs[returnedKey];
  if (existing && isTerminalPhase(existing.phase)) {
    folderImportStore.clearJob(returnedKey);
  }
  const separator = returnedKey.lastIndexOf('|');
  const canonicalPath = separator > -1 ? returnedKey.substring(0, separator) : returnedKey;
  folderImportStore.startJob(canonicalPath, recursive, kind);

  // The backend canonicalizes the path (resolves symlinks and strips trailing
  // separators). Keep the library tree/view in sync so the mirror effect can
  // find the job for the current folder and the folder tree stays selectable.
  const optSeparator = optimisticKey.lastIndexOf('|');
  const optimisticPath = optSeparator > -1 ? optimisticKey.substring(0, optSeparator) : optimisticKey;
  if (optimisticPath !== canonicalPath) {
    const library = useLibraryStore.getState();
    const { currentFolderPath, rootPaths, expandedFolders } = library;
    let changed = false;

    const newCurrentFolderPath = currentFolderPath === optimisticPath ? canonicalPath : currentFolderPath;
    if (newCurrentFolderPath !== currentFolderPath) {
      changed = true;
    }

    const newRootPaths = deduplicateNestedPaths(rootPaths.map((p) => (p === optimisticPath ? canonicalPath : p)));
    if (newRootPaths.some((p, i) => p !== rootPaths[i])) {
      changed = true;
    }

    const newExpandedFolders = new Set(
      Array.from(expandedFolders).map((p) => (p === optimisticPath ? canonicalPath : p)),
    );
    if (
      newExpandedFolders.size !== expandedFolders.size ||
      !Array.from(newExpandedFolders).every((p) => expandedFolders.has(p))
    ) {
      changed = true;
    }

    if (changed) {
      library.setLibrary({
        currentFolderPath: newCurrentFolderPath,
        rootPaths: newRootPaths,
        expandedFolders: newExpandedFolders,
      });
    }
  }
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

// Pages a cataloged folder's full file list out of the catalog (rows carry
// the EXIF merged by the import's phase 2, unlike streamed batch files). Used
// by the folder-import-catalog-ready listener to restore a folder without a
// rescan, and by folder-import-complete to refresh EXIF. `onPage` fires per
// batch so callers can stream pages into the job store as they arrive; paths
// are deduped so a row skipped server-side (corrupt JSON) cannot duplicate a
// file across pages.
export async function loadFolderFromCatalog(
  path: string,
  recursive: boolean,
  onPage?: (files: ImageFile[], scanned: number) => void,
): Promise<ImageFile[]> {
  const files: ImageFile[] = [];
  const seen = new Set<string>();
  const limit = 2000;
  console.time(`[load-folder] ${path}`);
  while (true) {
    const pageStart = performance.now();
    const batch = await invoke<ImageFile[]>('load_folder_files', {
      path,
      recursive,
      offset: files.length,
      limit,
    });
    console.log(
      `[load-folder] ${path} page offset=${files.length} returned ${batch.length} files in ${(performance.now() - pageStart).toFixed(1)}ms`,
    );
    if (batch.length === 0) {
      break;
    }
    const page = batch.filter((f) => {
      if (seen.has(f.path)) {
        return false;
      }
      seen.add(f.path);
      return true;
    });
    // A full page of duplicates means server-side skips (corrupt rows) have
    // realigned the pages entirely onto already-seen rows; without this the
    // offset would stop advancing and the loop would never end.
    if (page.length === 0) {
      break;
    }
    files.push(...page);
    onPage?.(page, files.length);
  }
  console.timeEnd(`[load-folder] ${path}`);
  return files;
}

/// Replaces a folder path prefix, preserving children. Used after a folder
/// is relocated so frontend paths stay in sync with the catalog.
export function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) {
    return newPrefix;
  }
  const forwardSep = `${oldPrefix}/`;
  const backSep = `${oldPrefix}\\`;
  if (path.startsWith(forwardSep)) {
    return `${newPrefix}/${path.slice(forwardSep.length)}`;
  }
  if (path.startsWith(backSep)) {
    return `${newPrefix}\\${path.slice(backSep.length)}`;
  }
  return path;
}

export interface FolderLocatedPayload {
  oldPath: string;
  newPath: string;
}

/// Updates all frontend state after a folder has been relocated in the
/// catalog. Returns true when the currently displayed folder was under the
/// relocated tree, so callers can refresh the image list.
export function applyFolderRelocation(oldPath: string, newPath: string): boolean {
  const { appSettings, setAppSettings, handleSettingsChange } = useSettingsStore.getState();
  const { rootPaths, currentFolderPath, expandedFolders, setLibrary } = useLibraryStore.getState();
  const folderImportStore = useFolderImportStore.getState();

  const newRootPaths = deduplicateNestedPaths(rootPaths.map((p) => replacePathPrefix(p, oldPath, newPath)));
  const newCurrentFolderPath = currentFolderPath ? replacePathPrefix(currentFolderPath, oldPath, newPath) : null;
  const newExpandedFolders = new Set(Array.from(expandedFolders).map((p) => replacePathPrefix(p, oldPath, newPath)));

  setLibrary({
    rootPaths: newRootPaths,
    currentFolderPath: newCurrentFolderPath,
    expandedFolders: newExpandedFolders,
  });

  folderImportStore.setAvailability(newPath, 'online');

  if (appSettings) {
    const newSettings: AppSettings = { ...appSettings };
    newSettings.rootFolders = deduplicateNestedPaths(
      (appSettings.rootFolders || []).map((p) => replacePathPrefix(p, oldPath, newPath)),
    );
    newSettings.pinnedFolders = deduplicateNestedPaths(
      (appSettings.pinnedFolders || []).map((p) => replacePathPrefix(p, oldPath, newPath)),
    );
    newSettings.lastRootPath = appSettings.lastRootPath
      ? replacePathPrefix(appSettings.lastRootPath, oldPath, newPath)
      : null;

    if (appSettings.folderIcons) {
      newSettings.folderIcons = {};
      for (const [key, value] of Object.entries(appSettings.folderIcons)) {
        newSettings.folderIcons[replacePathPrefix(key, oldPath, newPath)] = value;
      }
    }

    if (appSettings.lastFolderState) {
      newSettings.lastFolderState = {
        ...appSettings.lastFolderState,
        currentFolderPath: appSettings.lastFolderState.currentFolderPath
          ? replacePathPrefix(appSettings.lastFolderState.currentFolderPath, oldPath, newPath)
          : null,
        expandedFolders: (appSettings.lastFolderState.expandedFolders || []).map((p) =>
          replacePathPrefix(p, oldPath, newPath),
        ),
        lastSelectedImage: appSettings.lastFolderState.lastSelectedImage
          ? replacePathPrefix(appSettings.lastFolderState.lastSelectedImage, oldPath, newPath)
          : null,
      };
    }

    setAppSettings(newSettings);
    handleSettingsChange(newSettings).catch((err) => {
      console.error('Failed to save settings after folder relocation:', err);
    });
  }

  return currentFolderPath !== null && newCurrentFolderPath !== currentFolderPath;
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
      // arrive as folder-import-* events. For an already-cataloged folder the
      // backend starts a delta sync instead of a full import, so the same
      // event stream is used and the listener loads the final file list from
      // the catalog when the sync completes.
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

// Removes paths that are strict children of another path in the list.
// E.g. ["/a", "/a/b", "/c"] -> ["/a", "/c"]. Keeps the shortest root for
// each tree so a relocated subfolder does not stay as a duplicate root.
export function deduplicateNestedPaths(paths: string[]): string[] {
  if (paths.length <= 1) return paths;
  const normalized = paths.map((p) => p.replace(/[/\\]+$/, ''));
  const sorted = normalized.map((p, i) => ({ p, i })).sort((a, b) => a.p.length - b.p.length || a.p.localeCompare(b.p));
  const kept = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    const { p, i: idx } = sorted[i];
    let isNested = false;
    for (let j = 0; j < i; j++) {
      const parent = sorted[j].p;
      if (p === parent || p.startsWith(`${parent}/`) || p.startsWith(`${parent}\\`)) {
        isNested = true;
        break;
      }
    }
    if (!isNested) {
      kept.add(idx);
    }
  }
  return paths.filter((_, i) => kept.has(i));
}

function collectRootPaths(trees: FolderTree[]): string[] {
  // Availability is checked only for top-level (root) folders. Subfolders
  // inherit the online/offline state conceptually, but we never stat them:
  // a root path existing on disk means the whole volume is reachable.
  return (trees || []).map((node) => node.path).filter(Boolean);
}

// Monitors the root folder trees and refreshes the online/offline availability
// badge for root folders only. Mount exactly once at the App root.
export function useFolderAvailability() {
  const folderTrees = useLibraryStore((state) => state.folderTrees);
  const pinnedFolderTrees = useLibraryStore((state) => state.pinnedFolderTrees);

  useEffect(() => {
    const rootPaths = Array.from(new Set([...collectRootPaths(folderTrees), ...collectRootPaths(pinnedFolderTrees)]));
    if (rootPaths.length === 0) {
      return;
    }
    useFolderImportStore.getState().checkAvailability(rootPaths);
  }, [folderTrees, pinnedFolderTrees]);
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
    // Batch files carry exif: null (phase 2 writes EXIF only to the catalog
    // DB); the folder-import-complete listener refreshes the current folder's
    // files from the catalog, restoring exif here for sorting and the
    // metadata columns.
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
      // Existing user-set values take precedence over catalog/batch values
      // so a later catalog refresh does not overwrite user edits.
      imageRatings: { ...ratings, ...state.imageRatings },
      imageFlags: { ...flags, ...state.imageFlags },
    }));
  }, [files]);
}
