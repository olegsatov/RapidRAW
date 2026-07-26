import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  Check,
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  ImageOff,
  LayoutGrid,
  List,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'react-toastify';

import Slider from '../../ui/Slider';
import Text from '../../ui/Text';
import type { LutFileSettings, LutFolder } from '../../ui/AppProperties';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLutStore, type LutEntry, type LutListItem, LutListType } from '../../../store/useLutStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';
import ConfigureLutHotkeyModal from '../../modals/ConfigureLutHotkeyModal';
import CreateFolderModal from '../../modals/CreateFolderModal';
import RenameFolderModal from '../../modals/RenameFolderModal';
import { Adjustments, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import {
  DEFAULT_LUT_PARAMS,
  ResolvedLutParams,
  getEffectiveLutParams,
  lutParamsToAdjustments,
  resolveLutParams,
  resolvedLutParamsToLutFileSettings,
  saveLutParams,
} from '../../../utils/lutSettings';
import { formatKeyCode } from '../../../utils/keyboardUtils';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';

interface LutPreview {
  path: string;
  thumb: string | null;
}

interface LutsPanelProps {
  isVisible: boolean;
  panelWidth: number;
}

const PREVIEW_SIZE = 600;

export default function LutsPanel({ isVisible, panelWidth }: LutsPanelProps) {
  const { t } = useTranslation();
  const isWide = panelWidth > 300;
  const { handleLutSelect, setAdjustments, setLutPreviewOverride } = useEditorActions();
  const { showContextMenu } = useContextMenu();
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const isImageReady = useEditorStore((state) => state.selectedImage?.isReady ?? false);
  const adjustments = useEditorStore((state) => state.adjustments);
  const setEditor = useEditorStore((state) => state.setEditor);
  const selectedLutPath = useEditorStore((state) => state.adjustments.lutPath ?? null);
  const lutIntensity = useEditorStore((state) => state.adjustments.lutIntensity ?? DEFAULT_LUT_PARAMS.intensity);
  const lutInputOffset = useEditorStore((state) => state.adjustments.lutInputOffset ?? DEFAULT_LUT_PARAMS.inputOffset);
  const lutInputRange = useEditorStore((state) => state.adjustments.lutInputRange ?? DEFAULT_LUT_PARAMS.inputRange);
  const lutWbTemperatureShift = useEditorStore(
    (state) => state.adjustments.lutWbTemperatureShift ?? DEFAULT_LUT_PARAMS.wbTemperatureShift,
  );
  const lutWbTintShift = useEditorStore((state) => state.adjustments.lutWbTintShift ?? DEFAULT_LUT_PARAMS.wbTintShift);
  const lutFlimContrast = useEditorStore(
    (state) => state.adjustments.lutFlimContrast ?? DEFAULT_LUT_PARAMS.flimContrast,
  );
  const lutFlimLights = useEditorStore((state) => state.adjustments.lutFlimLights ?? DEFAULT_LUT_PARAMS.flimLights);
  const lutFlimShadows = useEditorStore((state) => state.adjustments.lutFlimShadows ?? DEFAULT_LUT_PARAMS.flimShadows);
  const lutSaturation = useEditorStore((state) => state.adjustments.lutSaturation ?? DEFAULT_LUT_PARAMS.saturation);
  const lutVibrance = useEditorStore((state) => state.adjustments.lutVibrance ?? DEFAULT_LUT_PARAMS.vibrance);
  const appSettings = useSettingsStore((state) => state.appSettings);
  const osPlatform = useSettingsStore((state) => state.osPlatform);

  const {
    entries,
    folders,
    order,
    loadLuts,
    isLoading: isLoadingEntries,
    viewMode,
    setViewMode,
    moveLutToFolder,
    reorderLut,
    reorderFolderLut,
    reorderFolder,
    toggleFavorite,
    favorites,
    addFolder,
    deleteFolder,
    renameFolder,
  } = useLutStore();
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [isLoadingPreviews, setIsLoadingPreviews] = useState(false);
  const [hotkeyModalState, setHotkeyModalState] = useState<{ isOpen: boolean; entry: LutEntry | null }>({
    isOpen: false,
    entry: null,
  });
  const [folderModalState, setFolderModalState] = useState<
    | { type: 'create' }
    | { type: 'rename'; folder: LutFolder }
    | null
  >(null);
  const [activeDragItem, setActiveDragItem] = useState<{ type: LutListType; path?: string; folder?: LutFolder } | null>(
    null,
  );
  const [expandedFolders, setExpandedFolders] = useState(new Set<string>());
  const previewCache = useRef<Map<string, { key: string; thumb: string | null }>>(new Map());
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The swatches should reflect the current non-LUT adjustments (exposure,
  // contrast, etc.) plus each LUT's own saved parameters.
  const lutFieldSet = useMemo(
    () =>
      new Set([
        'lutPath',
        'lutName',
        'lutData',
        'lutSize',
        'lutIntensity',
        'lutTiming',
        'lutNormalizeMode',
        'lutInputRange',
        'lutInputOffset',
        'lutOffsetCompensation',
        'lutWbTemperatureShift',
        'lutWbTintShift',
        'lutFlimContrast',
        'lutFlimLights',
        'lutFlimShadows',
        'lutSaturation',
        'lutVibrance',
        'lutPerImageParams',
      ]),
    [],
  );

  const previewAdjustments = useMemo(() => {
    const filtered: Record<string, unknown> = {};
    Object.entries(adjustments).forEach(([key, value]) => {
      if (!lutFieldSet.has(key)) {
        filtered[key] = value;
      }
    });
    return filtered as Adjustments;
  }, [adjustments, lutFieldSet]);

  const adjustmentsKey = useMemo(() => JSON.stringify(previewAdjustments), [previewAdjustments]);

  const handleDragStateChange = useCallback(
    (isDragging: boolean) => {
      setEditor({ isSliderDragging: isDragging });
    },
    [setEditor],
  );

  useEffect(() => {
    loadLuts();
  }, [loadLuts]);

  useEffect(() => {
    useUIStore.getState().setUI({ isConfigureLutHotkeyModalOpen: hotkeyModalState.isOpen });
    return () => {
      useUIStore.getState().setUI({ isConfigureLutHotkeyModalOpen: false });
    };
  }, [hotkeyModalState.isOpen]);

  useEffect(() => {
    if (!isVisible || !selectedImagePath || !isImageReady || entries.length === 0) {
      return;
    }

    const keyFor = (path: string) => {
      const perImage = adjustments.lutPerImageParams?.[path];
      return `${selectedImagePath}|${adjustmentsKey}|${JSON.stringify(perImage ?? appSettings?.lutSettings?.[path] ?? null)}`;
    };
    const stalePaths = entries
      .map((entry) => entry.path)
      .filter((path) => previewCache.current.get(path)?.key !== keyFor(path));

    if (stalePaths.length === 0) {
      return;
    }

    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
    }

    let isActive = true;
    previewTimer.current = setTimeout(() => {
      const lutParams: Record<string, LutFileSettings> = {};
      stalePaths.forEach((path) => {
        const effective = getEffectiveLutParams(appSettings, adjustments, path);
        lutParams[path] = resolvedLutParamsToLutFileSettings(effective);
      });

      setIsLoadingPreviews(true);
      invoke<LutPreview[]>('generate_lut_previews', {
        lutPaths: stalePaths,
        size: PREVIEW_SIZE,
        lutParams,
        adjustments: previewAdjustments,
      })
        .then((results) => {
          if (!isActive) return;
          const map: Record<string, string | null> = {};
          results.forEach((result) => {
            map[result.path] = result.thumb;
            previewCache.current.set(result.path, { key: keyFor(result.path), thumb: result.thumb });
          });
          setPreviews((prev) => ({ ...prev, ...map }));
        })
        .catch((err) => {
          if (!isActive) return;
          toast.error(`Failed to generate LUT previews: ${err}`);
        })
        .finally(() => {
          if (isActive) setIsLoadingPreviews(false);
        });
    }, 250);

    return () => {
      isActive = false;
      if (previewTimer.current) {
        clearTimeout(previewTimer.current);
      }
    };
  }, [
    isVisible,
    selectedImagePath,
    isImageReady,
    entries,
    appSettings?.lutSettings,
    adjustmentsKey,
    adjustments.lutPerImageParams,
  ]);

  useEffect(() => {
    return () => {
      if (previewTimer.current) {
        clearTimeout(previewTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isVisible) {
      setLutPreviewOverride(null);
    }
  }, [isVisible, setLutPreviewOverride]);

  useEffect(() => {
    return () => {
      setLutPreviewOverride(null);
    };
  }, [setLutPreviewOverride]);

  useEffect(() => {
    setLutPreviewOverride(null);
  }, [selectedImagePath, setLutPreviewOverride]);

  const handleImport = useCallback(async () => {
    try {
      const isAndroid = osPlatform === 'android';
      const selected = await open({
        multiple: true,
        filters: isAndroid
          ? []
          : [
              {
                name: 'LUT & HALD files',
                extensions: ['cube', '3dl', 'CUBE', '3DL', 'tiff', 'tif', 'png', 'TIFF', 'TIF', 'PNG'],
              },
            ],
      });
      const sourcePaths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (sourcePaths.length === 0) return;

      let validPaths = sourcePaths;
      if (isAndroid) {
        const resolvedNames = await Promise.all(
          sourcePaths.map(async (path) => {
            try {
              return await invoke<string>('resolve_android_content_uri_name', { uriStr: path });
            } catch (e) {
              console.error('Failed to resolve Android URI:', e);
              return path;
            }
          }),
        );
        const allowedExtensions = new Set(['cube', '3dl', 'tiff', 'tif', 'png']);
        validPaths = sourcePaths.filter((_, index) => {
          const resolvedName = resolvedNames[index];
          const ext = resolvedName.split('.').pop()?.toLowerCase() || '';
          return allowedExtensions.has(ext);
        });
        if (validPaths.length === 0) return;
      }

      await invoke('import_luts', { sourcePaths: validPaths });
      previewCache.current.clear();
      loadLuts();
      setPreviews({});
    } catch (err) {
      toast.error(`Failed to import LUTs: ${err}`);
    }
  }, [osPlatform]);

  const handleClear = useCallback(() => {
    setAdjustments((prev) => ({
      ...prev,
      ...lutParamsToAdjustments(DEFAULT_LUT_PARAMS),
      lutPath: null,
      lutName: null,
      lutData: null,
      lutSize: 0,
    }));
  }, [setAdjustments]);

  const handleSelect = useCallback(
    async (path: string) => {
      if (path === selectedLutPath) {
        handleClear();
      } else {
        await handleLutSelect(path);
      }
    },
    [selectedLutPath, handleClear, handleLutSelect],
  );

  const toggleFolder = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, entry: LutEntry) => {
      event.preventDefault();
      event.stopPropagation();

      showContextMenu(event.clientX, event.clientY, [
        {
          icon: Pencil,
          label: t('ui.lut.configureLut'),
          onClick: () => setHotkeyModalState({ isOpen: true, entry }),
        },
        {
          icon: Star,
          label: favorites.has(entry.path) ? t('ui.lut.removeFavorite') : t('ui.lut.addFavorite'),
          onClick: () => toggleFavorite(entry.path),
        },
        {
          icon: FolderPlus,
          label: t('ui.lut.addToFolder'),
          submenu: [
            ...folders.map((f) => ({
              label: f.name,
              onClick: () => moveLutToFolder(entry.path, f.id),
            })),
            { label: t('ui.lut.newFolder'), icon: Plus, onClick: () => setFolderModalState({ type: 'create' }) },
          ],
        },
        {
          icon: Trash2,
          label: t('ui.lut.deleteLut'),
          submenu: [
            { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
            {
              label: t('ui.lut.confirmDelete'),
              icon: Check,
              isDestructive: true,
              onClick: async () => {
                try {
                  await invoke('remove_lut', { path: entry.path });
                  previewCache.current.delete(entry.path);
                  setPreviews((prev) => {
                    const next = { ...prev };
                    delete next[entry.path];
                    return next;
                  });
                  if (selectedLutPath === entry.path) {
                    setAdjustments((prev) => ({
                      ...prev,
                      ...lutParamsToAdjustments(DEFAULT_LUT_PARAMS),
                      lutPath: null,
                      lutName: null,
                      lutData: null,
                      lutSize: 0,
                    }));
                  }
                  loadLuts();
                } catch (err) {
                  toast.error(`Failed to delete LUT: ${err}`);
                }
              },
            },
          ],
        },
      ]);
    },
    [showContextMenu, t, favorites, toggleFavorite, folders, moveLutToFolder, selectedLutPath, setAdjustments, loadLuts],
  );

  const handleFolderContextMenu = useCallback(
    (event: React.MouseEvent, folder: LutFolder) => {
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, [
        {
          icon: Pencil,
          label: t('ui.lut.renameFolder'),
          onClick: () => setFolderModalState({ type: 'rename', folder }),
        },
        {
          icon: Trash2,
          label: t('ui.lut.deleteFolder'),
          submenu: [
            { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
            {
              label: t('ui.lut.deleteFolderKeepChildren'),
              icon: Check,
              onClick: () => deleteFolder(folder.id, true),
            },
            {
              label: t('ui.lut.deleteFolderRemoveChildren'),
              icon: Trash2,
              isDestructive: true,
              onClick: () => deleteFolder(folder.id, false),
            },
          ],
        },
      ]);
    },
    [showContextMenu, t, deleteFolder],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 10 } }));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragItem(null);
      if (!over || active.id === over.id) return;

      const activeType = active.data.current?.type;
      const activePath = active.data.current?.path as string | undefined;
      const activeFolderId = active.data.current?.folderId as string | undefined;

      if (activeType === LutListType.Lut && activePath) {
        const overType = over.data.current?.type;
        const overFolderId =
          overType === LutListType.Folder ? (over.id as string) : (over.data.current?.folderId as string | undefined);
        if (activeFolderId && !overFolderId) {
          moveLutToFolder(activePath, null, over.id as string);
        } else if (overFolderId && overFolderId !== activeFolderId) {
          moveLutToFolder(activePath, overFolderId, over.id as string);
        } else if (activeFolderId) {
          reorderFolderLut(activeFolderId, activePath, over.id as string);
        } else {
          reorderLut(activePath, over.id as string);
        }
      } else if (activeType === LutListType.Folder) {
        reorderFolder(active.id as string, over.id as string);
      }
    },
    [moveLutToFolder, reorderFolderLut, reorderLut, reorderFolder],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragItem(event.active.data.current as { type: LutListType; path?: string; folder?: LutFolder });
  }, []);

  const updateLutAdjustment = useCallback(
    (adjustmentPatch: Partial<Adjustments>) => {
      setAdjustments((prev) => {
        const next: Adjustments = { ...prev, ...adjustmentPatch };
        if (selectedLutPath) {
          const resolved: ResolvedLutParams = {
            intensity: next.lutIntensity ?? DEFAULT_LUT_PARAMS.intensity,
            timing: 'before',
            inputRange: next.lutInputRange ?? DEFAULT_LUT_PARAMS.inputRange,
            inputOffset: next.lutInputOffset ?? DEFAULT_LUT_PARAMS.inputOffset,
            offsetCompensation: next.lutOffsetCompensation ?? DEFAULT_LUT_PARAMS.offsetCompensation,
            wbTemperatureShift: next.lutWbTemperatureShift ?? DEFAULT_LUT_PARAMS.wbTemperatureShift,
            wbTintShift: next.lutWbTintShift ?? DEFAULT_LUT_PARAMS.wbTintShift,
            flimContrast: next.lutFlimContrast ?? DEFAULT_LUT_PARAMS.flimContrast,
            flimLights: next.lutFlimLights ?? DEFAULT_LUT_PARAMS.flimLights,
            flimShadows: next.lutFlimShadows ?? DEFAULT_LUT_PARAMS.flimShadows,
            saturation: next.lutSaturation ?? DEFAULT_LUT_PARAMS.saturation,
            vibrance: next.lutVibrance ?? DEFAULT_LUT_PARAMS.vibrance,
          };
          next.lutPerImageParams = { ...prev.lutPerImageParams, [selectedLutPath]: resolved };
        }
        return next;
      });
    },
    [selectedLutPath, setAdjustments],
  );

  const handleSaveAsDefault = useCallback(() => {
    if (!selectedLutPath) return;
    saveLutParams(selectedLutPath, {
      intensity: lutIntensity,
      inputOffset: lutInputOffset,
      inputRange: lutInputRange,
      timing: 'before',
      wbTemperatureShift: lutWbTemperatureShift,
      wbTintShift: lutWbTintShift,
      flimContrast: lutFlimContrast,
      flimLights: lutFlimLights,
      flimShadows: lutFlimShadows,
      saturation: lutSaturation,
      vibrance: lutVibrance,
    });
  }, [
    selectedLutPath,
    lutIntensity,
    lutInputOffset,
    lutInputRange,
    lutWbTemperatureShift,
    lutWbTintShift,
    lutFlimContrast,
    lutFlimLights,
    lutFlimShadows,
    lutSaturation,
    lutVibrance,
  ]);

  const handleResetToDefault = useCallback(() => {
    if (!selectedLutPath) return;
    const defaultParams = resolveLutParams(appSettings, selectedLutPath);
    setAdjustments((prev) => {
      const next: Adjustments = { ...prev, ...lutParamsToAdjustments(defaultParams) };
      if (prev.lutPerImageParams?.[selectedLutPath]) {
        const { [selectedLutPath]: _, ...rest } = prev.lutPerImageParams;
        next.lutPerImageParams = rest;
      }
      return next;
    });
  }, [selectedLutPath, appSettings, setAdjustments]);

  const defaultParams = useMemo(
    () => (selectedLutPath ? resolveLutParams(appSettings, selectedLutPath) : DEFAULT_LUT_PARAMS),
    [appSettings, selectedLutPath],
  );

  const defaultWbTemperatureShift = defaultParams.wbTemperatureShift;
  const defaultWbTintShift = defaultParams.wbTintShift;
  const defaultFlimContrast = defaultParams.flimContrast;
  const defaultFlimLights = defaultParams.flimLights;
  const defaultFlimShadows = defaultParams.flimShadows;
  const defaultSaturation = defaultParams.saturation;
  const defaultVibrance = defaultParams.vibrance;

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.path === selectedLutPath) || null,
    [entries, selectedLutPath],
  );
  const selectedIndex = useMemo(
    () => (selectedLutPath ? entries.findIndex((entry) => entry.path === selectedLutPath) : -1),
    [entries, selectedLutPath],
  );

  const orderedEntries = useMemo(() => {
    const map = new Map(entries.map((e) => [e.path, e]));
    const orderedPaths = new Set(order);
    const ordered = order.map((path) => map.get(path)).filter((e): e is LutEntry => !!e);
    const remaining = entries.filter((e) => !orderedPaths.has(e.path));
    return [...ordered, ...remaining];
  }, [entries, order]);

  const mixedItems = useMemo<LutListItem[]>(() => {
    const rootPaths = new Set(orderedEntries.map((e) => e.path));
    folders.forEach((f) => f.children.forEach((p) => rootPaths.delete(p)));
    const rootEntries = orderedEntries.filter((e) => rootPaths.has(e.path));

    const items: LutListItem[] = [];
    folders.forEach((folder) => items.push({ type: LutListType.Folder, folder }));
    rootEntries.forEach((entry) => items.push({ type: LutListType.Lut, entry }));
    return items;
  }, [folders, orderedEntries]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <Text variant={TextVariants.title}>{t('ui.lut.luts')}</Text>
        <div className="flex items-center gap-1">
          <button
            className="p-2 rounded-full hover:bg-surface transition-colors"
            onClick={handleImport}
            data-tooltip={t('ui.lut.import')}
            aria-label={t('ui.lut.import')}
          >
            <Upload size={18} />
          </button>
          <button
            className="p-2 rounded-full hover:bg-surface transition-colors"
            onClick={() => setViewMode(viewMode === 'expanded' ? 'compact' : 'expanded')}
            data-tooltip={viewMode === 'expanded' ? t('ui.lut.compactView') : t('ui.lut.expandedView')}
            aria-label={viewMode === 'expanded' ? t('ui.lut.compactView') : t('ui.lut.expandedView')}
          >
            {viewMode === 'expanded' ? <List size={18} /> : <LayoutGrid size={18} />}
          </button>
        </div>
      </div>

      <div
        className="grow min-h-0 overflow-y-auto p-4"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, [
              {
                icon: FolderPlus,
                label: t('ui.lut.createFolder'),
                onClick: () => setFolderModalState({ type: 'create' }),
              },
              {
                icon: viewMode === 'expanded' ? List : LayoutGrid,
                label: t(viewMode === 'expanded' ? 'ui.lut.compactView' : 'ui.lut.expandedView'),
                onClick: () => setViewMode(viewMode === 'expanded' ? 'compact' : 'expanded'),
              },
            ]);
          }
        }}
      >
        {isLoadingEntries && orderedEntries.length === 0 ? (
          <Text
            as="div"
            variant={TextVariants.heading}
            color={TextColors.secondary}
            weight={TextWeights.normal}
            className="text-center mt-4"
          >
            <Loader2 size={14} className="animate-spin inline-block mr-2" /> {t('ui.lut.loading')}
          </Text>
        ) : orderedEntries.length === 0 ? (
          <button
            onClick={handleImport}
            className="w-full flex items-center justify-center gap-1.5 py-4 rounded-md bg-bg-tertiary hover:bg-surface border-2 border-dashed border-text-secondary/20 hover:border-text-secondary/40 text-sm text-text-primary transition-colors"
          >
            <Upload size={16} />
            {t('ui.lut.import')}
          </button>
        ) : (
          // Drag-and-drop is intentionally scoped to compact view because folders are only rendered there.
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveDragItem(null)}
          >
            {viewMode === 'compact' ? (
              <div className="space-y-2">
                {mixedItems.map((item) => {
                  if (item.type === LutListType.Folder) {
                    const folder = item.folder;
                    const isExpanded = expandedFolders.has(folder.id);
                    const visibleChildren = folder.children
                      .map((path) => orderedEntries.find((e) => e.path === path))
                      .filter(Boolean) as LutEntry[];
                    return (
                      <div key={folder.id}>
                        <DraggableFolderHeader
                          folder={folder}
                          visibleCount={visibleChildren.length}
                          isExpanded={isExpanded}
                          onToggle={toggleFolder}
                          onContextMenu={handleFolderContextMenu}
                        />
                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.25, ease: 'easeInOut' }}
                              className="ml-5 pl-4 border-l-[1.5px] border-border-color/50 space-y-2 pt-2"
                            >
                              {visibleChildren.map((entry) => {
                                const isSelected = entry.path === selectedLutPath;
                                return (
                                  <div key={entry.path} className="flex flex-col">
                                    <DraggableLutRow
                                      folderId={folder.id}
                                      entry={entry}
                                      thumb={previews[entry.path] ?? null}
                                      isSelected={isSelected}
                                      isLoading={isLoadingPreviews}
                                      hotkey={appSettings?.lutSettings?.[entry.path]?.hotkey ?? null}
                                      osPlatform={osPlatform}
                                      onSelect={handleSelect}
                                      onContextMenu={handleContextMenu}
                                      onMouseEnter={() => setLutPreviewOverride(entry.path)}
                                      onMouseLeave={() => setLutPreviewOverride(null)}
                                    />
                                    <AnimatePresence initial={false}>
                                      {isSelected && (
                                        <motion.div
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: 'auto', opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          transition={{ duration: 0.25, ease: 'easeInOut' }}
                                          className="w-full cursor-auto overflow-hidden"
                                          onClick={(e) => e.stopPropagation()}
                                          onPointerDown={(e) => e.stopPropagation()}
                                        >
                                          <div className="mt-3 px-2 pb-2">
                                            <LutDetailPanel
                                              lutIntensity={lutIntensity}
                                              lutInputOffset={lutInputOffset}
                                              lutInputRange={lutInputRange}
                                              lutWbTemperatureShift={lutWbTemperatureShift}
                                              lutWbTintShift={lutWbTintShift}
                                              lutFlimContrast={lutFlimContrast}
                                              lutFlimLights={lutFlimLights}
                                              lutFlimShadows={lutFlimShadows}
                                              lutSaturation={lutSaturation}
                                              lutVibrance={lutVibrance}
                                              defaultIntensity={defaultParams.intensity}
                                              defaultInputOffset={defaultParams.inputOffset}
                                              defaultInputRange={defaultParams.inputRange}
                                              defaultWbTemperatureShift={defaultWbTemperatureShift}
                                              defaultWbTintShift={defaultWbTintShift}
                                              defaultFlimContrast={defaultFlimContrast}
                                              defaultFlimLights={defaultFlimLights}
                                              defaultFlimShadows={defaultFlimShadows}
                                              defaultSaturation={defaultSaturation}
                                              defaultVibrance={defaultVibrance}
                                              onDragStateChange={handleDragStateChange}
                                              onUpdate={updateLutAdjustment}
                                              onSaveAsDefault={handleSaveAsDefault}
                                              onResetToDefault={handleResetToDefault}
                                            />
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                );
                              })}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  }
                  const entry = item.entry;
                  const isSelected = entry.path === selectedLutPath;
                  return (
                    <div key={entry.path} className="flex flex-col">
                      <DraggableLutRow
                        entry={entry}
                        thumb={previews[entry.path] ?? null}
                        isSelected={isSelected}
                        isLoading={isLoadingPreviews}
                        hotkey={appSettings?.lutSettings?.[entry.path]?.hotkey ?? null}
                        osPlatform={osPlatform}
                        onSelect={handleSelect}
                        onContextMenu={handleContextMenu}
                        onMouseEnter={() => setLutPreviewOverride(entry.path)}
                        onMouseLeave={() => setLutPreviewOverride(null)}
                      />
                      <AnimatePresence initial={false}>
                        {isSelected && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: 'easeInOut' }}
                            className="w-full cursor-auto overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <div className="mt-3 px-2 pb-2">
                              <LutDetailPanel
                                lutIntensity={lutIntensity}
                                lutInputOffset={lutInputOffset}
                                lutInputRange={lutInputRange}
                                lutWbTemperatureShift={lutWbTemperatureShift}
                                lutWbTintShift={lutWbTintShift}
                                lutFlimContrast={lutFlimContrast}
                                lutFlimLights={lutFlimLights}
                                lutFlimShadows={lutFlimShadows}
                                lutSaturation={lutSaturation}
                                lutVibrance={lutVibrance}
                                defaultIntensity={defaultParams.intensity}
                                defaultInputOffset={defaultParams.inputOffset}
                                defaultInputRange={defaultParams.inputRange}
                                defaultWbTemperatureShift={defaultWbTemperatureShift}
                                defaultWbTintShift={defaultWbTintShift}
                                defaultFlimContrast={defaultFlimContrast}
                                defaultFlimLights={defaultFlimLights}
                                defaultFlimShadows={defaultFlimShadows}
                                defaultSaturation={defaultSaturation}
                                defaultVibrance={defaultVibrance}
                                onDragStateChange={handleDragStateChange}
                                onUpdate={updateLutAdjustment}
                                onSaveAsDefault={handleSaveAsDefault}
                                onResetToDefault={handleResetToDefault}
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {Array.from({ length: Math.ceil(orderedEntries.length / (isWide ? 2 : 1)) }).map((_, rowIndex) => {
                  const columns = isWide ? 2 : 1;
                  const start = rowIndex * columns;
                  const rowEntries = orderedEntries.slice(start, start + columns);
                  const isLastRow = rowIndex === Math.ceil(orderedEntries.length / columns) - 1;
                  return (
                    <div
                      key={rowIndex}
                      className={clsx(
                        'grid gap-3 items-start',
                        isWide ? 'grid-cols-2' : 'grid-cols-1',
                        !isLastRow && 'mb-2.5',
                      )}
                      role="row"
                    >
                      {rowEntries.map((entry) => {
                        const thumb = previews[entry.path];
                        const isSelected = entry.path === selectedLutPath;
                        return (
                          <div key={entry.path} className="flex flex-col p-2 rounded-lg bg-surface">
                            <button
                              onClick={() => handleSelect(entry.path)}
                              onContextMenu={(e) => handleContextMenu(e, entry)}
                              onMouseEnter={() => setLutPreviewOverride(entry.path)}
                              onMouseLeave={() => setLutPreviewOverride(null)}
                              className={clsx(
                                'relative aspect-square rounded-md overflow-hidden bg-bg-tertiary text-left outline-2 outline-offset-[-2px] transition-[outline-color]',
                                isSelected ? 'outline-accent' : 'outline-transparent hover:outline-accent/50',
                              )}
                              aria-selected={isSelected}
                              aria-label={entry.name}
                              role="gridcell"
                            >
                              {isLoadingPreviews && thumb === undefined ? (
                                <div className="w-full h-full animate-pulse bg-surface" />
                              ) : thumb ? (
                                <img
                                  src={thumb}
                                  alt={entry.name}
                                  className="w-full h-full object-cover"
                                  draggable={false}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-text-secondary">
                                  <ImageOff size={18} />
                                </div>
                              )}
                              {appSettings?.lutSettings?.[entry.path]?.hotkey?.length ? (
                                <Text
                                  as="kbd"
                                  variant={TextVariants.small}
                                  color={TextColors.secondary}
                                  className="absolute top-1.5 right-1.5 px-1 py-0.5 bg-bg-primary/90 backdrop-blur-sm border border-border-color/50 rounded text-[10px] leading-none"
                                >
                                  {appSettings.lutSettings?.[entry.path]?.hotkey
                                    ?.map((k) => formatKeyCode(k, osPlatform))
                                    .join('')}
                                </Text>
                              ) : null}
                            </button>
                            <Text
                              variant={TextVariants.label}
                              color={isSelected ? TextColors.primary : TextColors.secondary}
                              weight={isSelected ? TextWeights.medium : TextWeights.normal}
                              className="mt-[10px] truncate px-0.5"
                            >
                              {entry.name}
                            </Text>
                            <AnimatePresence initial={false}>
                              {isSelected && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                                  className="w-full cursor-auto overflow-hidden"
                                  onClick={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  <div className="mt-3">
                                    <LutDetailPanel
                                      lutIntensity={lutIntensity}
                                      lutInputOffset={lutInputOffset}
                                      lutInputRange={lutInputRange}
                                      lutWbTemperatureShift={lutWbTemperatureShift}
                                      lutWbTintShift={lutWbTintShift}
                                      lutFlimContrast={lutFlimContrast}
                                      lutFlimLights={lutFlimLights}
                                      lutFlimShadows={lutFlimShadows}
                                      lutSaturation={lutSaturation}
                                      lutVibrance={lutVibrance}
                                      defaultIntensity={defaultParams.intensity}
                                      defaultInputOffset={defaultParams.inputOffset}
                                      defaultInputRange={defaultParams.inputRange}
                                      defaultWbTemperatureShift={defaultWbTemperatureShift}
                                      defaultWbTintShift={defaultWbTintShift}
                                      defaultFlimContrast={defaultFlimContrast}
                                      defaultFlimLights={defaultFlimLights}
                                      defaultFlimShadows={defaultFlimShadows}
                                      defaultSaturation={defaultSaturation}
                                      defaultVibrance={defaultVibrance}
                                      onDragStateChange={handleDragStateChange}
                                      onUpdate={updateLutAdjustment}
                                      onSaveAsDefault={handleSaveAsDefault}
                                      onResetToDefault={handleResetToDefault}
                                    />
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                      {isLastRow && isWide && rowEntries.length < 2 && (
                        <button
                          onClick={handleImport}
                          className="aspect-square rounded-md bg-bg-tertiary border-2 border-text-secondary/25 hover:border-accent flex items-center justify-center text-text-secondary hover:text-text-primary transition-all duration-150"
                          data-tooltip={t('ui.lut.import')}
                          aria-label={t('ui.lut.import')}
                          role="gridcell"
                        >
                          <Upload size={20} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {(orderedEntries.length === 0 || !isWide || orderedEntries.length % 2 === 0) && (
                  <button
                    onClick={handleImport}
                    className="w-full aspect-square rounded-md bg-bg-tertiary border-2 border-text-secondary/25 hover:border-accent flex items-center justify-center text-text-secondary hover:text-text-primary transition-all duration-150 mt-3"
                    data-tooltip={t('ui.lut.import')}
                    aria-label={t('ui.lut.import')}
                    role="gridcell"
                  >
                    <Upload size={20} />
                  </button>
                )}
              </>
            )}
            <DragOverlay>
              {activeDragItem?.type === LutListType.Lut && activeDragItem.path ? (
                (() => {
                  const entry = orderedEntries.find((e) => e.path === activeDragItem.path);
                  if (!entry) return null;
                  return (
                    <div className="p-2 rounded-lg bg-surface opacity-90">
                      <CompactLutRow
                        entry={entry}
                        thumb={previews[entry.path] ?? null}
                        isSelected={false}
                        isLoading={false}
                        hotkey={appSettings?.lutSettings?.[entry.path]?.hotkey ?? null}
                        osPlatform={osPlatform}
                        onSelect={() => {}}
                        onContextMenu={() => {}}
                        onMouseEnter={() => {}}
                        onMouseLeave={() => {}}
                      />
                    </div>
                  );
                })()
              ) : activeDragItem?.type === LutListType.Folder && activeDragItem.folder ? (
                <div className="p-2 rounded-lg bg-surface opacity-90">
                  <FolderHeader
                    folder={activeDragItem.folder}
                    visibleCount={activeDragItem.folder.children.length}
                    isExpanded={false}
                    onToggle={() => {}}
                    onContextMenu={() => {}}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {hotkeyModalState.entry && (
        <ConfigureLutHotkeyModal
          isOpen={hotkeyModalState.isOpen}
          onClose={() => setHotkeyModalState({ isOpen: false, entry: null })}
          lutPath={hotkeyModalState.entry.path}
          lutName={hotkeyModalState.entry.name}
          osPlatform={osPlatform}
          onSaved={({ newPath, newName }) => {
            loadLuts();
            if (newPath && selectedLutPath === hotkeyModalState.entry?.path) {
              setAdjustments((prev) => ({
                ...prev,
                lutPath: newPath,
                lutName: newName ?? prev.lutName,
              }));
            }
          }}
        />
      )}

      {folderModalState?.type === 'create' && (
        <CreateFolderModal
          isOpen
          onClose={() => setFolderModalState(null)}
          onSave={(name) => {
            addFolder(name);
            setFolderModalState(null);
          }}
          title={t('ui.lut.createFolder')}
        />
      )}
      {folderModalState?.type === 'rename' && (
        <RenameFolderModal
          isOpen
          currentName={folderModalState.folder.name}
          onClose={() => setFolderModalState(null)}
          onSave={(name) => {
            renameFolder(folderModalState.folder.id, name);
            setFolderModalState(null);
          }}
          title={t('ui.lut.renameFolder')}
        />
      )}
    </div>
  );
}

interface FolderHeaderProps {
  folder: LutFolder;
  visibleCount: number;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, folder: LutFolder) => void;
}

function FolderHeader({ folder, visibleCount, isExpanded, onToggle, onContextMenu }: FolderHeaderProps) {
  return (
    <button
      type="button"
      aria-expanded={isExpanded}
      className="w-full flex items-center gap-2 p-2 rounded-lg bg-surface text-left"
      onClick={() => onToggle(folder.id)}
      onContextMenu={(e) => onContextMenu(e, folder)}
    >
      <ChevronRight
        size={16}
        className={clsx('text-text-secondary transition-transform duration-200', isExpanded && 'rotate-90')}
      />
      <div className="p-1">
        {isExpanded ? (
          <FolderOpen className="text-primary" size={18} />
        ) : (
          <FolderIcon className="text-text-secondary" size={18} />
        )}
      </div>
      <Text color={TextColors.primary} weight={TextWeights.medium} className="grow truncate select-none">
        {folder.name}
      </Text>
      <Text as="span" variant={TextVariants.small} color={TextColors.secondary} className="ml-auto pr-1">
        {visibleCount}
      </Text>
    </button>
  );
}

interface CompactLutRowProps {
  entry: LutEntry;
  thumb: string | null;
  isSelected: boolean;
  isLoading: boolean;
  hotkey: string[] | null;
  osPlatform: string;
  onSelect: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, entry: LutEntry) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function CompactLutRow({
  entry,
  thumb,
  isSelected,
  isLoading,
  hotkey,
  osPlatform,
  onSelect,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
}: CompactLutRowProps) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 p-2 rounded-lg bg-surface cursor-pointer outline-2 outline-offset-[-2px] transition-[outline-color]',
        isSelected ? 'outline-accent' : 'outline-transparent hover:outline-accent/50',
      )}
      onClick={() => onSelect(entry.path)}
      onContextMenu={(e) => onContextMenu(e, entry)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="w-20 h-14 bg-bg-tertiary rounded-md flex items-center justify-center shrink-0 relative overflow-hidden">
        {isLoading && thumb === undefined ? (
          <Loader2 size={20} className="animate-spin text-text-secondary" />
        ) : thumb ? (
          <img src={thumb} alt={entry.name} className="w-full h-full object-cover rounded-md pointer-events-none" />
        ) : (
          <ImageOff size={18} className="text-text-secondary" />
        )}
      </div>
      <div className="grow min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2">
          <Text
            color={TextColors.primary}
            weight={isSelected ? TextWeights.medium : TextWeights.normal}
            className="truncate"
          >
            {entry.name}
          </Text>
          {hotkey && hotkey.length > 0 && (
            <Text
              as="kbd"
              variant={TextVariants.small}
              color={TextColors.secondary}
              className="px-1.5 py-0.5 bg-bg-primary border border-border-color rounded text-[10px] shrink-0"
            >
              {hotkey.map((k) => formatKeyCode(k, osPlatform)).join('')}
            </Text>
          )}
        </div>
      </div>
    </div>
  );
}

interface DraggableLutRowProps extends CompactLutRowProps {
  folderId?: string | null;
}

function DraggableLutRow({ folderId, ...props }: DraggableLutRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: props.entry.path,
    data: { type: LutListType.Lut, path: props.entry.path, folderId },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: props.entry.path,
    data: { type: LutListType.Lut, path: props.entry.path, folderId },
  });
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );
  return (
    <div
      ref={setRef}
      style={{
        opacity: isDragging ? 0.4 : 1,
        outline: isOver ? '2px solid var(--color-primary)' : '2px solid transparent',
        outlineOffset: '-2px',
      }}
      {...listeners}
      {...attributes}
    >
      <CompactLutRow {...props} />
    </div>
  );
}

interface DraggableFolderHeaderProps extends FolderHeaderProps {
  visibleCount: number;
}

function DraggableFolderHeader(props: DraggableFolderHeaderProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: props.folder.id,
    data: { type: LutListType.Folder, folder: props.folder },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: props.folder.id,
    data: { type: LutListType.Folder, folder: props.folder },
  });
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );
  return (
    <div
      ref={setRef}
      style={{
        opacity: isDragging ? 0.4 : 1,
        outline: isOver ? '2px solid var(--color-primary)' : '2px solid transparent',
        outlineOffset: '-2px',
      }}
      {...listeners}
      {...attributes}
    >
      <FolderHeader {...props} />
    </div>
  );
}

interface LutDetailPanelProps {
  lutIntensity: number;
  lutInputOffset: number;
  lutInputRange: number;
  lutWbTemperatureShift: number;
  lutWbTintShift: number;
  lutFlimContrast: number;
  lutFlimLights: number;
  lutFlimShadows: number;
  lutSaturation: number;
  lutVibrance: number;
  defaultIntensity: number;
  defaultInputOffset: number;
  defaultInputRange: number;
  defaultWbTemperatureShift: number;
  defaultWbTintShift: number;
  defaultFlimContrast: number;
  defaultFlimLights: number;
  defaultFlimShadows: number;
  defaultSaturation: number;
  defaultVibrance: number;
  onDragStateChange: (isDragging: boolean) => void;
  onUpdate: (adjustmentPatch: Partial<Adjustments>) => void;
  onSaveAsDefault: () => void;
  onResetToDefault: () => void;
}

const LutDetailPanel = memo(function LutDetailPanel({
  lutIntensity,
  lutInputOffset,
  lutInputRange,
  lutWbTemperatureShift,
  lutWbTintShift,
  lutFlimContrast,
  lutFlimLights,
  lutFlimShadows,
  lutSaturation,
  lutVibrance,
  defaultIntensity,
  defaultInputOffset,
  defaultInputRange,
  defaultWbTemperatureShift,
  defaultWbTintShift,
  defaultFlimContrast,
  defaultFlimLights,
  defaultFlimShadows,
  defaultSaturation,
  defaultVibrance,
  onDragStateChange,
  onUpdate,
  onSaveAsDefault,
  onResetToDefault,
}: LutDetailPanelProps) {
  const { t } = useTranslation();
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const isAlreadyDefault =
    lutIntensity === defaultIntensity &&
    lutInputOffset === defaultInputOffset &&
    lutInputRange === defaultInputRange &&
    lutWbTemperatureShift === defaultWbTemperatureShift &&
    lutWbTintShift === defaultWbTintShift &&
    lutFlimContrast === defaultFlimContrast &&
    lutFlimLights === defaultFlimLights &&
    lutFlimShadows === defaultFlimShadows &&
    lutSaturation === defaultSaturation &&
    lutVibrance === defaultVibrance;

  const handleIntensityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ lutIntensity: Number(e.target.value) });
    },
    [onUpdate],
  );

  const handleInputOffsetChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ lutInputOffset: Number(e.target.value) });
    },
    [onUpdate],
  );

  const handleInputRangeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ lutInputRange: Number(e.target.value) });
    },
    [onUpdate],
  );

  const handleWbTemperatureShiftChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ lutWbTemperatureShift: Number(e.target.value) });
    },
    [onUpdate],
  );

  const handleWbTintShiftChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ lutWbTintShift: Number(e.target.value) });
    },
    [onUpdate],
  );

  const handleFlimContrastChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ lutFlimContrast: Number(e.target.value) });
    },
    [onUpdate],
  );

  const handleFlimLightsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ lutFlimLights: -Number(e.target.value) });
    },
    [onUpdate],
  );

  const handleFlimShadowsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ lutFlimShadows: -Number(e.target.value) });
    },
    [onUpdate],
  );

  const handleSaturationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ lutSaturation: Number(e.target.value) });
    },
    [onUpdate],
  );

  const handleVibranceChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ lutVibrance: Number(e.target.value) });
    },
    [onUpdate],
  );

  return (
    <div className="space-y-1 px-0.5" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <Slider
        label={t('ui.lut.intensity')}
        min={0}
        max={100}
        step={1}
        value={lutIntensity}
        defaultValue={INITIAL_ADJUSTMENTS.lutIntensity}
        onChange={handleIntensityChange}
        onDragStateChange={onDragStateChange}
        fillOrigin="min"
      />

      <button
        type="button"
        className="w-full flex items-center justify-between px-2 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface rounded-md transition-colors"
        onClick={() => setIsAdvancedOpen((prev) => !prev)}
        aria-expanded={isAdvancedOpen}
      >
        <span>{t('ui.lut.advanced')}</span>
        <ChevronRight size={16} className={clsx('transition-transform duration-200', isAdvancedOpen && 'rotate-90')} />
      </button>

      <AnimatePresence initial={false}>
        {isAdvancedOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden space-y-1"
          >
            <Slider
              label={t('ui.lut.inputOffset')}
              min={-16}
              max={16}
              step={0.1}
              value={lutInputOffset}
              defaultValue={INITIAL_ADJUSTMENTS.lutInputOffset}
              onChange={handleInputOffsetChange}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('ui.lut.inputRange')}
              min={0}
              max={32}
              step={0.1}
              value={lutInputRange}
              defaultValue={INITIAL_ADJUSTMENTS.lutInputRange}
              onChange={handleInputRangeChange}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <div className="flex gap-2">
              <div className="w-1/2">
                <Slider
                  label={t('ui.lut.wbTemperatureShift')}
                  min={-100}
                  max={100}
                  step={1}
                  value={lutWbTemperatureShift}
                  defaultValue={INITIAL_ADJUSTMENTS.lutWbTemperatureShift}
                  onChange={handleWbTemperatureShiftChange}
                  onDragStateChange={onDragStateChange}
                  trackClassName="temperature-gradient-track"
                  fillOrigin="min"
                />
              </div>
              <div className="w-1/2">
                <Slider
                  label={t('ui.lut.wbTintShift')}
                  min={-100}
                  max={100}
                  step={1}
                  value={lutWbTintShift}
                  defaultValue={INITIAL_ADJUSTMENTS.lutWbTintShift}
                  onChange={handleWbTintShiftChange}
                  onDragStateChange={onDragStateChange}
                  trackClassName="tint-gradient-track"
                  fillOrigin="min"
                />
              </div>
            </div>
            <Slider
              label={t('editor.film.contrast')}
              min={-100}
              max={100}
              step={1}
              value={lutFlimContrast}
              defaultValue={INITIAL_ADJUSTMENTS.lutFlimContrast}
              onChange={handleFlimContrastChange}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('editor.film.lights')}
              min={-100}
              max={100}
              step={1}
              value={-lutFlimLights}
              defaultValue={INITIAL_ADJUSTMENTS.lutFlimLights}
              onChange={handleFlimLightsChange}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('adjustments.basic.shadows')}
              min={-100}
              max={100}
              step={1}
              value={-lutFlimShadows}
              defaultValue={INITIAL_ADJUSTMENTS.lutFlimShadows}
              onChange={handleFlimShadowsChange}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <div className="flex gap-2">
              <div className="w-1/2">
                <Slider
                  label={t('adjustments.color.saturation')}
                  min={-100}
                  max={100}
                  step={1}
                  value={lutSaturation}
                  defaultValue={INITIAL_ADJUSTMENTS.lutSaturation}
                  onChange={handleSaturationChange}
                  onDragStateChange={onDragStateChange}
                  fillOrigin="min"
                />
              </div>
              <div className="w-1/2">
                <Slider
                  label={t('adjustments.color.vibrance')}
                  min={-100}
                  max={100}
                  step={1}
                  value={lutVibrance}
                  defaultValue={INITIAL_ADJUSTMENTS.lutVibrance}
                  onChange={handleVibranceChange}
                  onDragStateChange={onDragStateChange}
                  fillOrigin="min"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-sm font-medium rounded-md bg-card-active text-text-secondary hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={onSaveAsDefault}
                disabled={isAlreadyDefault}
                data-tooltip={t('ui.lut.saveAsDefault')}
              >
                <Save size={14} />
                {t('ui.lut.saveAsDefault')}
              </button>
              <button
                className="flex items-center justify-center px-2 py-1.5 rounded-md bg-card-active text-text-secondary hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={onResetToDefault}
                disabled={isAlreadyDefault}
                data-tooltip={t('ui.lut.resetToDefault')}
                aria-label={t('ui.lut.resetToDefault')}
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
