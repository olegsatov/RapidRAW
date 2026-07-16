import debounce from 'lodash.debounce';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings, Invokes, LutFileSettings } from '../components/ui/AppProperties';
import { useSettingsStore } from '../store/useSettingsStore';
import { Adjustments, INITIAL_ADJUSTMENTS } from './adjustments';

export interface ResolvedLutParams {
  intensity: number;
  timing: 'after' | 'before';
  inputRange: number;
  inputOffset: number;
}

export const DEFAULT_LUT_PARAMS: ResolvedLutParams = {
  intensity: INITIAL_ADJUSTMENTS.lutIntensity ?? 100,
  timing: INITIAL_ADJUSTMENTS.lutTiming ?? 'before',
  inputRange: INITIAL_ADJUSTMENTS.lutInputRange ?? 6,
  inputOffset: INITIAL_ADJUSTMENTS.lutInputOffset ?? 0,
};

// Per-LUT params are global (keyed by LUT file path in AppSettings): selecting
// a LUT restores them, tweaking a slider saves them, and LUT thumbnails render
// with them. The image sidecar still keeps the concrete per-image values.
export function resolveLutParams(appSettings: AppSettings | null, path: string): ResolvedLutParams {
  const stored = appSettings?.lutSettings?.[path];
  return {
    intensity: stored?.intensity ?? DEFAULT_LUT_PARAMS.intensity,
    timing: stored?.timing ?? DEFAULT_LUT_PARAMS.timing,
    inputRange: stored?.inputRange ?? DEFAULT_LUT_PARAMS.inputRange,
    inputOffset: stored?.inputOffset ?? DEFAULT_LUT_PARAMS.inputOffset,
  };
}

export function lutParamsToAdjustments(params: ResolvedLutParams): Partial<Adjustments> {
  return {
    lutIntensity: params.intensity,
    lutTiming: params.timing,
    lutNormalizeMode: params.timing === 'before' ? 'hdr' : 'clamp',
    lutInputRange: params.inputRange,
    lutInputOffset: params.inputOffset,
  };
}

const debouncedPersistSettings = debounce(() => {
  const { appSettings } = useSettingsStore.getState();
  if (!appSettings) return;
  const { searchCriteria: _searchCriteria, ...settingsToSave } = appSettings as any;
  invoke(Invokes.SaveSettings, { settings: settingsToSave }).catch((err) => {
    console.error('Failed to save LUT settings:', err);
  });
}, 400);

export function saveLutParams(path: string | null | undefined, patch: LutFileSettings) {
  if (!path) return;
  const { appSettings, setAppSettings } = useSettingsStore.getState();
  if (!appSettings) return;
  const lutSettings = { ...(appSettings.lutSettings ?? {}) };
  lutSettings[path] = { ...lutSettings[path], ...patch };
  setAppSettings({ ...appSettings, lutSettings });
  debouncedPersistSettings();
}
