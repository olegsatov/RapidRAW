import { useCallback } from 'react';
import { MotionConfig } from 'framer-motion';
import { LeftPanelTab } from '../../ui/AppProperties';
import { useUIStore } from '../../../store/useUIStore';
import { useEditorStore } from '../../../store/useEditorStore';
import LeftPanelTabs from './LeftPanelTabs';
import PresetsBrowser from '../../presets/PresetsBrowser';

export default function LeftBottomPanel() {
  const isVisible = useUIStore((state) => state.uiVisibility.leftBottomPanel);
  const isInstantTransition = useUIStore((state) => state.isInstantTransition);
  const activeLeftBottomTab = useUIStore((state) => state.activeLeftBottomTab);
  const setUI = useUIStore((state) => state.setUI);
  const selectedImage = useEditorStore((state) => state.selectedImage);

  const handleTabSelect = useCallback(
    (tab: LeftPanelTab) => {
      setUI({ activeLeftBottomTab: tab });
    },
    [setUI],
  );

  if (!selectedImage) {
    return <div className="flex flex-col h-full overflow-hidden bg-bg-secondary rounded-lg" />;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-secondary rounded-lg">
      <LeftPanelTabs activeTab={activeLeftBottomTab} onSelect={handleTabSelect} />
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeLeftBottomTab === LeftPanelTab.Presets && (
          <MotionConfig reducedMotion={isInstantTransition ? 'always' : 'user'}>
            <PresetsBrowser isInstantTransition={isInstantTransition} isVisible={isVisible} />
          </MotionConfig>
        )}
      </div>
    </div>
  );
}
