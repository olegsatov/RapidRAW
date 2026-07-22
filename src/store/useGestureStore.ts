import { create } from 'zustand';

export interface GestureOverlayParam {
  label: string;
  axisLabels: [string, string];
  values: [number, number];
  min: [number, number];
  max: [number, number];
  orientation?: 'both' | 'vertical' | 'horizontal';
  invert?: [boolean, boolean];
}

export interface LutStripEntry {
  path: string;
  name: string;
  thumb: string | null;
}

export interface LutStripState {
  entries: LutStripEntry[];
  selectedIndex: number;
  isLoading: boolean;
}

interface GestureOverlayState {
  action: string | null;
  isActive: boolean;
  params: GestureOverlayParam[];
  lutStrip: LutStripState | null;
}

interface GestureOverlayActions {
  startOverlay: (action: string, params: GestureOverlayParam[]) => void;
  setParams: (params: GestureOverlayParam[]) => void;
  startLutStrip: (entries: LutStripEntry[], selectedIndex: number) => void;
  setLutStripSelectedIndex: (index: number) => void;
  setLutStripThumb: (path: string, thumb: string | null) => void;
  setLutStripLoading: (isLoading: boolean) => void;
  endOverlay: () => void;
}

export const useGestureStore = create<GestureOverlayState & GestureOverlayActions>((set) => ({
  action: null,
  isActive: false,
  params: [],
  lutStrip: null,

  startOverlay: (action, params) => set({ action, isActive: true, params }),

  setParams: (params) => set({ params }),

  startLutStrip: (entries, selectedIndex) => set({ lutStrip: { entries, selectedIndex, isLoading: true } }),

  setLutStripSelectedIndex: (selectedIndex) =>
    set((state) => ({ lutStrip: state.lutStrip ? { ...state.lutStrip, selectedIndex } : null })),

  setLutStripThumb: (path, thumb) =>
    set((state) => ({
      lutStrip: state.lutStrip
        ? {
            ...state.lutStrip,
            entries: state.lutStrip.entries.map((e) => (e.path === path ? { ...e, thumb } : e)),
          }
        : null,
    })),

  setLutStripLoading: (isLoading) =>
    set((state) => ({
      lutStrip: state.lutStrip ? { ...state.lutStrip, isLoading } : null,
    })),

  endOverlay: () => set({ action: null, isActive: false, params: [], lutStrip: null }),
}));
