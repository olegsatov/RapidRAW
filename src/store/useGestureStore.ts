import { create } from 'zustand';

export interface GestureOverlayParam {
  label: string;
  axisLabels: [string, string];
  values: [number, number];
  min: [number, number];
  max: [number, number];
  orientation?: 'both' | 'vertical';
  invert?: [boolean, boolean];
}

interface GestureOverlayState {
  action: string | null;
  isActive: boolean;
  params: GestureOverlayParam[];
}

interface GestureOverlayActions {
  startOverlay: (action: string, params: GestureOverlayParam[]) => void;
  setParams: (params: GestureOverlayParam[]) => void;
  endOverlay: () => void;
}

export const useGestureStore = create<GestureOverlayState & GestureOverlayActions>((set) => ({
  action: null,
  isActive: false,
  params: [],

  startOverlay: (action, params) => set({ action, isActive: true, params }),

  setParams: (params) => set({ params }),

  endOverlay: () => set({ action: null, isActive: false, params: [] }),
}));
