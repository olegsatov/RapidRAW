import { useCallback, useEffect, useMemo, useState, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import Button from '../ui/Button';
import PasteModeSwitch from '../ui/PasteModeSwitch';
import AdjustmentKeyPicker from '../ui/AdjustmentKeyPicker';
import HotkeyCapture from '../ui/HotkeyCapture';
import { Preset, AppSettings } from '../ui/AppProperties';
import { COPYABLE_ADJUSTMENT_KEYS, PasteMode } from '../../utils/adjustments';
import { getPresetMode, getPresetIncludedAdjustments } from '../../utils/presetUtils';
import { KEYBIND_DEFINITIONS } from '../../utils/keyboardUtils';
import { usePresetStore } from '../../store/usePresetStore';
import { useSettingsStore } from '../../store/useSettingsStore';

interface ConfigurePresetModalProps {
  isOpen: boolean;
  onClose(): void;
  onSave(name: string, mode: PasteMode, includedAdjustments: string[], hotkey: string[] | null): void;
  initialPreset?: Preset | null;
  osPlatform: string;
}

export default function ConfigurePresetModal({
  isOpen,
  onClose,
  onSave,
  initialPreset,
  osPlatform,
}: ConfigurePresetModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<PasteMode>(PasteMode.Replace);
  const [includedAdjustments, setIncludedAdjustments] = useState<string[]>(COPYABLE_ADJUSTMENT_KEYS);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const [hotkey, setHotkey] = useState<string[] | null>(null);

  const appSettings = useSettingsStore((s) => s.appSettings);
  const updatePreset = usePresetStore((s) => s.updatePreset);
  const presets = usePresetStore((s) => s.presets);
  const allPresets = useMemo(() => {
    const result: Preset[] = [];
    for (const item of presets) {
      if (item.preset) result.push(item.preset);
      else if (item.folder) result.push(...item.folder.children);
    }
    return result;
  }, [presets]);

  useEffect(() => {
    if (isOpen) {
      setName(initialPreset?.name || '');
      setMode(initialPreset ? getPresetMode(initialPreset) : PasteMode.Replace);
      setIncludedAdjustments(
        initialPreset ? getPresetIncludedAdjustments(initialPreset) : [...COPYABLE_ADJUSTMENT_KEYS],
      );
      setHotkey(initialPreset?.hotkey ?? null);
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
        setName('');
        setMode(PasteMode.Replace);
        setIncludedAdjustments([...COPYABLE_ADJUSTMENT_KEYS]);
        setHotkey(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialPreset]);

  const conflict = useMemo(() => {
    if (!hotkey || hotkey.length === 0) return null;
    const key = hotkey.join('+');
    const userKb = appSettings?.keybinds || {};
    for (const def of KEYBIND_DEFINITIONS) {
      const combo = userKb[def.action]?.length ? userKb[def.action] : def.defaultCombo;
      if (combo && combo.join('+') === key) {
        return { type: 'app' as const, label: t(def.description) };
      }
    }
    for (const preset of allPresets) {
      if (preset.id === initialPreset?.id) continue;
      if (preset.hotkey && preset.hotkey.join('+') === key) {
        return { type: 'preset' as const, label: preset.name };
      }
    }
    return null;
  }, [hotkey, appSettings?.keybinds, allPresets, initialPreset?.id, t]);

  const handleOverwrite = useCallback(() => {
    if (!hotkey || hotkey.length === 0 || !conflict) return;

    if (conflict.type === 'app') {
      const newKeybinds = { ...(appSettings?.keybinds || {}) };
      for (const def of KEYBIND_DEFINITIONS) {
        const combo = newKeybinds[def.action]?.length ? newKeybinds[def.action] : def.defaultCombo;
        if (combo && combo.join('+') === hotkey.join('+')) {
          newKeybinds[def.action] = [];
          break;
        }
      }
      useSettingsStore.getState().handleSettingsChange({ ...appSettings, keybinds: newKeybinds } as AppSettings);
    } else {
      const key = hotkey.join('+');
      for (const preset of allPresets) {
        if (preset.id !== initialPreset?.id && preset.hotkey?.join('+') === key) {
          updatePreset(preset.id, (p) => ({ ...p, hotkey: null }));
          break;
        }
      }
    }
  }, [hotkey, conflict, appSettings, allPresets, updatePreset, initialPreset?.id]);

  const handleSave = useCallback(() => {
    if (name.trim()) {
      onSave(name.trim(), mode, includedAdjustments, hotkey);
      onClose();
    }
  }, [name, mode, includedAdjustments, hotkey, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
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
      className={`
        fixed inset-0 flex items-center justify-center z-50
        bg-black/30 backdrop-blur-xs
        transition-opacity duration-300 ease-in-out
        ${show ? 'opacity-100' : 'opacity-0'}
      `}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] flex flex-col
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {initialPreset ? t('modals.configurePreset.titleConfigure') : t('modals.configurePreset.titleSave')}
        </Text>

        <div className="grow overflow-y-auto pr-2 -mr-2 space-y-6">
          <input
            autoFocus
            className="w-full bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('modals.configurePreset.placeholder')}
            type="text"
            value={name}
          />

          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.configurePreset.pasteMode')}
            </Text>
            <PasteModeSwitch selectedMode={mode} onModeChange={setMode} isVisible={show} />
            <Text variant={TextVariants.small} className="mt-2">
              <b>{t('modals.copyPaste.modeMerge')}:</b> {t('modals.copyPaste.descMerge')}
              <br />
              <b>{t('modals.copyPaste.modeReplace')}:</b> {t('modals.copyPaste.descReplace')}
            </Text>
          </div>

          <AdjustmentKeyPicker includedAdjustments={includedAdjustments} onChange={setIncludedAdjustments} />

          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.configurePreset.hotkey')}
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
            {t('modals.configurePreset.cancel')}
          </Button>
          <Button disabled={!name.trim()} onClick={handleSave}>
            {t('modals.configurePreset.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
