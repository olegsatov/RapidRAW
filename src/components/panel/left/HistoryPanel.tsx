import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, Plus } from 'lucide-react';
import { useEditorStore } from '../../../store/useEditorStore';
import { useHistoryNames } from '../../../hooks/useHistoryNames';
import { getPanelIcon } from '../../../utils/panelIcons';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';

function getDefaultSnapshotName(language: string): string {
  const now = new Date();
  return now.toLocaleString(language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryPanel() {
  const { t, i18n } = useTranslation();
  const history = useEditorStore((state) => state.history);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const historyLabels = useEditorStore((state) => state.historyLabels);
  const historySources = useEditorStore((state) => state.historySources);
  const pushNamedSnapshot = useEditorStore((state) => state.pushNamedSnapshot);
  const goToHistoryIndex = useEditorStore((state) => state.goToHistoryIndex);
  const historyNames = useHistoryNames(history, historyLabels);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isNaming, setIsNaming] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');

  useEffect(() => {
    const activeEl = listRef.current?.querySelector('[data-active="true"]');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [historyIndex, history.length]);

  useEffect(() => {
    if (isNaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isNaming]);

  const handleStartNaming = () => {
    setSnapshotName(getDefaultSnapshotName(i18n.language));
    setIsNaming(true);
  };

  const handleSave = () => {
    const name = snapshotName.trim();
    if (name) {
      pushNamedSnapshot(name);
    }
    setIsNaming(false);
    setSnapshotName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsNaming(false);
      setSnapshotName('');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <Text variant={TextVariants.title}>{t('editor.history.title')}</Text>
        {isNaming ? (
          <input
            ref={inputRef}
            type="text"
            value={snapshotName}
            onChange={(e) => setSnapshotName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            placeholder={t('editor.history.snapshot.placeholder')}
            className="w-32 bg-surface border border-transparent rounded-md px-2 py-1 text-sm focus:outline-hidden"
          />
        ) : (
          <button
            className="p-2 rounded-full hover:bg-surface transition-colors"
            onClick={handleStartNaming}
            data-tooltip={t('editor.history.snapshot.tooltip')}
          >
            <Plus size={18} />
          </button>
        )}
      </div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-1">
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
              const isSnapshot = !!historyLabels[i];
              const source = historySources[i];
              const SourceIcon = getPanelIcon(source);
              return (
                <button
                  key={i}
                  type="button"
                  data-active={isActive}
                  aria-pressed={isActive}
                  onClick={() => goToHistoryIndex(i)}
                  className={`w-full text-left px-3 py-1.5 transition-colors flex items-center gap-2 ${
                    isActive ? 'bg-surface' : i > historyIndex ? 'opacity-50 hover:bg-surface' : 'hover:bg-surface'
                  }`}
                >
                  {isSnapshot && (
                    <Bookmark
                      size={14}
                      className={isActive ? 'text-text-primary' : 'text-text-secondary'}
                      fill="currentColor"
                    />
                  )}
                  {!isSnapshot && SourceIcon && (
                    <SourceIcon size={14} className={isActive ? 'text-text-primary' : 'text-text-secondary'} />
                  )}
                  <Text
                    variant={TextVariants.body}
                    color={isActive ? TextColors.primary : TextColors.secondary}
                    weight={isSnapshot ? TextWeights.semibold : isActive ? TextWeights.medium : TextWeights.normal}
                  >
                    {historyNames[i] ?? ''}
                  </Text>
                </button>
              );
            })}
      </div>
    </div>
  );
}
