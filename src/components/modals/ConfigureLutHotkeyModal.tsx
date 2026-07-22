import { useCallback, useEffect, useMemo, useRef, useState, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-toastify';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import Button from '../ui/Button';
import HotkeyCapture from '../ui/HotkeyCapture';
import { getEffectiveKeybind, KEYBIND_DEFINITIONS } from '../../utils/keyboardUtils';
import { usePresetStore } from '../../store/usePresetStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { saveLutParams } from '../../utils/lutSettings';
import type { LutFileSettings } from '../ui/AppProperties';

interface ConfigureLutHotkeyModalProps {
  isOpen: boolean;
  onClose(): void;
  lutPath: string;
  lutName: string;
  osPlatform: string;
  onSaved?(payload: { newPath?: string; newName?: string }): void;
}

export default function ConfigureLutHotkeyModal({
  isOpen,
  onClose,
  lutPath,
  lutName,
  osPlatform,
  onSaved,
}: ConfigureLutHotkeyModalProps) {
  const { t } = useTranslation();
  const [hotkey, setHotkey] = useState<string[] | null>(null);
  const [nameValue, setNameValue] = useState(lutName);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const appSettings = useSettingsStore((s) => s.appSettings);
  const presets = usePresetStore((s) => s.presets);
  const updatePreset = usePresetStore((s) => s.updatePreset);
  const allPresets = useMemo(() => {
    const result = [];
    for (const item of presets) {
      if (item.preset) result.push(item.preset);
      else if (item.folder) result.push(...item.folder.children);
    }
    return result;
  }, [presets]);

  useEffect(() => {
    if (isOpen) {
      setHotkey(useSettingsStore.getState().appSettings?.lutSettings?.[lutPath]?.hotkey ?? null);
      setNameValue(lutName);
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
        setHotkey(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, lutPath, lutName]);

  useEffect(() => {
    if (isOpen && overlayRef.current) {
      overlayRef.current.focus();
    }
  }, [isOpen]);

  const conflict = useMemo(() => {
    if (!hotkey || hotkey.length === 0) return null;
    const key = hotkey.join('+');
    const userKb = appSettings?.keybinds || {};
    for (const def of KEYBIND_DEFINITIONS) {
      const combo = getEffectiveKeybind(userKb[def.action], def.defaultCombo);
      if (combo && combo.join('+') === key) {
        return { type: 'app' as const, label: t(def.description as string, def.description) };
      }
    }
    for (const preset of allPresets) {
      if (preset.hotkey && preset.hotkey.join('+') === key) {
        return { type: 'preset' as const, label: preset.name };
      }
    }
    const lutSettings = appSettings?.lutSettings || {};
    for (const [path, settings] of Object.entries(lutSettings)) {
      if (path === lutPath) continue;
      if (settings?.hotkey && settings.hotkey.join('+') === key) {
        return { type: 'lut' as const, label: path.split(/[\\/]/).pop() || path };
      }
    }
    return null;
  }, [hotkey, appSettings?.keybinds, appSettings?.lutSettings, allPresets, lutPath, t]);

  const handleOverwrite = useCallback(() => {
    if (!hotkey || hotkey.length === 0 || !conflict) return;
    const key = hotkey.join('+');

    if (conflict.type === 'app') {
      const currentSettings = useSettingsStore.getState().appSettings;
      if (!currentSettings) return;
      const newKeybinds = { ...(currentSettings.keybinds || {}) };
      for (const def of KEYBIND_DEFINITIONS) {
        const combo = getEffectiveKeybind(newKeybinds[def.action], def.defaultCombo);
        if (combo && combo.join('+') === key) {
          newKeybinds[def.action] = [];
          break;
        }
      }
      useSettingsStore.getState().handleSettingsChange({ ...currentSettings, keybinds: newKeybinds });
    } else if (conflict.type === 'preset') {
      for (const preset of allPresets) {
        if (preset.hotkey?.join('+') === key) {
          updatePreset(preset.id, (p) => ({ ...p, hotkey: null }));
          break;
        }
      }
    } else {
      const lutSettings = appSettings?.lutSettings || {};
      for (const [path, settings] of Object.entries(lutSettings)) {
        if (path === lutPath) continue;
        if (settings?.hotkey?.join('+') === key) {
          saveLutParams(path, { hotkey: null });
          break;
        }
      }
    }
  }, [hotkey, conflict, allPresets, updatePreset, appSettings?.lutSettings, lutPath]);

  const handleSave = useCallback(async () => {
    const trimmedName = nameValue.trim();
    if (trimmedName.length === 0) {
      toast.error(t('modals.configureLutHotkey.emptyName'));
      return;
    }

    try {
      let targetPath = lutPath;
      let renamed = false;

      if (trimmedName !== lutName) {
        const result = await invoke<{ old_path: string; new_path: string; name: string }>('rename_lut', {
          path: lutPath,
          newName: trimmedName,
        });
        targetPath = result.new_path;
        renamed = true;
      }

      const baseSettings = appSettings?.lutSettings || {};
      const oldEntry = baseSettings[lutPath];
      const nextSettings: Record<string, LutFileSettings> = { ...baseSettings };
      if (renamed) {
        delete nextSettings[lutPath];
      }
      const targetEntry = nextSettings[targetPath] || (renamed ? oldEntry : {}) || {};
      nextSettings[targetPath] = { ...targetEntry, hotkey };

      const nextAppSettings = { ...appSettings, lutSettings: nextSettings };
      useSettingsStore.getState().setAppSettings(nextAppSettings);
      await useSettingsStore.getState().handleSettingsChange(nextAppSettings);

      onSaved?.(renamed ? { newPath: targetPath, newName: trimmedName } : {});
      onClose();
    } catch (err) {
      toast.error(`${t('modals.configureLutHotkey.saveFailed')}: ${err}`);
    }
  }, [appSettings, hotkey, lutName, lutPath, nameValue, onClose, onSaved, t]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  if (!isMounted) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      className={`
        fixed inset-0 flex items-center justify-center z-50
        bg-black/30 backdrop-blur-xs
        transition-opacity duration-300 ease-in-out
        ${show ? 'opacity-100' : 'opacity-0'}
      `}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      onKeyDown={handleKeyDown}
    >
      <div
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-md max-h-[calc(90vh+100px)] flex flex-col
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t('modals.configureLutHotkey.title')}
        </Text>

        <div className="grow overflow-y-auto pr-2 -mr-2 space-y-6">
          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.configureLutHotkey.nameLabel')}
            </Text>
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-bg-primary border border-surface text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
              placeholder={lutName}
            />
          </div>

          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.configureLutHotkey.hotkeyLabel')}
            </Text>
            <HotkeyCapture
              combo={hotkey}
              onChange={setHotkey}
              osPlatform={osPlatform}
              conflict={conflict}
              onOverwrite={handleOverwrite}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-surface">
          <Button
            className="px-4 py-2 rounded-md text-text-secondary bg-surface hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.configureLutHotkey.cancel')}
          </Button>
          <Button onClick={handleSave}>{t('modals.configureLutHotkey.save')}</Button>
        </div>
      </div>
    </div>
  );
}
