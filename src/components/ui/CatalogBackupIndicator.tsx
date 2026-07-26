import { HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Text from './Text';
import { TextVariants } from '../../types/typography';

interface CatalogBackupIndicatorProps {
  pendingCount: number;
  onClick(): void;
}

export default function CatalogBackupIndicator({ pendingCount, onClick }: CatalogBackupIndicatorProps) {
  const { t } = useTranslation();
  if (pendingCount === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-text-secondary hover:bg-surface transition-colors"
        data-tooltip={t('catalogBackup.indicator.upToDate')}
        aria-label={t('catalogBackup.indicator.upToDate')}
      >
        <HardDrive size={16} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
      data-tooltip={t('catalogBackup.indicator.tooltip', { count: pendingCount })}
      aria-label={t('catalogBackup.indicator.tooltip', { count: pendingCount })}
    >
      <HardDrive size={16} />
      <Text variant={TextVariants.small} className="font-medium">
        {t('catalogBackup.indicator.label', { count: pendingCount })}
      </Text>
    </button>
  );
}
