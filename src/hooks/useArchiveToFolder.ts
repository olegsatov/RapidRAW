import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';

import { useArchiveStore } from '../store/useArchiveStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useUIStore } from '../store/useUIStore';

export interface ArchiveResult {
  archived: string[];
  failed: Array<[string, string]>;
}

interface UseArchiveToFolderProps {
  refreshAllFolderTrees: () => Promise<void>;
  refreshImageList: () => Promise<void>;
}

export function useArchiveToFolder({ refreshAllFolderTrees, refreshImageList }: UseArchiveToFolderProps) {
  const { t } = useTranslation();
  const { startArchive, setError, finishArchive } = useArchiveStore();

  const runArchive = useCallback(
    async (sourcePath: string, targetRoot: string, sourceName: string, yearOffset: number) => {
      startArchive(sourcePath, targetRoot, 0);

      try {
        console.log('[archive] invoking archive_folder_to with yearOffset:', yearOffset);
        const result = await invoke<ArchiveResult>('archive_folder_to', {
          sourcePath,
          targetRoot,
          yearOffset,
        });
        console.log('[archive] result:', result);

        if (result.failed.length > 0) {
          console.error('[archive] failed files:', result.failed);
        }

        if (result.archived.length === 0) {
          setError(t('contextMenus.toasts.archiveFailed'));
          toast.error(t('contextMenus.toasts.archiveFailed'));
          return;
        }

        await refreshAllFolderTrees();
        const currentPath = useLibraryStore.getState().currentFolderPath;
        if (currentPath && (currentPath === sourcePath || currentPath.startsWith(`${sourcePath}/`))) {
          await refreshImageList();
        }

        const deleteConfirmed = window.confirm(
          t('contextMenus.folders.archiveTo.deleteSources', {
            count: result.archived.length,
            folderName: sourceName,
          }),
        );

        if (deleteConfirmed) {
          const failures = await invoke<Array<[string, string]>>('delete_archived_sources', {
            paths: result.archived,
          });
          if (failures.length > 0) {
            console.error('[archive] source delete failures:', failures);
            toast.error(t('contextMenus.toasts.archiveDeletePartial', { count: failures.length }));
          } else {
            toast.success(t('contextMenus.toasts.archiveDeleted', { count: result.archived.length }));
          }
        }

        if (result.failed.length > 0) {
          toast.warning(
            t('contextMenus.toasts.archivePartial', {
              archived: result.archived.length,
              failed: result.failed.length,
            }),
          );
        } else {
          toast.success(t('contextMenus.toasts.archiveSuccess', { count: result.archived.length }));
        }
      } catch (err) {
        const message = typeof err === 'string' ? err : String(err);
        setError(message);
        toast.error(t('contextMenus.toasts.archiveError', { err: message }));
      } finally {
        finishArchive();
      }
    },
    [t, startArchive, setError, finishArchive, refreshAllFolderTrees, refreshImageList],
  );

  const archiveFolder = useCallback(
    async (sourcePath: string) => {
      const targetRoot = await open({ directory: true, multiple: false });
      if (!targetRoot || typeof targetRoot !== 'string') {
        return;
      }

      const normalizedSource = sourcePath.replace(/\\/g, '/').replace(/\/$/, '');
      const normalizedTarget = targetRoot.replace(/\\/g, '/').replace(/\/$/, '');

      if (normalizedSource === normalizedTarget) {
        toast.error(t('contextMenus.toasts.archiveSameFolder'));
        return;
      }

      const sourceName = normalizedSource.split('/').filter(Boolean).pop() ?? normalizedSource;

      const targetBasename = normalizedTarget.split('/').filter(Boolean).pop() ?? '';
      const isYearRoot = /^\d{4}$/.test(targetBasename);
      console.log('[archive] targetRoot:', targetRoot, 'basename:', targetBasename, 'isYearRoot:', isYearRoot);

      const proceed = async (yearOffset: number) => {
        const confirmed = window.confirm(
          t('contextMenus.folders.archiveTo.confirm', {
            folderName: sourceName,
            targetRoot: normalizedTarget,
          }),
        );
        if (!confirmed) {
          return;
        }
        await runArchive(sourcePath, targetRoot, sourceName, yearOffset);
      };

      if (isYearRoot) {
        useUIStore.getState().setUI({
          archiveYearOffsetModalState: {
            isOpen: true,
            targetYear: targetBasename,
            onSubmit: (offset) => proceed(offset),
            onCancel: () => {},
          },
        });
        return;
      }

      await proceed(0);
    },
    [t, runArchive],
  );

  return { archiveFolder };
}
