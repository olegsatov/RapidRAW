import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import clsx from 'clsx';
import { ImageOff, Loader2, Pencil, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'react-toastify';

import Slider from '../../ui/Slider';
import Text from '../../ui/Text';
import type { LutFileSettings } from '../../ui/AppProperties';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useEditorStore } from '../../../store/useEditorStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';
import ConfigureLutHotkeyModal from '../../modals/ConfigureLutHotkeyModal';
import { Adjustments, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import {
  DEFAULT_LUT_PARAMS,
  lutParamsToAdjustments,
  resolveLutParams,
  saveLutParams,
} from '../../../utils/lutSettings';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';

interface LutEntry {
  name: string;
  path: string;
}

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
  const appSettings = useSettingsStore((state) => state.appSettings);
  const osPlatform = useSettingsStore((state) => state.osPlatform);

  const [entries, setEntries] = useState<LutEntry[]>([]);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isLoadingPreviews, setIsLoadingPreviews] = useState(false);
  const [hotkeyModalState, setHotkeyModalState] = useState<{ isOpen: boolean; entry: LutEntry | null }>({
    isOpen: false,
    entry: null,
  });
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

  const refreshList = useCallback(async () => {
    setIsLoadingEntries(true);
    try {
      const list = await invoke<LutEntry[]>('list_luts');
      setEntries(list);
    } catch (err) {
      toast.error(`Failed to list LUTs: ${err}`);
    } finally {
      setIsLoadingEntries(false);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

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

    const keyFor = (path: string) =>
      `${selectedImagePath}|${adjustmentsKey}|${JSON.stringify(appSettings?.lutSettings?.[path] ?? null)}`;
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
        const stored = appSettings?.lutSettings?.[path];
        if (stored) {
          lutParams[path] = stored;
        }
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
  }, [isVisible, selectedImagePath, isImageReady, entries, appSettings?.lutSettings, adjustmentsKey]);

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
        filters: isAndroid ? [] : [{ name: 'LUT files', extensions: ['cube', '3dl', 'CUBE', '3DL'] }],
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
        const allowedExtensions = new Set(['cube', '3dl']);
        validPaths = sourcePaths.filter((_, index) => {
          const resolvedName = resolvedNames[index];
          const ext = resolvedName.split('.').pop()?.toLowerCase() || '';
          return allowedExtensions.has(ext);
        });
        if (validPaths.length === 0) return;
      }

      const list = await invoke<LutEntry[]>('import_luts', { sourcePaths: validPaths });
      previewCache.current.clear();
      setEntries(list);
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
          icon: Trash2,
          label: t('ui.lut.deleteLut'),
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
              refreshList();
            } catch (err) {
              toast.error(`Failed to delete LUT: ${err}`);
            }
          },
        },
      ]);
    },
    [showContextMenu, t],
  );

  const updateLutAdjustment = useCallback(
    (adjustmentPatch: Partial<Adjustments>) => {
      setAdjustments((prev) => ({
        ...prev,
        ...adjustmentPatch,
      }));
    },
    [setAdjustments],
  );

  const handleSaveAsDefault = useCallback(() => {
    if (!selectedLutPath) return;
    saveLutParams(selectedLutPath, {
      intensity: lutIntensity,
      inputOffset: lutInputOffset,
      inputRange: lutInputRange,
      timing: 'before',
    });
  }, [selectedLutPath, lutIntensity, lutInputOffset, lutInputRange]);

  const handleResetToDefault = useCallback(() => {
    if (!selectedLutPath) return;
    const defaultParams = resolveLutParams(appSettings, selectedLutPath);
    setAdjustments((prev) => ({
      ...prev,
      ...lutParamsToAdjustments(defaultParams),
    }));
  }, [selectedLutPath, appSettings, setAdjustments]);

  const defaultParams = useMemo(
    () => (selectedLutPath ? resolveLutParams(appSettings, selectedLutPath) : DEFAULT_LUT_PARAMS),
    [appSettings, selectedLutPath],
  );

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.path === selectedLutPath) || null,
    [entries, selectedLutPath],
  );
  const selectedIndex = useMemo(
    () => (selectedLutPath ? entries.findIndex((entry) => entry.path === selectedLutPath) : -1),
    [entries, selectedLutPath],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <Text variant={TextVariants.title}>{t('ui.lut.luts')}</Text>
        <button
          className="p-2 rounded-full hover:bg-surface transition-colors"
          onClick={handleImport}
          data-tooltip={t('ui.lut.import')}
          aria-label={t('ui.lut.import')}
        >
          <Upload size={18} />
        </button>
      </div>

      <div className="grow min-h-0 overflow-y-auto p-4">
        {isLoadingEntries && entries.length === 0 ? (
          <Text
            as="div"
            variant={TextVariants.heading}
            color={TextColors.secondary}
            weight={TextWeights.normal}
            className="text-center mt-4"
          >
            <Loader2 size={14} className="animate-spin inline-block mr-2" /> {t('ui.lut.loading')}
          </Text>
        ) : entries.length === 0 ? (
          <button
            onClick={handleImport}
            className="w-full flex items-center justify-center gap-1.5 py-4 rounded-md bg-bg-tertiary hover:bg-surface border-2 border-dashed border-text-secondary/20 hover:border-text-secondary/40 text-sm text-text-primary transition-colors"
          >
            <Upload size={16} />
            {t('ui.lut.import')}
          </button>
        ) : (
          <>
            {Array.from({ length: Math.ceil(entries.length / (isWide ? 2 : 1)) }).map((_, rowIndex) => {
              const columns = isWide ? 2 : 1;
              const start = rowIndex * columns;
              const rowEntries = entries.slice(start, start + columns);
              const isSelectedRow = selectedIndex >= start && selectedIndex < start + columns;
              const isLastRow = rowIndex === Math.ceil(entries.length / columns) - 1;
              return (
                <Fragment key={rowIndex}>
                  <div
                    className={clsx('grid gap-3', isWide ? 'grid-cols-2' : 'grid-cols-1', !isLastRow && 'mb-2.5')}
                    role="row"
                  >
                    {rowEntries.map((entry) => {
                      const thumb = previews[entry.path];
                      const isSelected = entry.path === selectedLutPath;
                      return (
                        <div key={entry.path} className="flex flex-col">
                          <button
                            onClick={() => handleSelect(entry.path)}
                            onContextMenu={(e) => handleContextMenu(e, entry)}
                            onMouseEnter={() => setLutPreviewOverride(entry.path)}
                            onMouseLeave={() => setLutPreviewOverride(null)}
                            className={clsx(
                              'relative aspect-square rounded-md overflow-hidden bg-bg-tertiary border-2 transition-colors text-left',
                              isSelected ? 'border-accent' : 'border-transparent hover:border-surface',
                            )}
                            data-tooltip={entry.name}
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
                          </button>
                          <Text
                            variant={TextVariants.small}
                            color={isSelected ? TextColors.primary : TextColors.secondary}
                            weight={isSelected ? TextWeights.medium : TextWeights.normal}
                            className="mt-1.5 truncate px-0.5"
                          >
                            {entry.name}
                          </Text>
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
                  {isSelectedRow && selectedEntry && (
                    <LutDetailPanel
                      key={selectedEntry.path}
                      entry={selectedEntry}
                      lutIntensity={lutIntensity}
                      lutInputOffset={lutInputOffset}
                      lutInputRange={lutInputRange}
                      defaultIntensity={defaultParams.intensity}
                      defaultInputOffset={defaultParams.inputOffset}
                      defaultInputRange={defaultParams.inputRange}
                      onDragStateChange={handleDragStateChange}
                      onUpdate={updateLutAdjustment}
                      onSaveAsDefault={handleSaveAsDefault}
                      onResetToDefault={handleResetToDefault}
                    />
                  )}
                </Fragment>
              );
            })}
            {(entries.length === 0 || !isWide || entries.length % 2 === 0) && (
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
      </div>

      {hotkeyModalState.entry && (
        <ConfigureLutHotkeyModal
          isOpen={hotkeyModalState.isOpen}
          onClose={() => setHotkeyModalState({ isOpen: false, entry: null })}
          lutPath={hotkeyModalState.entry.path}
          lutName={hotkeyModalState.entry.name}
          osPlatform={osPlatform}
          onSaved={({ newPath, newName }) => {
            refreshList();
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
    </div>
  );
}

interface LutDetailPanelProps {
  lutIntensity: number;
  lutInputOffset: number;
  lutInputRange: number;
  defaultIntensity: number;
  defaultInputOffset: number;
  defaultInputRange: number;
  onDragStateChange: (isDragging: boolean) => void;
  onUpdate: (adjustmentPatch: Partial<Adjustments>) => void;
  onSaveAsDefault: () => void;
  onResetToDefault: () => void;
}

const LutDetailPanel = memo(function LutDetailPanel({
  lutIntensity,
  lutInputOffset,
  lutInputRange,
  defaultIntensity,
  defaultInputOffset,
  defaultInputRange,
  onDragStateChange,
  onUpdate,
  onSaveAsDefault,
  onResetToDefault,
}: LutDetailPanelProps) {
  const { t } = useTranslation();

  const isAlreadyDefault =
    lutIntensity === defaultIntensity && lutInputOffset === defaultInputOffset && lutInputRange === defaultInputRange;

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

  return (
    <div
      className="w-full mt-4 pt-3 pb-10 border-t border-surface"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="space-y-1 px-0.5">
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
      </div>
    </div>
  );
});
