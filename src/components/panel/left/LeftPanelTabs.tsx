import { SwatchBook } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LeftPanelTab } from '../../ui/AppProperties';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';

interface TabDef {
  id: LeftPanelTab;
  icon: typeof SwatchBook;
  labelKey: string;
}

const TABS: TabDef[] = [{ id: LeftPanelTab.Presets, icon: SwatchBook, labelKey: 'editor.presets.title' }];

interface LeftPanelTabsProps {
  activeTab: LeftPanelTab;
  onSelect(tab: LeftPanelTab): void;
}

export default function LeftPanelTabs({ activeTab, onSelect }: LeftPanelTabsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-surface shrink-0">
      {TABS.map(({ id, icon: Icon, labelKey }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${
              isActive ? 'bg-surface text-text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary'
            }`}
          >
            <Icon size={14} />
            <Text
              variant={TextVariants.small}
              color={isActive ? TextColors.primary : TextColors.secondary}
              weight={isActive ? TextWeights.medium : TextWeights.regular}
            >
              {t(labelKey)}
            </Text>
          </button>
        );
      })}
    </div>
  );
}
