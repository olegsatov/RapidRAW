import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import Text from './Text';

interface CatalogBackupBannerProps {
  pendingCount: number;
  onBackup(): void;
  onDismiss(): void;
  isOpen?: boolean;
}

export default function CatalogBackupBanner({
  pendingCount,
  onBackup,
  onDismiss,
  isOpen = true,
}: CatalogBackupBannerProps) {
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      const timer = setTimeout(() => {
        setShow(true);
      }, 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={`
        fixed bottom-4 left-1/2 -translate-x-1/2 z-50
        flex items-center gap-4 px-4 py-3 rounded-lg
        bg-bg-secondary border border-border-color shadow-lg
        max-w-md w-[calc(100%-2rem)]
        transform transition-all duration-300 ease-out
        ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
      `}
    >
      <Text className="flex-1 min-w-0" role="status" aria-live="polite">
        {t('catalogBackup.banner.message', { count: pendingCount })}
      </Text>
      <div className="flex items-center gap-2 shrink-0">
        <Button onClick={onBackup}>{t('catalogBackup.banner.backup')}</Button>
        <Button variant="ghost" onClick={onDismiss} className="bg-surface text-text-primary">
          {t('catalogBackup.banner.later')}
        </Button>
      </div>
    </div>
  );
}
