import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import Text from './Text';
import { TextVariants } from '../../types/typography';

interface CatalogBackupExitDialogProps {
  isOpen: boolean;
  pendingCount: number;
  onBackup(): void;
  onQuitWithoutBackup(): void;
  onCancel(): void;
}

export default function CatalogBackupExitDialog({
  isOpen,
  pendingCount,
  onBackup,
  onQuitWithoutBackup,
  onCancel,
}: CatalogBackupExitDialogProps) {
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={`
        fixed inset-0 flex items-center justify-center z-50
        bg-black/30 backdrop-blur-xs
        transition-opacity duration-300 ease-in-out
        ${show ? 'opacity-100' : 'opacity-0'}
      `}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="catalog-backup-exit-title"
      aria-describedby="catalog-backup-exit-message"
      onKeyDown={handleKeyDown}
    >
      <div
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-md
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} id="catalog-backup-exit-title" className="mb-4">
          {t('catalogBackup.exitDialog.title')}
        </Text>
        <Text id="catalog-backup-exit-message" className="mb-6 whitespace-pre-wrap">
          {t('catalogBackup.exitDialog.message', { count: pendingCount })}
        </Text>
        <div className="flex justify-end gap-3 mt-5">
          <Button variant="ghost" onClick={onCancel} className="bg-surface text-text-primary">
            {t('catalogBackup.exitDialog.cancel')}
          </Button>
          <Button
            variant="ghost"
            onClick={onQuitWithoutBackup}
            className="bg-error text-white hover:bg-error/90 shadow-none"
          >
            {t('catalogBackup.exitDialog.quitWithoutBackup')}
          </Button>
          <Button onClick={onBackup} autoFocus={true}>
            {t('catalogBackup.exitDialog.backup')}
          </Button>
        </div>
      </div>
    </div>
  );
}
