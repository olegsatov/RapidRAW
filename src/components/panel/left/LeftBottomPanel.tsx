import { useCallback } from 'react';
import { LeftPanelTab } from '../../ui/AppProperties';
import { useUIStore } from '../../../store/useUIStore';
import LeftPanelTabs from './LeftPanelTabs';
import PresetsBrowser from '../../presets/PresetsBrowser';

interface LeftBottomPanelProps {
  onNavigateToCommunity(): void;
}

export default function LeftBottomPanel({ onNavigateToCommunity }: LeftBottomPanelProps) {
  const isVisible = useUIStore((state) => state.uiVisibility.leftBottomPanel);
  const activeLeftBottomTab = useUIStore((state) => state.activeLeftBottomTab);
  const setUI = useUIStore((state) => state.setUI);

  const handleTabSelect = useCallback(
    (tab: LeftPanelTab) => {
      setUI({ activeLeftBottomTab: tab });
    },
    [setUI],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-secondary rounded-lg">
      <LeftPanelTabs activeTab={activeLeftBottomTab} onSelect={handleTabSelect} />
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeLeftBottomTab === LeftPanelTab.Presets && (
          <PresetsBrowser isVisible={isVisible} onNavigateToCommunity={onNavigateToCommunity} />
        )}
      </div>
    </div>
  );
}
