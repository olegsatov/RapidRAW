import { useCallback } from 'react';
import { Adjustments, PasteMode } from '../utils/adjustments';
import { Preset } from '../components/ui/AppProperties';
import { usePresetStore } from '../store/usePresetStore';

export { PresetListType } from '../store/usePresetStore';
export type { UserPreset } from '../store/usePresetStore';

export function usePresets(currentAdjustments: Adjustments) {
  const store = usePresetStore();

  const addPreset = useCallback(
    (
      name: string,
      folderId: string | null = null,
      mode: PasteMode = PasteMode.Replace,
      includedAdjustments: string[] = [],
    ) => store.addPreset(currentAdjustments, name, folderId, mode, includedAdjustments),
    [store, currentAdjustments],
  );

  const overwritePreset = useCallback(
    (id: string | null) => store.overwritePreset(currentAdjustments, id),
    [store, currentAdjustments],
  );

  return {
    addFolder: store.addFolder,
    addPreset,
    configurePreset: store.configurePreset,
    deleteItem: store.deleteItem,
    duplicatePreset: store.duplicatePreset,
    exportPresetsToFile: store.exportPresetsToFile,
    importPresetsFromFile: store.importPresetsFromFile,
    importLegacyPresetsFromFile: store.importLegacyPresetsFromFile,
    isLoading: store.isLoading,
    movePreset: store.movePreset,
    overwritePreset,
    presets: store.presets,
    refreshPresets: store.loadPresets,
    renameItem: store.renameItem,
    reorderItems: store.reorderItems,
    sortAllPresetsAlphabetically: store.sortAllPresetsAlphabetically,
  };
}
