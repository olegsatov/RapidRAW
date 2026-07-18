import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../store/useEditorStore';
import type { Adjustments } from './adjustments';
import type { HistoryDelta } from './historyUtils';

const SAVE_DELAY_MS = 2000;

interface HistoryEntry {
  adjustments_json: string;
  label: string | null;
}

interface LoadEditHistoryResponse {
  history: HistoryEntry[];
  history_index: number;
}

interface SnapshotPayload {
  idx: number;
  adjustments_json: string;
  description: string | null;
  created_at: number;
}

interface DeltaPayload {
  step_index: number;
  idx: number;
  adjustment_key: string;
  old_value: string | null;
  new_value: string;
  description: string | null;
  created_at: number;
}

interface SaveEditHistoryPayload {
  path: string;
  snapshot: SnapshotPayload;
  deltas: DeltaPayload[];
  history_index: number;
  current_adjustments_json: string;
}

let pendingPath: string | null = null;
let pendingHistory: Adjustments[] | null = null;
let pendingHistoryIndex: number | null = null;
let pendingHistoryDeltas: HistoryDelta[][] | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;

function debouncedSave() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    flushHistoryPersistence().catch((err) => {
      console.error('Failed to persist edit history:', err);
    });
  }, SAVE_DELAY_MS);
}

export async function flushHistoryPersistence(): Promise<void> {
  if (flushPromise) {
    return flushPromise;
  }

  flushPromise = (async () => {
    try {
      if (!pendingPath || !pendingHistory || pendingHistoryIndex === null || !pendingHistoryDeltas) {
        return;
      }

      const path = pendingPath;
      const history = pendingHistory;
      const historyIndex = pendingHistoryIndex;
      const historyDeltas = pendingHistoryDeltas;

      pendingPath = null;
      pendingHistory = null;
      pendingHistoryIndex = null;
      pendingHistoryDeltas = null;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      if (history.length <= 1) {
        return;
      }

      const snapshot: SnapshotPayload = {
        idx: 0,
        adjustments_json: JSON.stringify(history[0]),
        description: null,
        created_at: Date.now(),
      };

      const deltas: DeltaPayload[] = [];
      for (let step = 1; step < history.length; step++) {
        const stepDeltas = historyDeltas[step] ?? [];
        for (let i = 0; i < stepDeltas.length; i++) {
          const d = stepDeltas[i];
          deltas.push({
            step_index: step - 1,
            idx: i,
            adjustment_key: d.adjustment_key,
            old_value: d.old_value,
            new_value: d.new_value,
            description: i === 0 ? null : null, // labels are stored per-step, not per-delta in Phase 2
            created_at: Date.now(),
          });
        }
      }

      const currentAdjustments = history[historyIndex];

      const payload: SaveEditHistoryPayload = {
        path,
        snapshot,
        deltas,
        history_index: historyIndex,
        current_adjustments_json: JSON.stringify(currentAdjustments),
      };

      await invoke('save_edit_history', { payload });
    } finally {
      flushPromise = null;
    }
  })();

  return flushPromise;
}

export function scheduleHistoryPersistence(
  path: string,
  history: Adjustments[],
  historyIndex: number,
  historyDeltas: HistoryDelta[][],
): void {
  pendingPath = path;
  pendingHistory = history;
  pendingHistoryIndex = historyIndex;
  pendingHistoryDeltas = historyDeltas;
  debouncedSave();
}

export async function loadPersistedHistory(
  path: string,
): Promise<{ history: Adjustments[]; historyIndex: number; historyDeltas: HistoryDelta[][] } | null> {
  try {
    const response = await invoke<LoadEditHistoryResponse>('load_edit_history', { path });
    if (!response.history || response.history.length <= 1) {
      return null;
    }

    const history: Adjustments[] = [];
    const historyDeltas: HistoryDelta[][] = [];
    for (let i = 0; i < response.history.length; i++) {
      history.push(JSON.parse(response.history[i].adjustments_json) as Adjustments);
      historyDeltas.push([]);
    }

    return {
      history,
      historyIndex: response.history_index,
      historyDeltas,
    };
  } catch (err) {
    console.error('Failed to load persisted edit history:', err);
    return null;
  }
}

export function subscribeHistoryPersistence(): () => void {
  const unsubscribe = useEditorStore.subscribe((state) => {
    const { selectedImage, history, historyIndex, historyDeltas } = state;
    if (selectedImage?.path && history.length > 1) {
      scheduleHistoryPersistence(selectedImage.path, history, historyIndex, historyDeltas);
    }
  });

  const handleBeforeUnload = () => {
    flushHistoryPersistence().catch((err) => {
      console.error('Failed to flush history on beforeunload:', err);
    });
  };

  window.addEventListener('beforeunload', handleBeforeUnload);

  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', handleBeforeUnload);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };
}
