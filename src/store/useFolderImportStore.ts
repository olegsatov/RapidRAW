import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { ImageFile } from '../components/ui/AppProperties';

export type ImportPhase = 'scan' | 'exif' | 'thumbnails' | 'complete' | 'cancelled' | 'error';

export interface FolderImportJob {
  path: string;
  recursive: boolean;
  kind?: 'import' | 'sync';
  phase: ImportPhase;
  discovered: number;
  scanned: number;
  total: number;
  exifCurrent: number;
  exifTotal: number;
  thumbsCurrent: number;
  thumbsTotal: number;
  files: ImageFile[];
  errors: number;
  errorMessage?: string;
  hasReceivedBatch: boolean;
}

export type FolderAvailability = 'unknown' | 'online' | 'offline';

interface FolderImportState {
  jobs: Record<string, FolderImportJob>;
  availability: Record<string, FolderAvailability>;
  startJob: (path: string, recursive: boolean, kind?: 'import' | 'sync') => void;
  appendBatch: (key: string, files: ImageFile[], scanned: number, total: number) => void;
  setPhase: (key: string, phase: ImportPhase) => void;
  setScanProgress: (key: string, discovered: number) => void;
  setExifProgress: (key: string, current: number, total: number) => void;
  setThumbsProgress: (key: string, current: number, total: number) => void;
  completeJob: (key: string, errors: number) => void;
  cancelJob: (key: string) => void;
  failJob: (key: string, message: string) => void;
  clearJob: (key: string) => void;
  setFiles: (key: string, files: ImageFile[]) => void;
  setAvailability: (path: string, status: 'online' | 'offline') => void;
  checkAvailability: (paths: string[]) => Promise<void>;
}

// Jobs are keyed the same way as the backend job map so concurrent flat and
// recursive jobs for the same folder do not collide.
export const folderJobKey = (path: string, recursive: boolean): string => `${path}|${recursive}`;

// Payloads of the backend `folder-import-*` event stream (see
// src-tauri/src/folder_import.rs). Every payload carries path + recursive so
// listeners rebuild the job key with folderJobKey.
export interface FolderImportEventPayload {
  path: string;
  recursive: boolean;
}

export interface FolderImportStartedPayload extends FolderImportEventPayload {
  kind: 'import' | 'sync';
}

export interface FolderImportScanPayload extends FolderImportEventPayload {
  discovered: number;
}

export interface FolderImportBatchPayload extends FolderImportEventPayload {
  files: ImageFile[];
  scanned: number;
  total: number;
}

export interface FolderImportPhaseStartPayload extends FolderImportEventPayload {
  total: number;
}

export interface FolderImportPhaseProgressPayload extends FolderImportEventPayload {
  current: number;
  total: number;
}

export interface FolderImportCompletePayload extends FolderImportEventPayload {
  total: number;
  errors: number;
}

export interface FolderImportCancelledPayload extends FolderImportEventPayload {
  processed: number;
}

export interface FolderImportErrorPayload extends FolderImportEventPayload {
  message: string;
}

export interface FolderImportCatalogReadyPayload extends FolderImportEventPayload {
  folderId: number;
}

export const useFolderImportStore = create<FolderImportState>((set) => {
  const updateJob = (key: string, updater: (job: FolderImportJob) => Partial<FolderImportJob>) =>
    set((state) => {
      const job = state.jobs[key];
      if (!job) {
        return state;
      }
      return { jobs: { ...state.jobs, [key]: { ...job, ...updater(job) } } };
    });

  return {
    jobs: {},
    availability: {},

    startJob: (path, recursive, kind) =>
      set((state) => {
        const key = folderJobKey(path, recursive);
        if (state.jobs[key]) {
          return state;
        }
        return {
          jobs: {
            ...state.jobs,
            [key]: {
              path,
              recursive,
              kind,
              phase: 'scan',
              discovered: 0,
              scanned: 0,
              total: 0,
              exifCurrent: 0,
              exifTotal: 0,
              thumbsCurrent: 0,
              thumbsTotal: 0,
              files: [],
              errors: 0,
              hasReceivedBatch: false,
            },
          },
        };
      }),

    appendBatch: (key, files, scanned, total) =>
      updateJob(key, (job) => ({
        phase: 'scan',
        files: [...job.files, ...files],
        scanned,
        total,
        hasReceivedBatch: true,
      })),

    setPhase: (key, phase) => updateJob(key, () => ({ phase })),

    setScanProgress: (key, discovered) => updateJob(key, () => ({ phase: 'scan', discovered })),

    setExifProgress: (key, current, total) =>
      updateJob(key, () => ({ phase: 'exif', exifCurrent: current, exifTotal: total })),

    setThumbsProgress: (key, current, total) =>
      updateJob(key, () => ({ phase: 'thumbnails', thumbsCurrent: current, thumbsTotal: total })),

    completeJob: (key, errors) => updateJob(key, (job) => (job.phase === 'error' ? {} : { phase: 'complete', errors })),

    cancelJob: (key) => updateJob(key, () => ({ phase: 'cancelled' })),

    failJob: (key, message) => updateJob(key, () => ({ phase: 'error', errorMessage: message })),

    clearJob: (key) =>
      set((state) => {
        if (!state.jobs[key]) {
          return state;
        }
        const jobs = { ...state.jobs };
        delete jobs[key];
        return { jobs };
      }),

    setFiles: (key, files) => updateJob(key, () => ({ files })),

    setAvailability: (path, status) =>
      set((state) => ({
        availability: { ...state.availability, [path]: status },
      })),

    checkAvailability: async (paths) => {
      const trimmed = paths.filter(Boolean);
      if (trimmed.length === 0) {
        return;
      }
      const results = await Promise.all(
        trimmed.map(async (path) => {
          try {
            const exists = await invoke<boolean>('check_path_exists', { path });
            return { path, status: exists ? 'online' : 'offline' } as const;
          } catch (err) {
            console.error(`Failed to check availability for ${path}:`, err);
            return { path, status: 'offline' } as const;
          }
        }),
      );
      set((state) => {
        const availability = { ...state.availability };
        for (const { path, status } of results) {
          availability[path] = status;
        }
        return { availability };
      });
    },
  };
});
