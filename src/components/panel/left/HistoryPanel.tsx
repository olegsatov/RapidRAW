import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../../store/useEditorStore';
import { useHistoryNames } from '../../../hooks/useHistoryNames';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';

export default function HistoryPanel() {
  const { t } = useTranslation();
  const history = useEditorStore((state) => state.history);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const goToHistoryIndex = useEditorStore((state) => state.goToHistoryIndex);
  const historyNames = useHistoryNames(history);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeEl = listRef.current?.querySelector('[data-active="true"]');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [historyIndex, history.length]);

  return (
    <div ref={listRef} className="h-full overflow-y-auto py-1">
      {history.length <= 1 && (
        <div className="px-3 py-2">
          <Text variant={TextVariants.small} color={TextColors.secondary}>
            {t('editor.history.empty')}
          </Text>
        </div>
      )}
      {history.length > 1 &&
        history
          .map((_, i) => i)
          .reverse()
          .map((i) => {
            const isActive = i === historyIndex;
            return (
              <button
                key={i}
                type="button"
                data-active={isActive}
                aria-pressed={isActive}
                onClick={() => goToHistoryIndex(i)}
                className={`w-full text-left px-3 py-1.5 transition-colors ${
                  isActive ? 'bg-surface' : i > historyIndex ? 'opacity-50 hover:bg-surface' : 'hover:bg-surface'
                }`}
              >
                <Text
                  variant={TextVariants.small}
                  color={isActive ? TextColors.primary : TextColors.secondary}
                  weight={isActive ? TextWeights.medium : TextWeights.normal}
                >
                  {historyNames[i] ?? ''}
                </Text>
              </button>
            );
          })}
    </div>
  );
}
