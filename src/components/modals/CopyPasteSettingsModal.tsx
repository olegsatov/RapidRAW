import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { COPYABLE_ADJUSTMENT_KEYS, CopyPasteSettings, PasteMode } from '../../utils/adjustments';
import PasteModeSwitch from '../ui/PasteModeSwitch';
import AdjustmentKeyPicker from '../ui/AdjustmentKeyPicker';
import Button from '../ui/Button';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';

interface CopyPasteSettingsModalProps {
  isOpen: boolean;
  onClose(): void;
  onSave(settings: CopyPasteSettings): void;
  settings: CopyPasteSettings;
}

export const DEFAULT_SETTINGS: CopyPasteSettings = {
  mode: PasteMode.Merge,
  includedAdjustments: COPYABLE_ADJUSTMENT_KEYS,
  knownAdjustments: [],
};

export default function CopyPasteSettingsModal({ isOpen, onClose, onSave, settings }: CopyPasteSettingsModalProps) {
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const [localSettings, setLocalSettings] = useState<CopyPasteSettings>(settings || DEFAULT_SETTINGS);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings || DEFAULT_SETTINGS);
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => setIsMounted(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, settings]);

  const handleSave = useCallback(() => {
    onSave(localSettings);
    onClose();
  }, [localSettings, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
      role="dialog"
    >
      <div
        className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-2xl flex flex-col transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t('modals.copyPaste.title')}
        </Text>

        <div className="grow overflow-y-auto pr-2 -mr-2 space-y-6">
          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.copyPaste.pasteMode')}
            </Text>
            <PasteModeSwitch
              selectedMode={localSettings.mode}
              onModeChange={(mode) => setLocalSettings((p) => ({ ...p, mode }))}
              isVisible={show}
            />
            <Text variant={TextVariants.small} className="mt-2">
              <b>{t('modals.copyPaste.modeMerge')}:</b> {t('modals.copyPaste.descMerge')}
              <br />
              <b>{t('modals.copyPaste.modeReplace')}:</b> {t('modals.copyPaste.descReplace')}
            </Text>
          </div>

          <AdjustmentKeyPicker
            includedAdjustments={localSettings.includedAdjustments}
            onChange={(includedAdjustments) => setLocalSettings((p) => ({ ...p, includedAdjustments }))}
          />
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-surface">
          <Button
            className="px-4 py-2 rounded-md text-text-secondary bg-surface hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.copyPaste.cancel')}
          </Button>
          <Button onClick={handleSave}>{t('modals.copyPaste.save')}</Button>
        </div>
      </div>
    </div>
  );
}
