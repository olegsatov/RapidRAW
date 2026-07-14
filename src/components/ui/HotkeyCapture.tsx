import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatKeyCode, normalizeCombo } from '../../utils/keyboardUtils';
import Text from './Text';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';

export interface HotkeyCaptureConflict {
  type: 'app' | 'preset';
  label: string;
}

interface HotkeyCaptureProps {
  combo: string[] | null | undefined;
  onChange: (combo: string[] | null) => void;
  osPlatform: string;
  conflict?: HotkeyCaptureConflict | null;
  onOverwrite?: () => void;
}

const RESERVED_COMBOS = new Set(['Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace']);

export default function HotkeyCapture({ combo, onChange, osPlatform, conflict, onOverwrite }: HotkeyCaptureProps) {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [reservedError, setReservedError] = useState(false);

  const startRecording = useCallback(() => {
    setReservedError(false);
    setIsRecording(true);
  }, []);

  useEffect(() => {
    if (!isRecording) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onChange(null);
        setIsRecording(false);
        setReservedError(false);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const parts = normalizeCombo(e, osPlatform);
      const mainKey = parts[parts.length - 1];

      if (!mainKey || ['ctrl', 'shift', 'alt'].includes(mainKey)) return;

      if (parts.length === 1 && RESERVED_COMBOS.has(mainKey)) {
        setReservedError(true);
        setIsRecording(false);
        return;
      }

      onChange(parts);
      setIsRecording(false);
      setReservedError(false);
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [isRecording, onChange, osPlatform]);

  const displayCombo = combo && combo.length > 0 ? combo : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button onClick={startRecording} className="flex items-center gap-1 flex-wrap shrink-0" type="button">
          {isRecording ? (
            <Text
              as="kbd"
              variant={TextVariants.small}
              color={TextColors.accent}
              weight={TextWeights.semibold}
              className="px-2 py-1 font-sans bg-bg-primary border border-accent rounded-md animate-pulse"
            >
              {t('settings.controls.pressKey')}
            </Text>
          ) : (
            <Text
              as="kbd"
              variant={TextVariants.small}
              color={TextColors.primary}
              weight={TextWeights.semibold}
              className="px-2 py-1 font-sans bg-bg-primary border border-border-color rounded-md cursor-pointer hover:border-accent transition-colors"
            >
              {displayCombo ? (
                displayCombo.map((k) => formatKeyCode(k, osPlatform)).join(' + ')
              ) : (
                <span className="text-text-secondary italic">{t('settings.controls.notAssigned')}</span>
              )}
            </Text>
          )}
        </button>

        {displayCombo && !isRecording && (
          <button
            onClick={() => onChange(null)}
            className="text-text-secondary hover:text-text-primary text-xs"
            type="button"
          >
            ✕
          </button>
        )}
      </div>

      {reservedError && (
        <Text variant={TextVariants.small} color={TextColors.error}>
          {t('modals.configurePreset.hotkeyReserved')}
        </Text>
      )}

      {conflict && !reservedError && (
        <div className="flex items-center gap-2">
          <Text variant={TextVariants.small} color={TextColors.error}>
            {conflict.type === 'app'
              ? t('modals.configurePreset.hotkeyUsedByApp', { action: conflict.label })
              : t('modals.configurePreset.hotkeyUsedByPreset', { name: conflict.label })}
          </Text>
          {onOverwrite && (
            <button onClick={onOverwrite} className="text-xs text-accent hover:underline" type="button">
              {t('modals.configurePreset.hotkeyOverwrite')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
