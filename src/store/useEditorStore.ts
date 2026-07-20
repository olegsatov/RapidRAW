import { create } from 'zustand';
import { Adjustments, INITIAL_ADJUSTMENTS, MaskContainer, AiPatch } from '../utils/adjustments';
import { arraysEqual, computeHistoryDeltas, getChangedTopLevelKeys, HistoryDelta } from '../utils/historyUtils';
import { SelectedImage, WaveformData, BrushSettings } from '../components/ui/AppProperties';
import { ChannelConfig } from '../components/adjustments/Curves';
import { ImageDimensions } from '../hooks/useImageRenderSize';
import { ToolType } from '../components/panel/right/Masks';
import { OverlayMode } from '../components/panel/right/CropPanel';

export const HISTORY_LIMIT = 100;

export interface InteractivePatch {
  url: string;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
}

interface EditorState {
  // Core Image & Adjustments
  selectedImage: SelectedImage | null;
  adjustments: Adjustments;
  previewOverride: Adjustments | null;

  // History State
  history: Adjustments[];
  historyIndex: number;
  historyDeltas: HistoryDelta[][];
  historyLabels: (string | null)[];

  // Previews & Overlays
  finalPreviewUrl: string | null;
  uncroppedAdjustedPreviewUrl: string | null;
  transformedOriginalUrl: string | null;
  interactivePatch: InteractivePatch | null;
  showOriginal: boolean;

  // Analytics
  histogram: ChannelConfig | null;
  waveform: WaveformData | null;
  isWaveformVisible: boolean;
  activeWaveformChannel: string;
  waveformHeight: number;

  // Interaction State
  isSliderDragging: boolean;
  zoom: number;
  displaySize: ImageDimensions;
  previewSize: ImageDimensions;
  baseRenderSize: ImageDimensions;
  originalSize: ImageDimensions;

  // Render nudge: bumped by out-of-band GPU state changes (e.g. a freshly
  // baked crystal grain texture) to force a re-render without touching
  // `adjustments` (which would pollute undo history and trigger a save).
  renderGeneration: number;

  // Tools State
  isRotationActive: boolean;
  overlayMode: OverlayMode;
  overlayRotation: number;
  isStraightenActive: boolean;
  isWbPickerActive: boolean;
  liveRotation: number | null;
  brushSettings: BrushSettings | null;

  // Masks & AI
  activeMaskContainerId: string | null;
  activeMaskId: string | null;
  activeAiPatchContainerId: string | null;
  activeAiSubMaskId: string | null;
  isMaskControlHovered: boolean;
  isGeneratingAiMask: boolean;
  isGeneratingAi: boolean;
  isAIConnectorConnected: boolean;
  hasRenderedFirstFrame: boolean;
  patchesSentToBackend: Set<string>;

  // Clipboard
  copiedSectionAdjustments: any | null;
  copiedMask: MaskContainer | null;
  copiedAdjustments: Adjustments | null;

  // Actions
  setEditor: (updater: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void;
  setHistoryDeltas: (deltas: HistoryDelta[][]) => void;
  pushHistory: (newAdjustments: Adjustments) => void;
  pushNamedSnapshot: (name: string) => void;
  undo: () => void;
  redo: () => void;
  resetHistory: (initialState: Adjustments) => void;
  restoreHistory: (
    history: Adjustments[],
    historyIndex: number,
    historyDeltas?: HistoryDelta[][],
    historyLabels?: (string | null)[],
  ) => void;
  goToHistoryIndex: (index: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedImage: null,
  adjustments: INITIAL_ADJUSTMENTS,
  previewOverride: null,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  historyDeltas: [[]],
  historyLabels: [null],

  finalPreviewUrl: null,
  uncroppedAdjustedPreviewUrl: null,
  showOriginal: false,
  histogram: null,
  waveform: null,
  isWaveformVisible: false,
  activeWaveformChannel: 'luma',
  waveformHeight: 220,

  isSliderDragging: false,
  interactivePatch: null,
  activeMaskContainerId: null,
  activeMaskId: null,
  activeAiPatchContainerId: null,
  activeAiSubMaskId: null,

  renderGeneration: 0,

  zoom: 1,
  displaySize: { width: 0, height: 0 },
  previewSize: { width: 0, height: 0 },
  baseRenderSize: { width: 0, height: 0 },
  originalSize: { width: 0, height: 0 },

  isRotationActive: false,
  overlayMode: 'thirds',
  overlayRotation: 0,
  transformedOriginalUrl: null,
  isStraightenActive: false,
  isWbPickerActive: false,
  liveRotation: null,

  copiedSectionAdjustments: null,
  copiedMask: null,
  brushSettings: { size: 50, feather: 50, tool: ToolType.Brush },
  copiedAdjustments: null,

  isGeneratingAiMask: false,
  isAIConnectorConnected: false,
  isGeneratingAi: false,
  isMaskControlHovered: false,
  hasRenderedFirstFrame: false,
  patchesSentToBackend: new Set<string>(),

  setEditor: (updater) => set((state) => (typeof updater === 'function' ? updater(state) : updater)),
  setHistoryDeltas: (deltas) => set(() => ({ historyDeltas: deltas })),

  pushHistory: (newAdj) =>
    set((state) => {
      const current = state.history[state.historyIndex];
      if (JSON.stringify(current) === JSON.stringify(newAdj)) return state;

      const delta = computeHistoryDeltas(current, newAdj);
      const newChanged = getChangedTopLevelKeys(current, newAdj);
      const atEnd = state.historyIndex === state.history.length - 1;

      if (atEnd && state.historyIndex > 0) {
        const lastChanged = getChangedTopLevelKeys(state.history[state.historyIndex - 1], current);
        if (arraysEqual(newChanged, lastChanged)) {
          const newHistory = state.history.slice(0, state.historyIndex);
          newHistory.push(newAdj);
          const newDeltas = state.historyDeltas.slice(0, state.historyIndex);
          newDeltas.push(delta);
          const newLabels = state.historyLabels.slice(0, state.historyIndex);
          // Preserve any user-given label on the step being replaced.
          newLabels.push(state.historyLabels[state.historyIndex] ?? null);
          return {
            history: newHistory,
            historyIndex: state.historyIndex,
            adjustments: newAdj,
            historyDeltas: newDeltas,
            historyLabels: newLabels,
          };
        }
      }

      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(newAdj);
      const newDeltas = state.historyDeltas.slice(0, state.historyIndex + 1);
      newDeltas.push(delta);
      const newLabels = state.historyLabels.slice(0, state.historyIndex + 1);
      newLabels.push(null);
      if (newHistory.length > HISTORY_LIMIT) {
        newHistory.shift();
        newDeltas.shift();
        newLabels.shift();
      }
      return {
        history: newHistory,
        historyIndex: newHistory.length - 1,
        adjustments: newAdj,
        historyDeltas: newDeltas,
        historyLabels: newLabels,
      };
    }),

  pushNamedSnapshot: (name) =>
    set((state) => {
      const current = state.history[state.historyIndex];
      if (state.historyIndex > 0) {
        const prev = state.history[state.historyIndex - 1];
        if (JSON.stringify(prev) === JSON.stringify(current)) {
          // No actual change from the previous step; just label it.
          const newLabels = [...state.historyLabels];
          newLabels[state.historyIndex] = name;
          return { historyLabels: newLabels };
        }
      }

      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(current);
      const newDeltas = state.historyDeltas.slice(0, state.historyIndex + 1);
      newDeltas.push([]);
      const newLabels = state.historyLabels.slice(0, state.historyIndex + 1);
      newLabels.push(name);
      if (newHistory.length > HISTORY_LIMIT) {
        newHistory.shift();
        newDeltas.shift();
        newLabels.shift();
      }
      return {
        history: newHistory,
        historyIndex: newHistory.length - 1,
        adjustments: current,
        historyDeltas: newDeltas,
        historyLabels: newLabels,
      };
    }),

  undo: () =>
    set((state) => {
      if (state.historyIndex > 0) {
        const newIndex = state.historyIndex - 1;
        return { historyIndex: newIndex, adjustments: state.history[newIndex] };
      }
      return state;
    }),

  redo: () =>
    set((state) => {
      if (state.historyIndex < state.history.length - 1) {
        const newIndex = state.historyIndex + 1;
        return { historyIndex: newIndex, adjustments: state.history[newIndex] };
      }
      return state;
    }),

  resetHistory: (initialState) =>
    set(() => ({
      history: [initialState],
      historyIndex: 0,
      adjustments: initialState,
      historyDeltas: [[]],
      historyLabels: [null],
    })),

  restoreHistory: (history, historyIndex, historyDeltas, historyLabels) =>
    set(() => {
      if (history.length === 0) return {} as Partial<EditorState>;
      const clamped = Math.min(Math.max(historyIndex, 0), history.length - 1);
      return {
        history,
        historyIndex: clamped,
        adjustments: history[clamped],
        historyDeltas: historyDeltas ?? Array.from({ length: history.length }, () => []),
        historyLabels: historyLabels ?? Array.from({ length: history.length }, () => null),
      };
    }),

  goToHistoryIndex: (index) =>
    set((state) => {
      if (index >= 0 && index < state.history.length) {
        return { historyIndex: index, adjustments: state.history[index] };
      }
      return state;
    }),
}));
