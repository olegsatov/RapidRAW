import { useTranslation } from 'react-i18next';
import { ADJUSTMENT_GROUPS, COPYABLE_ADJUSTMENT_KEYS, AdjustmentGroup } from '../../utils/adjustments';
import Button from './Button';
import Switch from './Switch';
import Text from './Text';
import { TextVariants } from '../../types/typography';

interface AdjustmentKeyPickerProps {
  includedAdjustments: string[];
  onChange: (includedAdjustments: string[]) => void;
}

type EnResources = typeof import('../../i18n/locales/en.json');
type SectionKey = keyof EnResources['editor']['adjustments']['sections'];
type GroupLabelKey = `modals.copyPaste.groups.${keyof EnResources['modals']['copyPaste']['groups']}`;

const AdjustmentKeyPicker = ({ includedAdjustments, onChange }: AdjustmentKeyPickerProps) => {
  const { t } = useTranslation();

  const handleSelectAll = () => {
    onChange([...COPYABLE_ADJUSTMENT_KEYS]);
  };

  const handleSelectNone = () => {
    onChange([]);
  };

  const handleGroupToggle = (keys: string[], checked: boolean) => {
    const newSet = new Set(includedAdjustments);
    keys.forEach((key) => {
      if (checked) {
        newSet.add(key);
      } else {
        newSet.delete(key);
      }
    });
    onChange(Array.from(newSet));
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <Text variant={TextVariants.heading}>{t('modals.copyPaste.includedAdjustments')}</Text>
        <div className="flex gap-2">
          <Button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            size="sm"
            onClick={handleSelectAll}
          >
            {t('modals.copyPaste.selectAll')}
          </Button>
          <Button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            size="sm"
            onClick={handleSelectNone}
          >
            {t('modals.copyPaste.selectNone')}
          </Button>
        </div>
      </div>
      <div className="bg-bg-primary p-4 rounded-md max-h-64 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-6">
          {(Object.entries(ADJUSTMENT_GROUPS) as [SectionKey, AdjustmentGroup[]][]).map(([section, groups]) => (
            <div key={section}>
              <Text variant={TextVariants.heading} className="mb-2">
                {t(`editor.adjustments.sections.${section}`)}
              </Text>
              {groups.map((group) => {
                const isFullyChecked = group.keys.every((key) => includedAdjustments.includes(key));

                return (
                  <div key={group.label} className="mb-1.5 last:mb-0">
                    <Switch
                      label={t(group.label as GroupLabelKey)}
                      checked={isFullyChecked}
                      onChange={(checked) => handleGroupToggle(group.keys, checked)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdjustmentKeyPicker;
