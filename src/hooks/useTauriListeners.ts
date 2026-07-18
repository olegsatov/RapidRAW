import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { toast } from 'react-toastify';
import { Status } from '../components/ui/ExportImportProperties';
import { LibraryViewMode } from '../components/ui/AppProperties';
import { useProcessStore } from '../store/useProcessStore';
import { useEditorStore } from '../store/useEditorStore';
import { useUIStore } from '../store/useUIStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { loadFolderFromCatalog, applyFolderRelocation, type FolderLocatedPayload } from './useFolderImport';
import {
  folderJobKey,
  useFolderImportStore,
  type FolderImportBatchPayload,
  type FolderImportCancelledPayload,
  type FolderImportCatalogReadyPayload,
  type FolderImportCompletePayload,
  type FolderImportErrorPayload,
  type FolderImportEventPayload,
  type FolderImportPhaseProgressPayload,
  type FolderImportPhaseStartPayload,
  type FolderImportScanPayload,
  type FolderImportStartedPayload,
} from '../store/useFolderImportStore';

interface TauriListenerProps {
  refreshAllFolderTrees: () => void;
  handleSelectSubfolder: (path: string, isNewRoot?: boolean, preloadedImages?: any[], expandParents?: boolean) => void;
  refreshImageList: () => void;
  markGenerated: (path: string) => void;
}

function isFolderOnScreen(path: string, recursive: boolean): boolean {
  const currentFolder = useLibraryStore.getState().currentFolderPath;
  if (currentFolder === null) return false;
  const viewRecursive = useSettingsStore.getState().appSettings?.libraryViewMode === LibraryViewMode.Recursive;
  return recursive === viewRecursive && currentFolder.replace(/[/\\]+$/, '') === path.replace(/[/\\]+$/, '');
}

export function useTauriListeners({
  refreshAllFolderTrees,
  handleSelectSubfolder,
  refreshImageList,
  markGenerated,
}: TauriListenerProps) {
  const { t } = useTranslation();
  const refs = useRef({ refreshAllFolderTrees, handleSelectSubfolder, refreshImageList, markGenerated });

  useEffect(() => {
    refs.current = { refreshAllFolderTrees, handleSelectSubfolder, refreshImageList, markGenerated };
  });

  const thumbnailBuffer = useRef<Record<string, string>>({});
  const ratingBuffer = useRef<Record<string, number>>({});
  const editStatusBuffer = useRef<Record<string, boolean>>({});
  const flushHandle = useRef<number | null>(null);
  const treeRefreshTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let isEffectActive = true;

    const flushThumbnailBatch = () => {
      flushHandle.current = null;
      if (!isEffectActive) return;

      const pendingThumbs = thumbnailBuffer.current;
      const pendingRatings = ratingBuffer.current;
      const pendingEdits = editStatusBuffer.current;

      thumbnailBuffer.current = {};
      ratingBuffer.current = {};
      editStatusBuffer.current = {};

      if (Object.keys(pendingThumbs).length > 0) {
        useProcessStore.getState().setProcess((state) => ({
          thumbnails: { ...state.thumbnails, ...pendingThumbs },
        }));
      }

      if (Object.keys(pendingRatings).length > 0 || Object.keys(pendingEdits).length > 0) {
        useLibraryStore.getState().setLibrary((state) => ({
          imageRatings: { ...state.imageRatings, ...pendingRatings },
          imageList:
            Object.keys(pendingEdits).length > 0
              ? state.imageList.map((img) =>
                  pendingEdits[img.path] !== undefined ? { ...img, is_edited: pendingEdits[img.path] } : img,
                )
              : state.imageList,
        }));
      }
    };

    const scheduleFlush = () => {
      if (flushHandle.current !== null) return;
      flushHandle.current = requestAnimationFrame(flushThumbnailBatch);
    };

    const scheduleTreeRefresh = () => {
      if (treeRefreshTimeoutRef.current !== null) return;
      treeRefreshTimeoutRef.current = window.setTimeout(() => {
        treeRefreshTimeoutRef.current = null;
        if (!isEffectActive) return;
        refs.current.refreshAllFolderTrees();
      }, 500);
    };

    const flushTreeRefresh = () => {
      if (treeRefreshTimeoutRef.current !== null) {
        window.clearTimeout(treeRefreshTimeoutRef.current);
        treeRefreshTimeoutRef.current = null;
      }
      refs.current.refreshAllFolderTrees();
    };

    const listeners = [
      listen('preview-update-uncropped', (event: any) => {
        if (isEffectActive) useEditorStore.getState().setEditor({ uncroppedAdjustedPreviewUrl: event.payload });
      }),
      listen('histogram-update', (event: any) => {
        if (isEffectActive && event.payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor({ histogram: event.payload.data });
        }
      }),
      listen('open-with-file', (event: any) => {
        if (isEffectActive) useProcessStore.getState().setProcess({ initialFileToOpen: event.payload as string });
      }),
      listen('external-edit-session', (event: any) => {
        if (isEffectActive) useProcessStore.getState().setProcess({ externalEditSession: event.payload });
      }),
      listen('waveform-update', (event: any) => {
        if (isEffectActive && event.payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor({ waveform: event.payload.data });
        }
      }),
      listen('thumbnail-progress', (event: any) => {
        if (isEffectActive)
          useProcessStore
            .getState()
            .setProcess({ thumbnailProgress: { current: event.payload.current, total: event.payload.total } });
      }),
      listen('thumbnail-generation-complete', () => {
        if (isEffectActive) useProcessStore.getState().setProcess({ thumbnailProgress: { current: 0, total: 0 } });
      }),
      listen('thumbnail-generated', (event: any) => {
        if (!isEffectActive) return;
        const { path, thumbnailPath, rating, is_edited, data } = event.payload;

        if (thumbnailPath) {
          thumbnailBuffer.current[path] = convertFileSrc(thumbnailPath);
          refs.current.markGenerated(path);
        } else if (data) {
          thumbnailBuffer.current[path] = data;
          refs.current.markGenerated(path);
        }
        if (rating !== undefined) {
          ratingBuffer.current[path] = rating;
        }
        if (is_edited !== undefined) {
          editStatusBuffer.current[path] = is_edited;
        }
        if (thumbnailPath || data || rating !== undefined || is_edited !== undefined) {
          scheduleFlush();
        }
      }),
      listen('image-metadata-loaded', (event: any) => {
        if (!isEffectActive) return;
        const { path, rating, is_edited, tags, flag } = event.payload;

        useLibraryStore.getState().setLibrary((state) => ({
          imageRatings: { ...state.imageRatings, [path]: rating },
          ...(flag !== undefined ? { imageFlags: { ...state.imageFlags, [path]: flag } } : {}),
          imageList: state.imageList.map((img) =>
            img.path === path ? { ...img, is_edited, tags: tags ?? img.tags } : img,
          ),
        }));
      }),
      listen('ai-model-download-start', (event: any) => {
        if (isEffectActive) useProcessStore.getState().setProcess({ aiModelDownloadStatus: event.payload });
      }),
      listen('ai-model-download-finish', () => {
        if (isEffectActive) useProcessStore.getState().setProcess({ aiModelDownloadStatus: null });
      }),
      listen('indexing-started', () => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ isIndexing: true, indexingProgress: { current: 0, total: 0 } });
      }),
      listen('indexing-progress', (event: any) => {
        if (isEffectActive) useProcessStore.getState().setProcess({ indexingProgress: event.payload });
      }),
      listen('indexing-finished', () => {
        if (isEffectActive) {
          useProcessStore.getState().setProcess({ isIndexing: false, indexingProgress: { current: 0, total: 0 } });
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (currentPath) {
            refs.current.refreshImageList();
          }
        }
      }),
      listen('batch-export-progress', (event: any) => {
        if (isEffectActive) useProcessStore.getState().setExportState({ progress: event.payload });
      }),
      listen('export-complete', () => {
        if (isEffectActive) useProcessStore.getState().setExportState({ status: Status.Success });
      }),
      listen('export-error', (event: any) => {
        if (isEffectActive)
          useProcessStore.getState().setExportState({
            status: Status.Error,
            errorMessage: typeof event.payload === 'string' ? event.payload : 'Unknown error',
          });
      }),
      listen('export-cancelled', () => {
        if (isEffectActive) useProcessStore.getState().setExportState({ status: Status.Cancelled });
      }),
      listen('import-start', (event: any) => {
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            errorMessage: '',
            path: '',
            progress: { current: 0, total: event.payload.total },
            status: Status.Importing,
          });
      }),
      listen('import-progress', (event: any) => {
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            path: event.payload.path,
            progress: { current: event.payload.current, total: event.payload.total },
          });
      }),
      listen('import-complete', () => {
        if (isEffectActive) {
          useProcessStore.getState().setImportState({ status: Status.Success });
          refs.current.refreshAllFolderTrees();
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (currentPath) {
            refs.current.handleSelectSubfolder(currentPath, false);
          }
        }
      }),
      listen('import-error', (event: any) => {
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            status: Status.Error,
            errorMessage: typeof event.payload === 'string' ? event.payload : 'Unknown error',
          });
      }),
      listen('denoise-progress', (event: any) => {
        if (isEffectActive)
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: { ...state.denoiseModalState, progressMessage: event.payload as string },
          }));
      }),
      listen('denoise-complete', (event: any) => {
        if (isEffectActive) {
          const payload = event.payload;
          const isObject = typeof payload === 'object' && payload !== null;
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: {
              ...state.denoiseModalState,
              isProcessing: false,
              previewBase64: isObject ? payload.denoised : payload,
              originalBase64: isObject ? payload.original : null,
              progressMessage: null,
            },
          }));
        }
      }),
      listen('denoise-error', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: {
              ...state.denoiseModalState,
              isProcessing: false,
              error: String(event.payload),
              progressMessage: null,
            },
          }));
        }
      }),
      listen('wgpu-frame-ready', (event: any) => {
        if (isEffectActive && event.payload?.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor({ hasRenderedFirstFrame: true });
        }
      }),
      // A freshly baked crystal grain texture lives outside `adjustments`, so
      // bump the render generation to make the new grain visible immediately
      // (no fake adjustments update → no undo-history pollution).
      listen('crystal-grain-baked', () => {
        if (isEffectActive) {
          useEditorStore.getState().setEditor((state) => ({ renderGeneration: state.renderGeneration + 1 }));
        }
      }),
      listen('panorama-progress', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => {
            if (state.panoramaModalState.finalImageBase64 || state.panoramaModalState.error) return state;
            return { panoramaModalState: { ...state.panoramaModalState, progressMessage: event.payload } };
          });
        }
      }),
      listen('panorama-complete', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            panoramaModalState: {
              ...state.panoramaModalState,
              error: null,
              finalImageBase64: event.payload.base64,
              isProcessing: false,
              progressMessage: null,
            },
          }));
        }
      }),
      listen('panorama-error', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            panoramaModalState: {
              ...state.panoramaModalState,
              error: String(event.payload),
              finalImageBase64: null,
              isProcessing: false,
              progressMessage: null,
            },
          }));
        }
      }),
      listen('hdr-progress', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            hdrModalState: {
              ...state.hdrModalState,
              error: null,
              finalImageBase64: null,
              isOpen: true,
              progressMessage: event.payload,
            },
          }));
        }
      }),
      listen('hdr-complete', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            hdrModalState: {
              ...state.hdrModalState,
              error: null,
              finalImageBase64: event.payload.base64,
              isProcessing: false,
              progressMessage: 'Hdr Ready',
            },
          }));
        }
      }),
      listen('hdr-error', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            hdrModalState: {
              ...state.hdrModalState,
              error: String(event.payload),
              finalImageBase64: null,
              isProcessing: false,
              progressMessage: 'An error occurred.',
            },
          }));
        }
      }),
      listen('culling-start', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: {
              ...state.cullingModalState,
              isOpen: true,
              progress: { current: 0, total: event.payload, stage: 'Initializing...' },
              suggestions: null,
              error: null,
            },
          }));
        }
      }),
      listen('culling-progress', (event: any) => {
        if (isEffectActive) {
          useUIStore
            .getState()
            .setUI((state) => ({ cullingModalState: { ...state.cullingModalState, progress: event.payload } }));
        }
      }),
      listen('culling-complete', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: { ...state.cullingModalState, progress: null, suggestions: event.payload },
          }));
        }
      }),
      listen('culling-error', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: { ...state.cullingModalState, progress: null, error: String(event.payload) },
          }));
        }
      }),
      listen<FolderImportStartedPayload>('folder-import-started', (event) => {
        if (isEffectActive) {
          const { path, recursive, kind } = event.payload;
          useFolderImportStore.getState().startJob(path, recursive, kind);
        }
      }),
      listen<FolderImportScanPayload>('folder-import-scan', (event) => {
        if (isEffectActive) {
          const { path, recursive, discovered } = event.payload;
          useFolderImportStore.getState().setScanProgress(folderJobKey(path, recursive), discovered);
        }
      }),
      listen<FolderImportBatchPayload>('folder-import-batch', (event) => {
        if (!isEffectActive) return;
        const { path, recursive, files, scanned, total } = event.payload;
        const key = folderJobKey(path, recursive);
        const store = useFolderImportStore.getState();
        const job = store.jobs[key];
        const isFirstBatch = job && !job.hasReceivedBatch;
        store.appendBatch(key, files, scanned, total);
        if (isFirstBatch && isFolderOnScreen(path, recursive)) {
          useLibraryStore.getState().setLibrary({ isViewLoading: false });
        }
        // New files may live in subfolders that are not yet in the folder tree.
        // Refresh lazily so the tree updates as the import progresses without
        // rebuilding on every single batch.
        scheduleTreeRefresh();
      }),
      listen<FolderImportPhaseStartPayload>('folder-import-exif-started', (event) => {
        if (isEffectActive) {
          const { path, recursive, total } = event.payload;
          useFolderImportStore.getState().setExifProgress(folderJobKey(path, recursive), 0, total);
        }
      }),
      listen<FolderImportPhaseProgressPayload>('folder-import-exif-progress', (event) => {
        if (isEffectActive) {
          const { path, recursive, current, total } = event.payload;
          useFolderImportStore.getState().setExifProgress(folderJobKey(path, recursive), current, total);
        }
      }),
      listen<FolderImportPhaseStartPayload>('folder-import-thumbs-started', (event) => {
        if (isEffectActive) {
          const { path, recursive, total } = event.payload;
          useFolderImportStore.getState().setThumbsProgress(folderJobKey(path, recursive), 0, total);
        }
      }),
      listen<FolderImportPhaseProgressPayload>('folder-import-thumbs-progress', (event) => {
        if (isEffectActive) {
          const { path, recursive, current, total } = event.payload;
          useFolderImportStore.getState().setThumbsProgress(folderJobKey(path, recursive), current, total);
        }
      }),
      listen<FolderImportCompletePayload>('folder-import-complete', (event) => {
        if (!isEffectActive) return;
        const { path, recursive, errors } = event.payload;
        const key = folderJobKey(path, recursive);
        // Make sure the final tree state is reflected immediately, even if a
        // throttled refresh from the last batch is still pending.
        flushTreeRefresh();
        useFolderImportStore.getState().completeJob(key, errors);
        if (errors > 0) {
          toast.warn(t('folderImport.completeWithErrors', { folder: path, count: errors }));
        } else {
          toast.success(t('folderImport.complete', { folder: path }));
        }
        // Batch files streamed during the import carry exif: null (phase 2
        // writes EXIF only to the catalog). When the completed folder is the
        // one on screen, reload its catalog pages so imageList gains exif for
        // sorting and the metadata columns; background folders keep their
        // batch files. On failure the existing files stay as they are.
        if (!isFolderOnScreen(path, recursive)) {
          return;
        }
        useLibraryStore.getState().setLibrary({ isViewLoading: false });
        loadFolderFromCatalog(path, recursive)
          .then((files) => {
            if (!isEffectActive || files.length === 0) return;
            useFolderImportStore.getState().setFiles(key, files);
          })
          .catch((err) => console.error('Failed to refresh folder files from catalog:', err));
      }),
      listen<FolderImportCancelledPayload>('folder-import-cancelled', (event) => {
        if (!isEffectActive) return;
        const { path, recursive } = event.payload;
        useFolderImportStore.getState().cancelJob(folderJobKey(path, recursive));
        toast.info(t('folderImport.cancelled', { folder: path }));
        if (isFolderOnScreen(path, recursive)) {
          useLibraryStore.getState().setLibrary({ isViewLoading: false });
        }
      }),
      listen<FolderImportErrorPayload>('folder-import-error', (event) => {
        if (!isEffectActive) return;
        const { path, recursive, message } = event.payload;
        useFolderImportStore.getState().failJob(folderJobKey(path, recursive), message);
        toast.error(t('folderImport.error', { folder: path, message }));
        if (isFolderOnScreen(path, recursive)) {
          useLibraryStore.getState().setLibrary({ isViewLoading: false });
        }
      }),
      listen<FolderLocatedPayload>('folder-located', (event) => {
        if (!isEffectActive) return;
        const { oldPath, newPath } = event.payload;
        const currentFolderAffected = applyFolderRelocation(oldPath, newPath);
        refs.current.refreshAllFolderTrees();
        if (currentFolderAffected) {
          refs.current.refreshImageList();
        }
      }),
      listen<FolderImportCatalogReadyPayload>('folder-import-catalog-ready', (event) => {
        if (!isEffectActive) return;
        const { path, recursive } = event.payload;
        const key = folderJobKey(path, recursive);
        // The backend found the folder already cataloged and runs no job, so
        // no batches ever arrive: page the full listing out of the catalog
        // instead. Pages stream into the job (mirroring to imageList as they
        // land), then the optimistic job is resolved — it would sit in phase
        // 'scan' forever otherwise. total stays 0 (unknown); scanned counts
        // the files loaded so far. startJob first: this event fires before
        // the start_folder_import invoke resolves, so when the payload's
        // canonical path differs from the optimistic raw-path key no job
        // exists here yet (startJob no-ops when one does).
        useFolderImportStore.getState().startJob(path, recursive);
        if (isFolderOnScreen(path, recursive)) {
          useLibraryStore.getState().setLibrary({ isViewLoading: false });
        }
        loadFolderFromCatalog(path, recursive, (page, scanned) => {
          if (!isEffectActive) return;
          useFolderImportStore.getState().appendBatch(key, page, scanned, 0);
        })
          .then((files) => {
            if (!isEffectActive) return;
            const store = useFolderImportStore.getState();
            if (files.length > 0) {
              store.completeJob(key, 0);
            } else {
              // An empty catalog means nothing to show; drop the job.
              store.clearJob(key);
            }
          })
          .catch((err) => {
            if (!isEffectActive) return;
            console.error('Failed to load folder files from catalog:', err);
            useFolderImportStore.getState().clearJob(key);
          });
      }),
    ];

    return () => {
      isEffectActive = false;
      if (flushHandle.current !== null) {
        cancelAnimationFrame(flushHandle.current);
        flushHandle.current = null;
      }
      if (treeRefreshTimeoutRef.current !== null) {
        window.clearTimeout(treeRefreshTimeoutRef.current);
        treeRefreshTimeoutRef.current = null;
      }
      thumbnailBuffer.current = {};
      ratingBuffer.current = {};
      listeners.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, []);
}
