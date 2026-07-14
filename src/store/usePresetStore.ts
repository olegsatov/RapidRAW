import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';
import { Adjustments, COPYABLE_ADJUSTMENT_KEYS, INITIAL_ADJUSTMENTS, PasteMode } from '../utils/adjustments';
import {
  normalizePreset,
  getPresetMode,
  getPresetIncludedAdjustments,
  PRESET_SECTION_VISIBILITY_KEYS,
} from '../utils/presetUtils';
import { Folder, Invokes, Preset } from '../components/ui/AppProperties';

export enum PresetListType {
  Folder = 'folder',
  Preset = 'preset',
}

export interface UserPreset {
  folder?: Folder;
  id?: string | undefined;
  name?: string | undefined;
  preset?: Preset;
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const newArray = array.slice();
  const [item] = newArray.splice(from, 1);
  newArray.splice(to, 0, item);
  return newArray;
}

function normalizeUserPresetItem(item: UserPreset): UserPreset {
  if (!item || typeof item !== 'object') {
    return item;
  }
  if (item.preset && typeof item.preset === 'object') {
    return { preset: normalizePreset(item.preset) };
  }
  if (item.folder && typeof item.folder === 'object') {
    return {
      folder: {
        ...item.folder,
        children: Array.isArray(item.folder.children)
          ? item.folder.children
              .filter((child): child is Preset => child && typeof child === 'object')
              .map((child) => normalizePreset(child))
          : [],
      },
    };
  }
  return item;
}

interface PresetState {
  presets: Array<UserPreset>;
  isLoading: boolean;

  loadPresets: () => Promise<void>;
  setPresets: (presets: Array<UserPreset>) => void;
  savePresets: () => void;

  addPreset: (
    currentAdjustments: Adjustments,
    name: string,
    folderId: string | null,
    mode: PasteMode,
    includedAdjustments: string[],
  ) => Preset | null;
  addFolder: (name: string) => void;
  deleteItem: (id: string) => void;
  renameItem: (id: string | null, newName: string) => void;
  configurePreset: (id: string | null, name: string, mode: PasteMode, includedAdjustments: string[]) => Preset | null;
  overwritePreset: (currentAdjustments: Adjustments, id: string | null) => Preset | null;
  duplicatePreset: (presetId: string | null) => Preset | null;
  movePreset: (presetId: string, targetFolderId: string | null, overId?: string | null) => void;
  reorderItems: (activeId: string, overId: string) => void;
  sortAllPresetsAlphabetically: () => void;
  importPresetsFromFile: (filePath: string) => Promise<void>;
  importLegacyPresetsFromFile: (filePath: string) => Promise<void>;
  exportPresetsToFile: (presetsToExport: Array<any>, filePath: string) => Promise<void>;
  updatePreset: (id: string, updater: (preset: Preset) => Preset) => void;
  findPresetById: (id: string | null) => Preset | null;
  flattenPresets: () => Array<Preset>;
}

const buildPresetAdjustments = (
  currentAdjustments: Adjustments,
  mode: PasteMode,
  includedAdjustments: string[],
): Record<string, any> => {
  const presetAdjustments: Record<string, any> = {};
  const includedSet = new Set(includedAdjustments);

  for (const key of includedAdjustments) {
    if (Object.prototype.hasOwnProperty.call(currentAdjustments, key)) {
      const currentValue = currentAdjustments[key as keyof Adjustments];
      if (mode === PasteMode.Merge) {
        const defaultValue = INITIAL_ADJUSTMENTS[key as keyof Adjustments];
        if (JSON.stringify(currentValue) !== JSON.stringify(defaultValue)) {
          presetAdjustments[key] = currentValue;
        }
      } else {
        presetAdjustments[key] = currentValue;
      }
    }
  }

  // Persist the visibility state of Film-tab sections alongside their
  // parameters so presets can turn sections on/off, not just supply values.
  const sectionVisibility: Record<string, boolean> = {};
  for (const [section, keys] of Object.entries(PRESET_SECTION_VISIBILITY_KEYS)) {
    if (keys.some((key) => includedSet.has(key))) {
      sectionVisibility[section] =
        currentAdjustments.sectionVisibility[section as keyof Adjustments['sectionVisibility']] ?? false;
    }
  }
  if (Object.keys(sectionVisibility).length > 0) {
    presetAdjustments.sectionVisibility = sectionVisibility;
  }

  return presetAdjustments;
};

export const usePresetStore = create<PresetState>((set, get) => {
  const savePresetsToBackend = debounce(() => {
    const presetsToSave = get().presets;
    invoke(Invokes.SavePresets, { presets: presetsToSave }).catch((err) =>
      console.error('Failed to save presets:', err),
    );
  }, 500);

  return {
    presets: [],
    isLoading: true,

    loadPresets: async () => {
      set({ isLoading: true });
      try {
        const loadedPresets: Array<UserPreset> = await invoke(Invokes.LoadPresets);
        const normalized = loadedPresets.map(normalizeUserPresetItem);
        const changed = JSON.stringify(normalized) !== JSON.stringify(loadedPresets);
        set({ presets: normalized });
        if (changed) {
          savePresetsToBackend();
        }
      } catch (error) {
        console.error('Failed to load presets:', error);
        set({ presets: [] });
      } finally {
        set({ isLoading: false });
      }
    },

    setPresets: (presets) => {
      set({ presets });
      savePresetsToBackend();
    },

    savePresets: () => {
      savePresetsToBackend();
    },

    addPreset: (currentAdjustments, name, folderId = null, mode = PasteMode.Replace, includedAdjustments) => {
      const { presets } = get();
      const presetAdjustments = buildPresetAdjustments(
        currentAdjustments,
        mode,
        includedAdjustments.length > 0 ? includedAdjustments : COPYABLE_ADJUSTMENT_KEYS,
      );

      const newPresetData: Preset = {
        adjustments: presetAdjustments,
        id: crypto.randomUUID(),
        name,
        mode,
        includedAdjustments,
        hotkey: null,
      };

      let updatedPresets: Array<UserPreset>;
      if (folderId) {
        updatedPresets = presets.map((item: UserPreset) => {
          if (item.folder && item.folder.id === folderId) {
            return {
              folder: {
                ...item.folder,
                children: [...item.folder.children, newPresetData],
              },
            };
          }
          return item;
        });
      } else {
        updatedPresets = [...presets, { preset: newPresetData }];
      }

      set({ presets: updatedPresets });
      savePresetsToBackend();
      return newPresetData;
    },

    addFolder: (name) => {
      const newFolder = {
        folder: {
          id: crypto.randomUUID(),
          name,
          children: [],
        },
      };

      set((state) => {
        const updatedPresets = [...state.presets];
        const firstPresetIndex = updatedPresets.findIndex((p: UserPreset) => p.preset);

        if (firstPresetIndex === -1) {
          updatedPresets.push(newFolder);
        } else {
          updatedPresets.splice(firstPresetIndex, 0, newFolder);
        }

        savePresetsToBackend();
        return { presets: updatedPresets };
      });
    },

    deleteItem: (id) => {
      set((state) => {
        let updatedPresets = state.presets.filter(
          (item: UserPreset) => item.preset?.id !== id && item.folder?.id !== id,
        );
        updatedPresets = updatedPresets.map((item: UserPreset) => {
          if (item.folder) {
            return {
              folder: {
                ...item.folder,
                children: item.folder.children.filter((child: any) => child.id !== id),
              },
            };
          }
          return item;
        });
        savePresetsToBackend();
        return { presets: updatedPresets };
      });
    },

    renameItem: (id, newName) => {
      set((state) => {
        const updatedPresets = state.presets.map((item: UserPreset) => {
          if (item.preset?.id === id) {
            return { preset: { ...item.preset, name: newName } };
          }
          if (item.folder?.id === id) {
            return { folder: { ...item.folder, name: newName } };
          }
          if (item.folder) {
            return {
              folder: {
                ...item.folder,
                children: item.folder.children.map((child: any) =>
                  child.id === id ? { ...child, name: newName } : child,
                ),
              },
            };
          }
          return item;
        });
        savePresetsToBackend();
        return { presets: updatedPresets };
      });
    },

    configurePreset: (id, name, mode, includedAdjustments) => {
      let updatedPreset: Preset | null = null;

      set((state) => {
        const updatedPresets = state.presets.map((item: UserPreset) => {
          if (item.preset?.id === id) {
            updatedPreset = {
              ...normalizePreset(item.preset),
              name,
              mode,
              includedAdjustments,
            };
            return { preset: updatedPreset };
          }
          if (item.folder) {
            let found = false;
            const newChildren = item.folder.children.map((child: Preset) => {
              if (child.id === id) {
                found = true;
                updatedPreset = {
                  ...normalizePreset(child),
                  name,
                  mode,
                  includedAdjustments,
                };
                return updatedPreset;
              }
              return child;
            });
            if (found) {
              return { folder: { ...item.folder, children: newChildren } };
            }
          }
          return item;
        });
        savePresetsToBackend();
        return { presets: updatedPresets };
      });

      return updatedPreset;
    },

    overwritePreset: (currentAdjustments, id) => {
      const existingPreset = get().findPresetById(id);
      if (!existingPreset) return null;

      const mode = getPresetMode(existingPreset);
      const includedAdjustments = getPresetIncludedAdjustments(existingPreset);
      const presetAdjustments = buildPresetAdjustments(currentAdjustments, mode, includedAdjustments);

      let updatedPreset: Preset | null = null;

      set((state) => {
        const updatedPresets = state.presets.map((item: UserPreset) => {
          if (item.preset?.id === id) {
            updatedPreset = {
              ...normalizePreset(item.preset),
              adjustments: presetAdjustments,
            };
            return { preset: updatedPreset };
          }
          if (item.folder) {
            let found = false;
            const newChildren = item.folder.children.map((child: Preset) => {
              if (child.id === id) {
                found = true;
                updatedPreset = {
                  ...normalizePreset(child),
                  adjustments: presetAdjustments,
                };
                return updatedPreset;
              }
              return child;
            });
            if (found) {
              return { folder: { ...item.folder, children: newChildren } };
            }
          }
          return item;
        });
        savePresetsToBackend();
        return { presets: updatedPresets };
      });

      return updatedPreset;
    },

    duplicatePreset: (presetId) => {
      let presetToDuplicate: Preset | null = null;
      let sourceFolderId: string | null = null;
      const { presets } = get();

      for (const item of presets) {
        if (item.preset?.id === presetId) {
          presetToDuplicate = item.preset;
          break;
        }
        if (item.folder) {
          const found = item.folder.children.find((p: any) => p.id === presetId);
          if (found) {
            presetToDuplicate = found;
            sourceFolderId = item.folder.id ?? null;
            break;
          }
        }
      }

      if (!presetToDuplicate) {
        return null;
      }

      const newPreset: Preset = {
        adjustments: JSON.parse(JSON.stringify(presetToDuplicate.adjustments)),
        id: crypto.randomUUID(),
        name: `${presetToDuplicate.name} Copy`,
        mode: getPresetMode(presetToDuplicate),
        includedAdjustments: getPresetIncludedAdjustments(presetToDuplicate),
        hotkey: null,
      };

      let updatedPresets: Array<UserPreset>;
      if (sourceFolderId) {
        updatedPresets = presets.map((item: UserPreset) => {
          if (item.folder?.id === sourceFolderId) {
            const originalIndex = item.folder.children.findIndex((p: any) => p.id === presetId);
            const newChildren = [...item.folder.children];
            newChildren.splice(originalIndex + 1, 0, newPreset);
            return { folder: { ...item.folder, children: newChildren } };
          }
          return item;
        });
      } else {
        const originalIndex = presets.findIndex((item: UserPreset) => item.preset?.id === presetId);
        updatedPresets = [...presets];
        updatedPresets.splice(originalIndex + 1, 0, { preset: newPreset });
      }

      set({ presets: updatedPresets });
      savePresetsToBackend();
      return newPreset;
    },

    movePreset: (presetId, targetFolderId, overId = null) => {
      let presetToMove: Preset | null = null;
      let sourceFolderId: string | null = null;
      const { presets } = get();

      for (const item of presets) {
        if (item.preset?.id === presetId) {
          presetToMove = item.preset;
          break;
        }
        if (item.folder) {
          const found = item.folder.children.find((p: any) => p.id === presetId);
          if (found) {
            presetToMove = found;
            sourceFolderId = item.folder.id ?? null;
            break;
          }
        }
      }

      if (!presetToMove) {
        return;
      }

      let updatedPresets = [...presets];

      if (sourceFolderId) {
        updatedPresets = updatedPresets.map((item: UserPreset) =>
          item.folder?.id === sourceFolderId
            ? { folder: { ...item.folder, children: item.folder.children.filter((p: any) => p.id !== presetId) } }
            : item,
        );
      } else {
        updatedPresets = updatedPresets.filter((item: UserPreset) => item.preset?.id !== presetId);
      }

      if (targetFolderId) {
        updatedPresets = updatedPresets.map((item: UserPreset) => {
          if (item.folder?.id === targetFolderId) {
            const newChildren = [...item.folder.children];
            if (overId) {
              const overIndex = newChildren.findIndex((p) => p.id === overId);
              if (overIndex !== -1) {
                newChildren.splice(overIndex, 0, presetToMove!);
              } else {
                newChildren.push(presetToMove!);
              }
            } else {
              newChildren.push(presetToMove!);
            }
            return { folder: { ...item.folder, children: newChildren } };
          }
          return item;
        });
      } else {
        if (overId) {
          const overIndex = updatedPresets.findIndex(
            (item) => item.preset?.id === overId || item.folder?.id === overId,
          );
          if (overIndex !== -1) {
            updatedPresets.splice(overIndex, 0, { preset: presetToMove });
          } else {
            updatedPresets.push({ preset: presetToMove });
          }
        } else {
          updatedPresets.push({ preset: presetToMove });
        }
      }

      set({ presets: updatedPresets });
      savePresetsToBackend();
    },

    reorderItems: (activeId, overId) => {
      set((state) => {
        const currentPresets = state.presets;
        const getIndex = (arr: Array<UserPreset>, id: string) =>
          arr.findIndex((item: UserPreset) => item.preset?.id === id || item.folder?.id === id || item?.id === id);

        const activeRootIndex = getIndex(currentPresets, activeId);
        const overRootIndex = getIndex(currentPresets, overId);

        if (activeRootIndex !== -1 && overRootIndex !== -1) {
          const newPresets: Array<UserPreset> = arrayMove(currentPresets, activeRootIndex, overRootIndex);
          savePresetsToBackend();
          return { presets: newPresets };
        }

        for (const item of currentPresets) {
          if (item.folder) {
            const activeChildIndex = getIndex(item.folder.children, activeId);
            const overChildIndex = getIndex(item.folder.children, overId);

            if (activeChildIndex !== -1 && overChildIndex !== -1) {
              const newPresets = currentPresets.map((p: UserPreset) => {
                if (p.folder?.id === item.folder?.id) {
                  return {
                    folder: {
                      ...p?.folder,
                      children: arrayMove(p.folder?.children, activeChildIndex, overChildIndex),
                    },
                  };
                }
                return p;
              });
              savePresetsToBackend();
              return { presets: newPresets };
            }
          }
        }

        return { presets: currentPresets };
      });
    },

    sortAllPresetsAlphabetically: () => {
      set((state) => {
        const newPresets: Array<UserPreset> = JSON.parse(JSON.stringify(state.presets));
        const sortOptions = { numeric: true, sensitivity: 'base' };

        newPresets.forEach((item: UserPreset) => {
          if (item.folder && item.folder.children) {
            item.folder.children.sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, sortOptions));
          }
        });

        const folders = newPresets.filter((item: UserPreset) => item.folder);
        const rootPresets = newPresets.filter((item: UserPreset) => item.preset);

        folders.sort((a: any, b: any) => a.folder.name.localeCompare(b.folder.name, undefined, sortOptions));
        rootPresets.sort((a: any, b: any) => a.preset.name.localeCompare(b.preset.name, undefined, sortOptions));

        const sortedPresets = [...folders, ...rootPresets];
        savePresetsToBackend();
        return { presets: sortedPresets };
      });
    },

    importPresetsFromFile: async (filePath) => {
      set({ isLoading: true });
      try {
        const updatedPresetList: Array<any> = await invoke(Invokes.HandleImportPresetsFromFile, { filePath });
        const normalized = updatedPresetList.map(normalizeUserPresetItem);
        set({ presets: normalized });
        savePresetsToBackend();
      } catch (error) {
        console.error('Failed to import presets from file:', error);
        throw error;
      } finally {
        set({ isLoading: false });
      }
    },

    importLegacyPresetsFromFile: async (filePath) => {
      set({ isLoading: true });
      try {
        const updatedPresetList: Array<UserPreset> = await invoke(Invokes.HandleImportLegacyPresetsFromFile, {
          filePath,
        });
        const normalized = updatedPresetList.map(normalizeUserPresetItem);
        set({ presets: normalized });
        savePresetsToBackend();
      } catch (error) {
        console.error('Failed to import legacy presets from file:', error);
        throw error;
      } finally {
        set({ isLoading: false });
      }
    },

    exportPresetsToFile: async (presetsToExport, filePath) => {
      try {
        await invoke(Invokes.HandleExportPresetsToFile, { presetsToExport, filePath });
      } catch (error) {
        console.error('Failed to export presets to file:', error);
        throw error;
      }
    },

    updatePreset: (id, updater) => {
      set((state) => {
        const updatedPresets = state.presets.map((item: UserPreset) => {
          if (item.preset?.id === id) {
            return { preset: updater(item.preset) };
          }
          if (item.folder) {
            return {
              folder: {
                ...item.folder,
                children: item.folder.children.map((child: Preset) => (child.id === id ? updater(child) : child)),
              },
            };
          }
          return item;
        });
        savePresetsToBackend();
        return { presets: updatedPresets };
      });
    },

    findPresetById: (id) => {
      for (const item of get().presets) {
        if (item.preset?.id === id) {
          return item.preset;
        }
        if (item.folder) {
          const found = item.folder.children.find((p: Preset) => p.id === id);
          if (found) return found;
        }
      }
      return null;
    },

    flattenPresets: () => {
      const result: Array<Preset> = [];
      for (const item of get().presets) {
        if (item.preset) {
          result.push(item.preset);
        } else if (item.folder) {
          result.push(...item.folder.children);
        }
      }
      return result;
    },
  };
});
