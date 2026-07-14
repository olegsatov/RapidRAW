import { Preset } from '../components/ui/AppProperties';
import {
  ADJUSTMENT_GROUPS,
  Adjustments,
  COPYABLE_ADJUSTMENT_KEYS,
  INITIAL_ADJUSTMENTS,
  LensAdjustment,
  PasteMode,
} from './adjustments';

const MASK_KEYS = ADJUSTMENT_GROUPS.masks.flatMap((group) => group.keys);
const GEOMETRY_KEYS = ADJUSTMENT_GROUPS.geometry.flatMap((group) => group.keys);

export function getPresetMode(preset: Preset): PasteMode {
  if (preset.mode) {
    return preset.mode;
  }
  return preset.presetType === 'tool' ? PasteMode.Merge : PasteMode.Replace;
}

export function getPresetIncludedAdjustments(preset: Preset): string[] {
  if (preset.includedAdjustments) {
    return [...preset.includedAdjustments];
  }

  let keys = [...COPYABLE_ADJUSTMENT_KEYS];

  const hasMasks = preset.includeMasks ?? ((preset.adjustments?.masks && preset.adjustments.masks.length > 0) || false);
  const hasGeometry =
    preset.includeCropTransform ?? (GEOMETRY_KEYS.some((key) => preset.adjustments?.[key] !== undefined) || false);

  if (!hasMasks) {
    keys = keys.filter((key) => !MASK_KEYS.includes(key));
  }
  if (!hasGeometry) {
    keys = keys.filter((key) => !GEOMETRY_KEYS.includes(key));
  }

  return keys;
}

export function normalizePreset(preset: Preset): Preset {
  const {
    presetType: _presetType,
    includeMasks: _includeMasks,
    includeCropTransform: _includeCropTransform,
    ...rest
  } = preset;
  return {
    ...rest,
    mode: getPresetMode(preset),
    includedAdjustments: getPresetIncludedAdjustments(preset),
    hotkey: preset.hotkey ?? null,
  };
}

export function getEffectivePresetAdjustments(preset: Preset): Partial<Adjustments> {
  const mode = getPresetMode(preset);
  const included = new Set(getPresetIncludedAdjustments(preset));
  const result: Partial<Adjustments> = {};

  for (const key of included) {
    if (Object.prototype.hasOwnProperty.call(preset.adjustments, key)) {
      const value = preset.adjustments[key];
      if (mode === PasteMode.Merge) {
        const defaultValue = INITIAL_ADJUSTMENTS[key as keyof Adjustments];
        if (JSON.stringify(value) !== JSON.stringify(defaultValue)) {
          result[key as keyof Adjustments] = value;
        }
      } else {
        result[key as keyof Adjustments] = value;
      }
    }
  }

  if (
    included.has(LensAdjustment.LensMaker) &&
    Object.prototype.hasOwnProperty.call(preset.adjustments, LensAdjustment.LensMaker) &&
    !result.lensMaker
  ) {
    result.lensDistortionParams = null;
  }

  return result;
}
