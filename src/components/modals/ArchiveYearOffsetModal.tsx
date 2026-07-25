import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';

interface ArchiveYearOffsetModalProps {
  isOpen: boolean;
  targetYear: string;
  onClose(): void;
  onSubmit(offset: number): void;
}

export default function ArchiveYearOffsetModal({ isOpen, targetYear, onClose, onSubmit }: ArchiveYearOffsetModalProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('0');
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      setValue('0');
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
        setValue('0');
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    const parsed = parseInt(trimmed, 10);
    if (trimmed !== '' && Number.isNaN(parsed)) {
      return;
    }
    onSubmit(Number.isNaN(parsed) ? 0 : parsed);
    onClose();
  }, [value, onSubmit, onClose]);

  const handleKeyDown = useCallback(
    (e: any) => {
      if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSubmit, onClose],
  );

  if (!isMounted) {
    return null;
  }

  const isValid = value.trim() === '' || !Number.isNaN(parseInt(value.trim(), 10));

  return (
    <div
      aria-modal="true"
      className={`
        fixed inset-0 flex items-center justify-center z-50
        bg-black/30 backdrop-blur-xs
        transition-opacity duration-300 ease-in-out
        ${show ? 'opacity-100' : 'opacity-0'}
      `}
      onClick={onClose}
      role="dialog"
    >
      <div
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-sm
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        onClick={(e: any) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t('modals.archiveYearOffset.title', { targetYear })}
        </Text>
        <p className="text-text-secondary text-sm mb-4">{t('modals.archiveYearOffset.description', { targetYear })}</p>
        <input
          autoFocus
          className="w-full bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-accent"
          onChange={(e: any) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('modals.archiveYearOffset.placeholder')}
          type="text"
          value={value}
        />
        <div className="flex justify-end gap-3 mt-5">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.archiveYearOffset.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
            disabled={!isValid}
            onClick={handleSubmit}
          >
            {t('modals.archiveYearOffset.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
