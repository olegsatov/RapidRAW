import { create } from 'zustand';

export interface ArchiveProgress {
  current: number;
  total: number;
  currentFile: string | null;
}

export interface ArchiveState {
  isArchiving: boolean;
  sourcePath: string | null;
  targetRoot: string | null;
  progress: ArchiveProgress;
  errorMessage: string | null;
}

interface ArchiveStore extends ArchiveState {
  startArchive: (sourcePath: string, targetRoot: string, total: number) => void;
  setProgress: (progress: Partial<ArchiveProgress>) => void;
  setError: (errorMessage: string) => void;
  finishArchive: () => void;
  reset: () => void;
}

const initialState: ArchiveState = {
  isArchiving: false,
  sourcePath: null,
  targetRoot: null,
  progress: { current: 0, total: 0, currentFile: null },
  errorMessage: null,
};

export const useArchiveStore = create<ArchiveStore>((set) => ({
  ...initialState,

  startArchive: (sourcePath, targetRoot, total) =>
    set({
      isArchiving: true,
      sourcePath,
      targetRoot,
      progress: { current: 0, total, currentFile: null },
      errorMessage: null,
    }),

  setProgress: (progress) =>
    set((state) => ({
      progress: { ...state.progress, ...progress },
    })),

  setError: (errorMessage) => set({ isArchiving: false, errorMessage }),

  finishArchive: () => set({ isArchiving: false }),

  reset: () => set(initialState),
}));
