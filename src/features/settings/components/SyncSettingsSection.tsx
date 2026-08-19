import { useState } from 'react';
import { LogIn, Upload, Loader2, Cloud, CheckCircle2, AlertCircle } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLoginModal } from '../../../app/useLoginModal';
import { Section } from './SettingsHelpers';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { SyncService } from '../../../core/services/SyncService';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';

interface SyncSettingsSectionProps {
  userId: string;
}

export function SyncSettingsSection({ userId }: SyncSettingsSectionProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { isAuthenticated, isGuest } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const syncStatus = useSyncStatus(userId);
  const [syncingAll, setSyncingAll] = useState(false);
  const [autoSync, setAutoSync] = useState(
    () => localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED) === 'true'
  );

  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      const res = await SyncService.syncAllUnlinked(userId);
      showToast(
        t('settings_sync_all_unlinked_done', { synced: String(res.synced) }),
        'success'
      );
      if (res.failed > 0) {
        showToast(
          t('settings_sync_all_unlinked_failed', { failed: String(res.failed) }),
          'error'
        );
      }
    } catch (err) {
      reportError(err, { action: 'syncAllUnlinked' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setSyncingAll(false);
    }
  };

  const toggleAutoSync = () => {
    const newVal = !autoSync;
    setAutoSync(newVal);
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED, String(newVal));
  };

  return (
    <Section title={t('sync_consent_title')}>
      <p className="text-xs text-text-muted -mt-1 mb-3">
        {t('settings_sync_desc')}
      </p>

      <div className="p-4 rounded-xl border border-border-subtle space-y-4">
        {isAuthenticated ? (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-sm font-medium text-text-main flex items-center gap-2">
                  <Cloud size={16} className="text-text-main/60" />
                  {t('settings_auto_sync')}
                </span>
                <p className="text-xs text-text-main/60">
                  {t('settings_auto_sync_hint')}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleAutoSync}
                role="switch"
                aria-checked={autoSync}
                aria-label={t('settings_auto_sync')}
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors shrink-0",
                  autoSync ? "bg-brand-soft" : "bg-text-main/20"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                    autoSync ? "left-5" : "left-0.5"
                  )}
                />
              </button>
            </div>

            {/* Honest sync state */}
            <div className="p-3 rounded-lg border border-border-subtle bg-surface-base/30 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-main/70">Состояние синхронизации:</span>
                {syncStatus.status === 'synced' ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                    <CheckCircle2 size={13} />
                    {t('offline_synced')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-400">
                    <AlertCircle size={13} />
                    {syncStatus.status === 'offline' && t('sync_paused_no_network')}
                    {syncStatus.status === 'cloud_unavailable' && t('sync_paused_cloud_unavailable')}
                    {syncStatus.status === 'pending' && t('sync_paused_pending', { count: String(syncStatus.pendingCount) })}
                    {syncStatus.status === 'unsynced' && t('sync_paused_unsynced', { count: String(syncStatus.unsyncedCount) })}
                  </span>
                )}
              </div>
              {syncStatus.unsyncedCount > 0 && (
                <p className="text-[11px] text-text-main/50">
                  Не отправлено в облако: {syncStatus.unsyncedCount}
                </p>
              )}
            </div>

            <Button
              onClick={() => void handleSyncAll()}
              disabled={syncingAll}
              data-testid="sync-all-unlinked-btn"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/70 hover:text-text-main transition-colors disabled:opacity-50"
            >
              {syncingAll ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t('settings_sync_all_unlinked_progress')}
                </>
              ) : (
                <>
                  <Upload size={16} />
                  {t('settings_sync_all_unlinked_button')}
                  {syncStatus.unsyncedCount > 0 && ` (${syncStatus.unsyncedCount})`}
                </>
              )}
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-text-main/60">
              {t('storage_cloud_guest_hint')}
            </p>
            {isGuest && (
              <Button
                onClick={openLoginModal}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-border-subtle text-sm text-text-main/70 hover:text-text-main transition-colors"
              >
                <LogIn size={16} />
                {t('storage_sign_in_for_cloud')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
