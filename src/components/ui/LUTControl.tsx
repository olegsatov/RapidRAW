import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, Upload, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { useContextMenu } from '../../context/ContextMenuContext';
import { toast } from 'react-toastify';
import Slider from './Slider';
import Text from './Text';
import { useEditorStore } from '../../store/useEditorStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { LutFileSettings } from './AppProperties';
import { TextVariants } from '../../types/typography';

interface LutEntry {
  name: string;
  path: string;
}

interface LutPreview {
  path: string;
  thumb: string | null;
}

interface LUTControlProps {
  lutPath: string | null;
  lutName: string | null;
  lutIntensity: number;
  lutTiming?: 'after' | 'before';
  lutInputRange?: number;
  lutInputOffset?: number;
  onLutSelect: (path: string) => void;
  onLutHover?: (path: string | null) => void;
  onIntensityChange: (intensity: number) => void;
  onTimingChange?: (timing: 'after' | 'before') => void;
  onInputRangeChange?: (range: number) => void;
  onInputOffsetChange?: (offset: number) => void;
  onClear: () => void;
  onDragStateChange?: (isDragging: boolean) => void;
}

const PREVIEW_SIZE = 112;

export default function LUTControl({
  lutPath,
  lutName,
  lutIntensity,
  lutTiming = 'before',
  lutInputRange = 6,
  lutInputOffset = 0,
  onLutSelect,
  onLutHover,
  onIntensityChange,
  onTimingChange,
  onInputRangeChange,
  onInputOffsetChange,
  onClear,
  onDragStateChange,
}: LUTControlProps) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const isImageReady = useEditorStore((state) => state.selectedImage?.isReady ?? false);
  const lutSettings = useSettingsStore((state) => state.appSettings?.lutSettings);

  const [entries, setEntries] = useState<LutEntry[]>([]);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [isLoadingPreviews, setIsLoadingPreviews] = useState(false);
  // Per-path staleness keys (image + saved per-LUT params): a swatch is
  // regenerated only when the image or that LUT's own params change.
  const previewCache = useRef<Map<string, { key: string; thumb: string | null }>>(new Map());

  const handleContextMenu = (event: React.MouseEvent, entry: LutEntry) => {
    event.preventDefault();
    event.stopPropagation();

    showContextMenu(event.clientX, event.clientY, [
      {
        label: t('ui.lut.removeLut'),
        icon: Trash2,
        isDestructive: true,
        onClick: async () => {
          try {
            const updatedList = await invoke<LutEntry[]>('remove_lut', { path: entry.path });
            setEntries(updatedList);
            setPreviews((prev) => {
              const next = { ...prev };
              delete next[entry.path];
              return next;
            });
            previewCache.current.clear();
            if (entry.path === lutPath) {
              onClear();
            }
          } catch (err) {
            console.error('Failed to remove LUT:', err);
          }
        },
      },
    ]);
  };

  const refreshList = useCallback(async () => {
    try {
      const list = await invoke<LutEntry[]>('list_luts');
      setEntries(list);
    } catch (err) {
      console.error('Failed to list LUTs:', err);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!selectedImagePath || !isImageReady || entries.length === 0) {
      return;
    }
    const keyFor = (path: string) => `${selectedImagePath}|${JSON.stringify(lutSettings?.[path] ?? null)}`;
    const stalePaths = entries
      .map((entry) => entry.path)
      .filter((path) => previewCache.current.get(path)?.key !== keyFor(path));
    if (stalePaths.length === 0) {
      return;
    }

    let isActive = true;
    setIsLoadingPreviews(true);
    // Debounce so slider drags re-render the affected swatch after settling,
    // not on every tick.
    const timer = setTimeout(() => {
      const lutParams: Record<string, LutFileSettings> = {};
      stalePaths.forEach((path) => {
        const stored = lutSettings?.[path];
        if (stored) {
          lutParams[path] = stored;
        }
      });
      invoke<LutPreview[]>('generate_lut_previews', {
        lutPaths: stalePaths,
        size: PREVIEW_SIZE,
        lutParams,
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
        .catch((err) => console.error('Failed to generate LUT previews:', err))
        .finally(() => {
          if (isActive) setIsLoadingPreviews(false);
        });
    }, 250);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [selectedImagePath, isImageReady, entries, lutSettings]);

  const handleImport = async () => {
    try {
      const { osPlatform } = useSettingsStore.getState();
      const isAndroid = osPlatform === 'android';

      const selected = await open({
        multiple: true,
        filters: isAndroid ? [] : [{ name: t('ui.lut.filterLabel'), extensions: ['cube', '3dl', 'CUBE', '3DL'] }],
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
          if (!allowedExtensions.has(ext)) {
            console.warn(`Skipping unsupported file: ${resolvedName}`);
            return false;
          }
          return true;
        });
        if (validPaths.length === 0) {
          toast.error(t('ui.lut.importFailed'));
          return;
        }
      }

      const list = await invoke<LutEntry[]>('import_luts', { sourcePaths: validPaths });
      previewCache.current.clear();
      setEntries(list);
      setPreviews({});
    } catch (err) {
      console.error('Failed to import LUTs:', err);
      toast.error(t('ui.lut.importFailed'));
    }
  };

  const handleSwatchClick = (path: string) => {
    onLutHover?.(null);
    if (path === lutPath) {
      onClear();
    } else {
      onLutSelect(path);
    }
  };

  return (
    <div className="space-y-3">
      <Text variant={TextVariants.heading} className="mb-1">
        {t('ui.lut.mode')}
      </Text>
      <div className="flex gap-1">
        {(['before', 'after'] as const).map((timing) => (
          <button
            key={timing}
            className={clsx(
              'flex-1 px-2 py-1 text-sm font-medium rounded-md transition-colors',
              lutTiming === timing
                ? 'bg-accent text-button-text'
                : 'bg-card-active text-text-secondary hover:bg-surface',
            )}
            onClick={() => onTimingChange?.(timing)}
          >
            {timing === 'after' ? t('ui.lut.timingAfter') : t('ui.lut.timingBefore')}
          </button>
        ))}
      </div>

      <Text variant={TextVariants.heading} className="mb-1">
        {t('ui.lut.parameters')}
      </Text>
      <Slider
        label={t('ui.lut.intensity')}
        min={0}
        max={100}
        step={1}
        value={lutIntensity}
        defaultValue={100}
        onChange={(e) => onIntensityChange(parseInt(String(e.target.value), 10))}
        onDragStateChange={onDragStateChange}
        fillOrigin="min"
      />

      <AnimatePresence initial={false}>
        {lutTiming === 'before' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden space-y-1"
          >
            <Slider
              label={t('ui.lut.inputRange')}
              min={0}
              max={32}
              step={0.1}
              value={lutInputRange}
              defaultValue={6}
              onChange={(e) => onInputRangeChange?.(parseFloat(String(e.target.value)))}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('ui.lut.inputOffset')}
              min={-16}
              max={16}
              step={0.1}
              value={lutInputOffset}
              defaultValue={0}
              onChange={(e) => onInputOffsetChange?.(parseFloat(String(e.target.value)))}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Text variant={TextVariants.heading} className="mb-1">
        {t('ui.lut.luts')}
      </Text>
      <div className="pt-1">
        {entries.length === 0 ? (
          <button
            onClick={handleImport}
            className="w-full flex items-center justify-center gap-1.5 py-4 rounded-md bg-bg-tertiary hover:bg-surface border-2 border-dashed border-text-secondary/20 hover:border-text-secondary/40 text-sm text-text-primary transition-colors"
          >
            <Upload size={16} />
            {t('ui.lut.import')}
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {entries.map((entry) => {
              const thumb = previews[entry.path];
              const isSelected = entry.path === lutPath;
              return (
                <button
                  key={entry.path}
                  onMouseEnter={() => onLutHover?.(entry.path)}
                  onMouseLeave={() => onLutHover?.(null)}
                  onClick={() => handleSwatchClick(entry.path)}
                  onContextMenu={(e) => handleContextMenu(e, entry)}
                  className={`relative aspect-square rounded-md overflow-hidden bg-bg-tertiary border-2 transition-colors ${
                    isSelected ? 'border-accent' : 'border-transparent hover:border-surface'
                  }`}
                  data-tooltip={entry.name}
                >
                  {isLoadingPreviews && thumb === undefined ? (
                    <div className="w-full h-full animate-pulse bg-surface" />
                  ) : thumb ? (
                    <img src={thumb} alt={entry.name} className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-secondary">
                      <ImageOff size={18} />
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[10px] text-white bg-black/50 truncate text-left">
                    {entry.name}
                  </span>
                </button>
              );
            })}
            <button
              onClick={handleImport}
              className="aspect-square rounded-md bg-bg-tertiary border-2 border-text-secondary/25 hover:border-accent flex items-center justify-center text-text-secondary hover:text-text-primary transition-all duration-150"
              data-tooltip={t('ui.lut.import')}
            >
              <Upload size={20} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
