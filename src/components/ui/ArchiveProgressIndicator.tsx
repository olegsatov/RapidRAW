import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import { useArchiveStore } from '../../store/useArchiveStore';

export default function ArchiveProgressIndicator() {
  const { t } = useTranslation();
  const { isArchiving, sourcePath, targetRoot, progress, errorMessage, reset, finishArchive } = useArchiveStore();

  useEffect(() => {
    if (!isArchiving && (progress.current > 0 || errorMessage)) {
      const timer = window.setTimeout(() => reset(), 5000);
      return () => window.clearTimeout(timer);
    }
  }, [isArchiving, progress.current, errorMessage, reset]);

  if (!isArchiving && progress.current === 0 && !errorMessage) {
    return null;
  }

  const folderName = sourcePath?.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath ?? '';
  const targetName = targetRoot?.split(/[\\/]/).filter(Boolean).pop() ?? targetRoot ?? '';
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      <div className="bg-bg-secondary border border-surface rounded-lg shadow-lg p-3 min-w-[280px]">
        <div className="flex justify-between items-center gap-2 mb-1">
          <span
            className="text-sm font-medium text-text-primary truncate max-w-[200px]"
            title={sourcePath ?? undefined}
          >
            {t('archive.progress.title', { folderName })}
          </span>
          <button
            onClick={() => (isArchiving ? undefined : reset())}
            disabled={isArchiving}
            className="shrink-0 text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
            aria-label={t('archive.progress.dismiss')}
          >
            <X size={14} />
          </button>
        </div>
        <div className="text-xs text-text-secondary mb-1 truncate">
          {errorMessage
            ? errorMessage
            : t('archive.progress.status', {
                current: progress.current,
                total: progress.total,
                targetName,
              })}
        </div>
        <div className="h-1.5 w-full bg-bg-primary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${errorMessage ? 'bg-red-400' : 'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
