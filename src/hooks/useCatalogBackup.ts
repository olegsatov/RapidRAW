import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { useSettingsStore } from '../store/useSettingsStore';

export interface CatalogBackupState {
  pendingCount: number;
  lastBackupAt: number | null;
  lastBannerAt: number | null;
  destination: string | null;
}

export function useCatalogBackup() {
  const { t } = useTranslation();
  const mountedRef = useRef(true);
  const [state, setState] = useState<CatalogBackupState>({
    pendingCount: 0,
    lastBackupAt: null,
    lastBannerAt: null,
    destination: null,
  });
  const [showBanner, setShowBanner] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const appSettings = useSettingsStore((s) => s.appSettings);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<CatalogBackupState>('get_catalog_backup_state');
      if (!mountedRef.current) return;
      setState(result);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('[catalog-backup] failed to fetch state', err);
    }
  }, []);

  const createBackup = useCallback(
    async (destination?: string) => {
      try {
        const result = await invoke<{ path: string; uncompressed_size: number; compressed_size: number }>(
          'create_catalog_backup',
          { destination: destination ?? null },
        );
        if (!mountedRef.current) return true;
        toast.success(
          t('catalogBackup.toasts.success', {
            path: result.path,
            size: formatBytes(result.compressed_size),
          }),
        );
        await refresh();
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        const message = typeof err === 'string' ? err : String(err);
        toast.error(t('catalogBackup.toasts.error', { error: message }));
        return false;
      }
    },
    [t, refresh],
  );

  const dismissBanner = useCallback(async () => {
    setShowBanner(false);
    try {
      await invoke('dismiss_catalog_backup_banner');
      await refresh();
    } catch (err) {
      console.error('[catalog-backup] failed to dismiss banner', err);
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const threshold = appSettings?.catalogBackupThreshold ?? 50;
    const intervalMinutes = appSettings?.catalogBackupBannerIntervalMinutes ?? 60;
    const now = Date.now() / 1000;
    const lastBanner = state.lastBannerAt ?? 0;
    if (state.pendingCount >= threshold && now - lastBanner >= intervalMinutes * 60) {
      setShowBanner(true);
    } else if (state.pendingCount < threshold) {
      setShowBanner(false);
    }
  }, [state, appSettings]);

  useEffect(() => {
    const unlisten = listen('catalog-backup-completed', () => {
      refresh();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [refresh]);

  useEffect(() => {
    const unlisten = listen('catalog-backup-exit-prompt', () => {
      if (!mountedRef.current) return;
      setShowExitDialog(true);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return {
    ...state,
    showBanner,
    setShowBanner,
    showExitDialog,
    setShowExitDialog,
    createBackup,
    dismissBanner,
    refresh,
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
