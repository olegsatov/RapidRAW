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
  offsetCompensation: boolean;
  wbTemperatureShift: number;
  wbTintShift: number;
  flimContrast: number;
  flimLights: number;
  flimShadows: number;
  saturation: number;
  vibrance: number;
}

export const DEFAULT_LUT_PARAMS: ResolvedLutParams = {
  intensity: INITIAL_ADJUSTMENTS.lutIntensity ?? 100,
  timing: INITIAL_ADJUSTMENTS.lutTiming ?? 'before',
  inputRange: INITIAL_ADJUSTMENTS.lutInputRange ?? 6,
  inputOffset: INITIAL_ADJUSTMENTS.lutInputOffset ?? 0,
  offsetCompensation: INITIAL_ADJUSTMENTS.lutOffsetCompensation ?? false,
  wbTemperatureShift: INITIAL_ADJUSTMENTS.lutWbTemperatureShift ?? 0,
  wbTintShift: INITIAL_ADJUSTMENTS.lutWbTintShift ?? 0,
  flimContrast: INITIAL_ADJUSTMENTS.lutFlimContrast ?? 0,
  flimLights: INITIAL_ADJUSTMENTS.lutFlimLights ?? 0,
  flimShadows: INITIAL_ADJUSTMENTS.lutFlimShadows ?? 0,
  saturation: INITIAL_ADJUSTMENTS.lutSaturation ?? 0,
  vibrance: INITIAL_ADJUSTMENTS.lutVibrance ?? 0,
};

// Per-LUT params are global defaults (keyed by LUT file path in AppSettings):
// selecting a LUT restores them, and LUT thumbnails render with them. The image
// sidecar keeps the concrete per-image values; "Save as default" copies them
// back to AppSettings.
export function resolveLutParams(appSettings: AppSettings | null, path: string): ResolvedLutParams {
  const stored = appSettings?.lutSettings?.[path];
  return {
    intensity: stored?.intensity ?? DEFAULT_LUT_PARAMS.intensity,
    timing: stored?.timing ?? DEFAULT_LUT_PARAMS.timing,
    inputRange: stored?.inputRange ?? DEFAULT_LUT_PARAMS.inputRange,
    inputOffset: stored?.inputOffset ?? DEFAULT_LUT_PARAMS.inputOffset,
    offsetCompensation: stored?.offsetCompensation ?? DEFAULT_LUT_PARAMS.offsetCompensation,
    wbTemperatureShift: stored?.wbTemperatureShift ?? DEFAULT_LUT_PARAMS.wbTemperatureShift,
    wbTintShift: stored?.wbTintShift ?? DEFAULT_LUT_PARAMS.wbTintShift,
    flimContrast: stored?.flimContrast ?? DEFAULT_LUT_PARAMS.flimContrast,
    flimLights: stored?.flimLights ?? DEFAULT_LUT_PARAMS.flimLights,
    flimShadows: stored?.flimShadows ?? DEFAULT_LUT_PARAMS.flimShadows,
    saturation: stored?.saturation ?? DEFAULT_LUT_PARAMS.saturation,
    vibrance: stored?.vibrance ?? DEFAULT_LUT_PARAMS.vibrance,
  };
}

// Per-image LUT params override the global defaults for the current image.
// They live in the image sidecar (Adjustments.lutPerImageParams) and take
// precedence over AppSettings.lutSettings when a LUT is selected or previewed.
export function getEffectiveLutParams(
  appSettings: AppSettings | null,
  adjustments: Adjustments,
  path: string,
): ResolvedLutParams {
  return adjustments.lutPerImageParams?.[path] ?? resolveLutParams(appSettings, path);
}

export function resolvedLutParamsToLutFileSettings(params: ResolvedLutParams): LutFileSettings {
  return {
    intensity: params.intensity,
    timing: params.timing,
    inputRange: params.inputRange,
    inputOffset: params.inputOffset,
    offsetCompensation: params.offsetCompensation,
    wbTemperatureShift: params.wbTemperatureShift,
    wbTintShift: params.wbTintShift,
    flimContrast: params.flimContrast,
    flimLights: params.flimLights,
    flimShadows: params.flimShadows,
    saturation: params.saturation,
    vibrance: params.vibrance,
  };
}

export function lutParamsToAdjustments(params: ResolvedLutParams): Partial<Adjustments> {
  // LUTs are always applied before the tonemapper; coerce any stored timing.
  const timing = 'before' as const;
  return {
    lutIntensity: params.intensity,
    lutTiming: timing,
    lutNormalizeMode: timing === 'before' ? 'hdr' : 'clamp',
    lutInputRange: params.inputRange,
    lutInputOffset: params.inputOffset,
    lutOffsetCompensation: params.offsetCompensation,
    lutWbTemperatureShift: params.wbTemperatureShift,
    lutWbTintShift: params.wbTintShift,
    lutFlimContrast: params.flimContrast,
    lutFlimLights: params.flimLights,
    lutFlimShadows: params.flimShadows,
    lutSaturation: params.saturation,
    lutVibrance: params.vibrance,
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
