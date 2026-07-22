import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

import PresetsBrowser from '../../presets/PresetsBrowser';
import LutsPanel from './LutsPanel';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';

interface EditorToolsPanelProps {
  isVisible: boolean;
  isInstantTransition?: boolean;
  panelWidth: number;
}

type ToolsTab = 'presets' | 'luts';

const TABS: ToolsTab[] = ['presets', 'luts'];

const TABLIST_ID = 'editor-tools-tablist';
const PRESETS_PANEL_ID = 'editor-tools-presets-panel';
const LUTS_PANEL_ID = 'editor-tools-luts-panel';

export default function EditorToolsPanel({ isVisible, isInstantTransition, panelWidth }: EditorToolsPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ToolsTab>('presets');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="flex items-center gap-1 px-2 py-1.5 border-b border-surface shrink-0"
        role="tablist"
        aria-label={t('ui.editorTools.title')}
        id={TABLIST_ID}
      >
        {TABS.map((id) => {
          const isActive = activeTab === id;
          const label = id === 'presets' ? t('ui.editorTools.presets') : t('ui.editorTools.luts');
          return (
            <button
              key={id}
              id={`${TABLIST_ID}-${id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={id === 'presets' ? PRESETS_PANEL_ID : LUTS_PANEL_ID}
              onClick={() => setActiveTab(id)}
              className={clsx(
                'flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors',
                isActive
                  ? 'bg-surface text-text-primary'
                  : 'text-text-secondary hover:bg-surface hover:text-text-primary',
              )}
            >
              <Text
                variant={TextVariants.small}
                color={isActive ? TextColors.primary : TextColors.secondary}
                weight={isActive ? TextWeights.medium : TextWeights.normal}
              >
                {label}
              </Text>
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'presets' ? (
          <div id={PRESETS_PANEL_ID} role="tabpanel" aria-labelledby={`${TABLIST_ID}-presets`} className="h-full">
            <PresetsBrowser isVisible={isVisible} isInstantTransition={isInstantTransition} />
          </div>
        ) : (
          <div id={LUTS_PANEL_ID} role="tabpanel" aria-labelledby={`${TABLIST_ID}-luts`} className="h-full">
            <LutsPanel isVisible={isVisible} panelWidth={panelWidth} />
          </div>
        )}
      </div>
    </div>
  );
}
