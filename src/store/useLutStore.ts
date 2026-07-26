import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';
import { AppSettings, LutFolder } from '../components/ui/AppProperties';
import { useSettingsStore } from './useSettingsStore';

export interface LutEntry {
  name: string;
  path: string;
}

export enum LutListType {
  Folder = 'folder',
  Lut = 'lut',
}

export interface LutDisplayItem {
  type: LutListType.Lut;
  entry: LutEntry;
}

export interface LutFolderItem {
  type: LutListType.Folder;
  folder: LutFolder;
}

export type LutListItem = LutDisplayItem | LutFolderItem;

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const next = array.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

interface LutState {
  entries: LutEntry[];
  folders: LutFolder[];
  order: string[];
  favorites: Set<string>;
  isLoading: boolean;

  loadLuts: () => Promise<void>;
  addFolder: (name: string) => void;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string, moveChildrenToRoot: boolean) => void;
  moveLutToFolder: (path: string, folderId: string | null, overPath?: string | null) => void;
  reorderLut: (activePath: string, overPath: string) => void;
  reorderFolderLut: (folderId: string, activePath: string, overPath: string) => void;
  reorderFolder: (activeId: string, overId: string) => void;
  toggleFavorite: (path: string) => void;
  setViewMode: (mode: 'compact' | 'expanded') => void;
  viewMode: 'compact' | 'expanded';
}

let pendingPatch: Partial<AppSettings> = {};

const flushSettings = debounce(() => {
  const current = useSettingsStore.getState().appSettings;
  if (!current) return;
  const patch = pendingPatch;
  pendingPatch = {};
  const next = { ...current, ...patch };
  useSettingsStore
    .getState()
    .handleSettingsChange(next)
    .catch((err) => console.error('Failed to save LUT settings:', err));
}, 500);

const saveSettings = (patch: Partial<AppSettings>) => {
  pendingPatch = { ...pendingPatch, ...patch };
  flushSettings();
};

export const useLutStore = create<LutState>((set) => ({
  entries: [],
  folders: [],
  order: [],
  favorites: new Set(),
  isLoading: true,
  viewMode: 'expanded',

  loadLuts: async () => {
    set({ isLoading: true });
    try {
      const entries = await invoke<LutEntry[]>('list_luts');
      const settings = useSettingsStore.getState().appSettings;
      const rawFolders = settings?.lutFolders ?? [];
      const rawOrder = settings?.lutOrder ?? [];
      const rawFavorites = settings?.lutFavorites ?? [];

      // Clean up stale paths from folders/order/favorites.
      const existingPaths = new Set(entries.map((e) => e.path));
      const folders = rawFolders.map((f) => ({
        ...f,
        children: f.children.filter((p) => existingPaths.has(p)),
      }));
      const order = rawOrder.filter((p) => existingPaths.has(p));
      const favorites = new Set(rawFavorites.filter((p) => existingPaths.has(p)));

      set({
        entries,
        folders,
        order,
        favorites,
        viewMode: settings?.lutViewMode ?? 'expanded',
        isLoading: false,
      });

      const foldersChanged =
        folders.length !== rawFolders.length ||
        folders.some((f, i) => f.id !== rawFolders[i].id || !stringArraysEqual(f.children, rawFolders[i].children));
      const orderChanged = !stringArraysEqual(order, rawOrder);
      const favoritesChanged = !stringArraysEqual([...favorites].sort(), [...rawFavorites].sort());

      if (foldersChanged || orderChanged || favoritesChanged) {
        saveSettings({ lutFolders: folders, lutOrder: order, lutFavorites: [...favorites] });
      }
    } catch (error) {
      console.error('Failed to load LUTs:', error);
      set({ isLoading: false });
    }
  },

  addFolder: (name: string) => {
    set((state) => {
      const newFolder: LutFolder = { id: crypto.randomUUID(), name, children: [] };
      const folders = [...state.folders, newFolder];
      saveSettings({ lutFolders: folders });
      return { folders };
    });
  },

  renameFolder: (id: string, name: string) => {
    set((state) => {
      const folders = state.folders.map((f) => (f.id === id ? { ...f, name } : f));
      saveSettings({ lutFolders: folders });
      return { folders };
    });
  },

  deleteFolder: (id: string, moveChildrenToRoot: boolean) => {
    set((state) => {
      const folder = state.folders.find((f) => f.id === id);
      const children = folder?.children ?? [];
      const remainingFolders = state.folders.filter((f) => f.id !== id);
      let order = state.order;
      // Folder children are not in root order; moving them to root makes them
      // ordered root items, otherwise they remain visible as unordered entries.
      if (moveChildrenToRoot) {
        order = [...order, ...children.filter((p) => !state.order.includes(p))];
      }
      saveSettings({ lutFolders: remainingFolders, lutOrder: order });
      return { folders: remainingFolders, order };
    });
  },

  moveLutToFolder: (path: string, folderId: string | null, overPath: string | null = null) => {
    set((state) => {
      const sourceFolder = state.folders.find((f) => f.children.includes(path)) ?? null;
      if (folderId && !state.folders.some((f) => f.id === folderId)) {
        return state;
      }
      let folders = state.folders;
      let order = state.order;

      if (sourceFolder) {
        folders = folders.map((f) =>
          f.id === sourceFolder.id ? { ...f, children: f.children.filter((p) => p !== path) } : f,
        );
      } else {
        order = order.filter((p) => p !== path);
      }

      if (folderId) {
        folders = folders.map((f) => {
          if (f.id !== folderId) return f;
          const newChildren = [...f.children];
          if (overPath) {
            const overIndex = newChildren.indexOf(overPath);
            if (overIndex !== -1) newChildren.splice(overIndex, 0, path);
            else newChildren.push(path);
          } else {
            newChildren.push(path);
          }
          return { ...f, children: newChildren };
        });
      } else {
        const newOrder = [...order];
        if (overPath) {
          const overIndex = newOrder.indexOf(overPath);
          if (overIndex !== -1) newOrder.splice(overIndex, 0, path);
          else newOrder.push(path);
        } else {
          newOrder.push(path);
        }
        order = newOrder;
      }

      saveSettings({ lutFolders: folders, lutOrder: order });
      return { folders, order };
    });
  },

  reorderLut: (activePath: string, overPath: string) => {
    set((state) => {
      const from = state.order.indexOf(activePath);
      const to = state.order.indexOf(overPath);
      if (from === -1 || to === -1) return state;
      const order = arrayMove(state.order, from, to);
      saveSettings({ lutOrder: order });
      return { order };
    });
  },

  reorderFolderLut: (folderId: string, activePath: string, overPath: string) => {
    set((state) => {
      const folder = state.folders.find((f) => f.id === folderId);
      if (!folder) return state;
      const from = folder.children.indexOf(activePath);
      const to = folder.children.indexOf(overPath);
      if (from === -1 || to === -1) return state;
      const children = arrayMove(folder.children, from, to);
      const folders = state.folders.map((f) => (f.id === folderId ? { ...f, children } : f));
      saveSettings({ lutFolders: folders });
      return { folders };
    });
  },

  reorderFolder: (activeId: string, overId: string) => {
    set((state) => {
      const from = state.folders.findIndex((f) => f.id === activeId);
      const to = state.folders.findIndex((f) => f.id === overId);
      if (from === -1 || to === -1) return state;
      const folders = arrayMove(state.folders, from, to);
      saveSettings({ lutFolders: folders });
      return { folders };
    });
  },

  toggleFavorite: (path: string) => {
    set((state) => {
      const favorites = new Set(state.favorites);
      if (favorites.has(path)) favorites.delete(path);
      else favorites.add(path);
      saveSettings({ lutFavorites: [...favorites] });
      return { favorites };
    });
  },

  setViewMode: (mode: 'compact' | 'expanded') => {
    set({ viewMode: mode });
    saveSettings({ lutViewMode: mode });
  },
}));
