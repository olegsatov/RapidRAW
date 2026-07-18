import { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useFolderImportStore, type FolderImportJob } from '../../store/useFolderImportStore';
import { useFolderImport } from '../../hooks/useFolderImport';

function ImportJobCard({ jobKey, job }: { jobKey: string; job: FolderImportJob }) {
  const { t } = useTranslation();
  const clearJob = useFolderImportStore((s) => s.clearJob);
  const { cancelFolderImport } = useFolderImport();
  const isFinished = job.phase === 'complete' || job.phase === 'cancelled' || job.phase === 'error';

  // Successfully finished jobs linger briefly so the outcome is visible;
  // errors stay until dismissed manually.
  useEffect(() => {
    if (job.phase === 'complete' || job.phase === 'cancelled') {
      const timer = window.setTimeout(() => clearJob(jobKey), 5000);
      return () => window.clearTimeout(timer);
    }
  }, [job.phase, jobKey, clearJob]);

  const total = job.phase === 'exif' ? job.exifTotal : job.phase === 'thumbnails' ? job.thumbsTotal : job.total;
  const current = job.phase === 'exif' ? job.exifCurrent : job.phase === 'thumbnails' ? job.thumbsCurrent : job.scanned;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : job.phase === 'complete' ? 100 : 0;
  const folderName = job.path.split(/[\\/]/).filter(Boolean).pop() || job.path;

  return (
    <div className="bg-bg-secondary border border-surface rounded-lg shadow-lg p-3 min-w-[280px]">
      <div className="flex justify-between items-center gap-2 mb-1">
        <span className="text-sm font-medium text-text-primary truncate max-w-[200px]" title={job.path}>
          {folderName}
        </span>
        <button
          onClick={() => (isFinished ? clearJob(jobKey) : cancelFolderImport(job.path, job.recursive))}
          className="shrink-0 text-text-secondary hover:text-text-primary transition-colors"
          aria-label={isFinished ? t('importJobs.dismiss') : t('importJobs.cancel')}
        >
          <X size={14} />
        </button>
      </div>
      <div className="text-xs text-text-secondary mb-1 truncate">
        {job.kind ? `${t(`importJobs.kind.${job.kind}`)} · ` : ''}
        {job.phase === 'error'
          ? (job.errorMessage ?? t('importJobs.error'))
          : `${t(`importJobs.${job.phase}`)} ${current}/${total}`}
      </div>
      <div className="h-1.5 w-full bg-bg-primary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${job.phase === 'error' ? 'bg-red-400' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function ImportJobsIndicator() {
  const jobs = useFolderImportStore((s) => s.jobs);
  const entries = useMemo(() => Object.entries(jobs), [jobs]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      {entries.map(([key, job]) => (
        <ImportJobCard key={key} jobKey={key} job={job} />
      ))}
    </div>
  );
}
