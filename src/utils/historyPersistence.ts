import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../store/useEditorStore';
import { Panel } from '../components/ui/AppProperties';
import type { Adjustments } from './adjustments';
import type { HistoryDelta } from './historyUtils';

const SAVE_DELAY_MS = 500;

interface HistoryEntry {
  adjustments_json: string;
  label: string | null;
  source: string | null;
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
  source: string;
}

interface DeltaPayload {
  step_index: number;
  idx: number;
  adjustment_key: string;
  old_value: string | null;
  new_value: string;
  description: string | null;
  created_at: number;
  source: string;
}

interface SaveEditHistoryPayload {
  path: string;
  snapshot: SnapshotPayload;
  deltas: DeltaPayload[];
  history_index: number;
  current_adjustments_json: string;
}

interface PendingState {
  path: string;
  history: Adjustments[];
  historyIndex: number;
  historyDeltas: HistoryDelta[][];
  historyLabels: (string | null)[];
  historySources: (Panel | null)[];
}

let pendingState: PendingState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function runSave(state: PendingState): Promise<void> {
  if (state.history.length <= 1) {
    return;
  }

  const snapshot: SnapshotPayload = {
    idx: 0,
    adjustments_json: JSON.stringify(state.history[0]),
    description: state.historyLabels[0] ?? null,
    created_at: Date.now(),
    source: state.historySources[0] ?? '',
  };

  const deltas: DeltaPayload[] = [];
  for (let step = 1; step < state.history.length; step++) {
    const stepDeltas = state.historyDeltas[step] ?? [];
    const stepLabel = state.historyLabels[step] ?? null;
    const stepSource = state.historySources[step] ?? '';
    for (let i = 0; i < stepDeltas.length; i++) {
      const d = stepDeltas[i];
      deltas.push({
        step_index: step - 1,
        idx: i,
        adjustment_key: d.adjustment_key,
        old_value: d.old_value,
        new_value: d.new_value,
        description: i === 0 ? stepLabel : null,
        created_at: Date.now(),
        source: stepSource,
      });
    }
  }

  const currentAdjustments = state.history[state.historyIndex];

  const payload: SaveEditHistoryPayload = {
    path: state.path,
    snapshot,
    deltas,
    history_index: state.historyIndex,
    current_adjustments_json: JSON.stringify(currentAdjustments),
  };

  await invoke('save_edit_history', { payload });
}

function takePendingState(): PendingState | null {
  const state = pendingState;
  pendingState = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return state;
}

export async function flushHistoryPersistence(): Promise<void> {
  const state = takePendingState();
  if (!state) {
    return;
  }
  await runSave(state);
}

export function scheduleHistoryPersistence(
  path: string,
  history: Adjustments[],
  historyIndex: number,
  historyDeltas: HistoryDelta[][],
  historyLabels: (string | null)[],
  historySources: (Panel | null)[],
): void {
  pendingState = {
    path,
    history,
    historyIndex,
    historyDeltas,
    historyLabels,
    historySources,
  };

  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const state = takePendingState();
    if (!state) {
      return;
    }
    runSave(state).catch((err) => {
      console.error('Failed to persist edit history:', err);
    });
  }, SAVE_DELAY_MS);
}

export async function loadPersistedHistory(path: string): Promise<{
  history: Adjustments[];
  historyIndex: number;
  historyDeltas: HistoryDelta[][];
  historyLabels: (string | null)[];
  historySources?: (Panel | null)[];
} | null> {
  try {
    console.log('[history-persistence] loading history for', path);
    const response = await invoke<LoadEditHistoryResponse>('load_edit_history', { path });
    console.log(
      '[history-persistence] load_edit_history returned',
      response.history.length,
      'entries, index',
      response.history_index,
    );
    if (!response.history || response.history.length <= 1) {
      console.log('[history-persistence] ignoring persisted history: length <= 1');
      return null;
    }

    const history: Adjustments[] = [];
    const historyDeltas: HistoryDelta[][] = [];
    const historyLabels: (string | null)[] = [];
    const historySources: (Panel | null)[] = [];
    for (let i = 0; i < response.history.length; i++) {
      history.push(JSON.parse(response.history[i].adjustments_json) as Adjustments);
      historyDeltas.push([]);
      historyLabels.push(response.history[i].label ?? null);
      historySources.push((response.history[i].source ?? null) as Panel | null);
    }

    console.log('[history-persistence] restored', history.length, 'states, index', response.history_index);

    return {
      history,
      historyIndex: response.history_index,
      historyDeltas,
      historyLabels,
      historySources,
    };
  } catch (err) {
    console.error('[history-persistence] load_edit_history failed for', path, err);
    return null;
  }
}

export function subscribeHistoryPersistence(): () => void {
  const unsubscribe = useEditorStore.subscribe((state) => {
    const { selectedImage, history, historyIndex, historyDeltas, historyLabels, historySources } = state;
    if (selectedImage?.path && history.length > 1) {
      scheduleHistoryPersistence(
        selectedImage.path,
        history,
        historyIndex,
        historyDeltas,
        historyLabels,
        historySources,
      );
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
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };
}
