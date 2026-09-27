import { useState, useEffect, type ReactNode } from 'react';
import { LogIn, Upload, Loader2, Cloud, CheckCircle2, AlertCircle, CloudDownload, AlertTriangle, Trash2, HardDrive } from 'lucide-react';
import { getStoragePersistenceStatus, requestPersistentStorage, type StoragePersistenceStatus } from '../../../core/storage/storagePersistence';
import { useLanguage } from '../../../shared/i18n';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLoginModal } from '../../../app/useLoginModal';
import { Section } from './SettingsHelpers';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { useSyncStatus } from '../../../core/sync/useSyncStatus';
import { SyncService } from '../../../core/services/SyncService';
import { setCloudSyncEnabled, CLOUD_SYNC_CHANGED } from '../../../core/sync/cloudSyncEnabled';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { getOversizedRecordCount } from '../../../core/services/LocalStoreSyncService';

interface SyncSettingsSectionProps {
  userId: string;
  onSyncDerivedData?: (userId: string) => Promise<{
    summaries: { synced: number; orphaned?: number };
    embeddings: { synced: number; orphaned?: number };
    stores: { synced: number };
    totalSynced: number;
    totalFailed: number;
    skippedLocked: boolean;
  }>;
  renderRestoreModal?: (props: {
    open: boolean;
    onClose: () => void;
    onRestoreAIData?: ((userId: string) => Promise<{ summaries: number; embeddings?: number; localStoreRecords: number; failed: number }>) | undefined;
  }) => ReactNode;
  onFindOrphans?: (userId: string) => Promise<{ summaries: string[]; embeddings: string[]; cloudChecked: boolean }>;
  onDeleteOrphans?: (userId: string) => Promise<{ summaries: number; embeddings: number }>;
}

export function SyncSettingsSection({ userId, onSyncDerivedData, renderRestoreModal, onFindOrphans, onDeleteOrphans }: SyncSettingsSectionProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { isAuthenticated, isGuest } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const syncStatus = useSyncStatus(userId);
  const { confirm: confirmDialog } = useConfirmDialog();
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingDerived, setSyncingDerived] = useState(false);
  const [cleaningOrphans, setCleaningOrphans] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [autoSync, setAutoSync] = useState(
    () => (userId ? localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(userId)) === 'true' : false)
  );

  useEffect(() => {
    if (!userId) return;
    const read = () => setAutoSync(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(userId)) === 'true');
    // Defer to avoid synchronous setState in effect body
    const t = setTimeout(read, 0);
    // N-42: выбор могут поменять и не здесь — окно вопроса о синхронизации,
    // восстановление из облака, соседняя вкладка. Переключатель это слышит.
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEYS.AUTO_SYNC_ENABLED(userId)) read(); };
    window.addEventListener(CLOUD_SYNC_CHANGED, read);
    window.addEventListener('storage', onStorage);
    return () => {
      clearTimeout(t);
      window.removeEventListener(CLOUD_SYNC_CHANGED, read);
      window.removeEventListener('storage', onStorage);
    };
  }, [userId]);

  const [storageStatus, setStorageStatus] = useState<StoragePersistenceStatus | null>(null);
  const [requestingPersist, setRequestingPersist] = useState(false);

  useEffect(() => {
    void getStoragePersistenceStatus().then(setStorageStatus);
  }, []);

  const handleRequestPersist = async () => {
    setRequestingPersist(true);
    try {
      const persisted = await requestPersistentStorage();
      const updated = await getStoragePersistenceStatus();
      setStorageStatus(updated);
      if (persisted) {
        showToast(t('settings_storage_persist_success'), 'success');
      } else {
        showToast(t('settings_storage_persist_rejected'), 'info');
      }
    } finally {
      setRequestingPersist(false);
    }
  };

  const oversizedCount = getOversizedRecordCount();
  const [retryingQuarantined, setRetryingQuarantined] = useState(false);

  const handleRetryQuarantined = async () => {
    if (!userId) return;
    setRetryingQuarantined(true);
    try {
      await SyncService.retryQuarantinedTasks(userId);
      await SyncService.syncPending(userId);
    } catch (err) {
      reportError(err, { action: 'retryQuarantined' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setRetryingQuarantined(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      // S-1: Run sequentially rather than in Promise.all to avoid racing relink and downloads
      const res = await SyncService.syncAllUnlinked(userId);
      const dlRes = await SyncService.downloadAllFromCloud(userId);

      if (dlRes.locked) {
        showToast(t('settings_sync_vault_locked'), 'error');
      }

      const totalSynced = res.synced + dlRes.downloaded;
      const totalFailed = res.failed + dlRes.failed;
      if (!dlRes.locked || totalSynced > 0) {
        showToast(
          t('settings_sync_all_unlinked_done', { synced: String(totalSynced) }),
          'success'
        );
      }
      if (totalFailed > 0) {
        showToast(
          t('settings_sync_all_unlinked_failed', { failed: String(totalFailed) }),
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

  /**
   * Уборка производных, за которыми не осталось заметки.
   *
   * Сначала опись и подтверждение с числом — это удаление, и молча его делать
   * нельзя. Отдельно обрабатывается недоступное облако: без сверки с ним
   * «заметки нет» означает лишь «нет на этом устройстве», и уборка снесла бы
   * разборы живых заметок.
   */
  const handleCleanOrphans = async () => {
    if (!onFindOrphans || !onDeleteOrphans) return;
    setCleaningOrphans(true);
    try {
      const survey = await onFindOrphans(userId);
      if (!survey.cloudChecked) {
        showToast(t('settings_sync_orphans_offline'), 'error');
        return;
      }
      const count = survey.summaries.length + survey.embeddings.length;
      if (count === 0) {
        showToast(t('settings_sync_orphans_none'), 'success');
        return;
      }
      const ok = await confirmDialog({
        title: t('settings_sync_orphans_confirm_title'),
        message: t('settings_sync_orphans_confirm', { count: String(count) }),
      });
      if (!ok) return;

      const removed = await onDeleteOrphans(userId);
      showToast(
        t('settings_sync_orphans_done', {
          summaries: String(removed.summaries),
          embeddings: String(removed.embeddings),
        }),
        'success',
      );
    } catch (err) {
      reportError(err, { action: 'cleanOrphanedDerivatives' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setCleaningOrphans(false);
    }
  };

  const handleSyncDerived = async () => {
    if (!onSyncDerivedData) return;
    setSyncingDerived(true);
    try {
      const res = await onSyncDerivedData(userId);
      if (res.skippedLocked) {
        // Сначала о том, что успело уехать: проход прерывается на середине, и
        // молчание о сделанном читается как «ничего не вышло».
        if (res.totalSynced > 0) {
          showToast(
            t('settings_sync_derived_done', {
              summaries: String(res.summaries.synced),
              embeddings: String(res.embeddings.synced),
              stores: String(res.stores.synced),
            }),
            'success'
          );
        }
        showToast(t('settings_sync_derived_locked'), 'error');
        return;
      }
      showToast(
        t('settings_sync_derived_done', {
          summaries: String(res.summaries.synced),
          embeddings: String(res.embeddings.synced),
          stores: String(res.stores.synced),
        }),
        'success'
      );
      const orphaned = (res.summaries.orphaned ?? 0) + (res.embeddings.orphaned ?? 0);
      if (orphaned) {
        showToast(
          t('settings_sync_derived_orphaned', { orphaned: String(orphaned) }),
        );
      }
      if (res.totalFailed > 0) {
        showToast(
          t('settings_sync_derived_failed', { failed: String(res.totalFailed) }),
          'error'
        );
      }
    } catch (err) {
      reportError(err, { action: 'syncDerivedData' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setSyncingDerived(false);
    }
  };

  const toggleAutoSync = () => {
    const newVal = !autoSync;
    setAutoSync(newVal);
    if (userId) {
      setCloudSyncEnabled(userId, newVal);
      if (newVal) void SyncService.syncPending(userId);
    }
  };

  return (
    <Section>

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
                  <span className="inline-flex items-center gap-1 font-semibold text-accent-success">
                    <CheckCircle2 size={13} />
                    {t('offline_synced')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-semibold text-accent-warning">
                    <AlertCircle size={13} />
                    {syncStatus.status === 'offline' && t('sync_paused_no_network')}
                    {syncStatus.status === 'cloud_unavailable' && t('sync_paused_cloud_unavailable')}
                    {syncStatus.status === 'pending' && t('sync_paused_pending', { count: String(syncStatus.pendingCount) })}
                    {syncStatus.status === 'unsynced' && t('sync_paused_unsynced', { count: String(syncStatus.unsyncedCount) })}
                    {syncStatus.status === 'ai_store_unsynced' && t('sync_ai_store_pending', { count: String(syncStatus.aiStorePendingCount + syncStatus.aiStoreDeadCount) })}
                    {syncStatus.status === 'sync_off' && t('sync_off_all_uploaded')}
                  </span>
                )}
              </div>
              {syncStatus.unsyncedCount > 0 && (
                <div className="space-y-0.5 text-[11px]">
                  {syncStatus.behindCount > 0 && (
                    <p className="text-accent-warning font-medium">
                      {t('sync_behind_count', { count: String(syncStatus.behindCount) })}
                    </p>
                  )}
                  {syncStatus.unlinkedCount > 0 && (
                    <p className="text-text-main/60">
                      {t('sync_unlinked_count', { count: String(syncStatus.unlinkedCount) })}
                    </p>
                  )}
                </div>
              )}
              {syncStatus.deviceOnlyCount > 0 && (
                <p className="text-[11px] text-text-main/40">
                  {t('sync_device_only_count', { count: String(syncStatus.deviceOnlyCount) })}
                </p>
              )}
              {syncStatus.pendingDeletionsCount > 0 && (
                <p className="text-[11px] text-accent-warning">
                  {t('sync_pending_deletions_count', { count: String(syncStatus.pendingDeletionsCount) })}
                </p>
              )}
              {syncStatus.aiStorePendingCount > 0 && (
                <p className="text-[11px] text-accent-warning">
                  {t('sync_ai_store_pending', { count: String(syncStatus.aiStorePendingCount) })}
                </p>
              )}
              {syncStatus.aiStoreDeadCount > 0 && (
                <p className="text-[11px] text-accent-danger">
                  {t('sync_ai_store_dead', { count: String(syncStatus.aiStoreDeadCount) })}
                </p>
              )}
              {syncStatus.deadCount > 0 && (
                <div className="text-[11px] text-accent-danger flex items-center justify-between gap-2 font-medium">
                  <div className="flex items-center gap-1">
                    <AlertCircle size={12} />
                    <span>{t('sync_quarantined_count', { count: String(syncStatus.deadCount) })}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRetryQuarantined()}
                    disabled={retryingQuarantined}
                    className="underline hover:no-underline text-xs text-accent-danger/80 font-normal cursor-pointer disabled:opacity-50"
                  >
                    {t('sync_quarantined_retry')}
                  </button>
                </div>
              )}
              {oversizedCount > 0 && (
                <div className="text-[11px] text-accent-warning flex items-center gap-1 mt-1">
                  <AlertTriangle size={12} />
                  <span>{oversizedCount} {oversizedCount === 1 ? 'диалог / запись превышает' : 'диалогов / записей превышают'} лимит размера 10 МБ и сохранены только на устройстве (эти диалоги существуют только в этом браузере)</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                onClick={() => void handleSyncAll()}
                disabled={syncingAll}
                data-testid="sync-all-unlinked-btn"
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-border-subtle text-xs text-text-main/70 hover:text-text-main transition-colors disabled:opacity-50"
              >
                {syncingAll ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {t('settings_sync_all_unlinked_progress')}
                  </>
                ) : (
                  <>
                    <Upload size={15} />
                    {t('settings_sync_all_unlinked_button')}
                    {syncStatus.unsyncedCount > 0 && ` (${syncStatus.unsyncedCount})`}
                  </>
                )}
              </Button>

              <Button
                onClick={() => setRestoreModalOpen(true)}
                data-testid="restore-from-cloud-btn"
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-border-subtle text-xs text-text-main/70 hover:text-text-main transition-colors"
              >
                <CloudDownload size={15} />
                Загрузить из облака
              </Button>
            </div>

            <Button
              onClick={() => void handleSyncDerived()}
              disabled={syncingDerived}
              data-testid="sync-derived-data-btn"
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-border-subtle text-xs text-text-main/70 hover:text-text-main transition-colors disabled:opacity-50"
            >
              {syncingDerived ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {t('settings_sync_derived_progress')}
                </>
              ) : (
                <>
                  <Upload size={15} />
                  {t('settings_sync_derived_button')}
                </>
              )}
            </Button>

            {onFindOrphans && onDeleteOrphans && (
              <Button
                onClick={() => void handleCleanOrphans()}
                disabled={cleaningOrphans}
                data-testid="clean-orphans-btn"
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-border-subtle text-xs text-text-main/70 hover:text-text-main transition-colors disabled:opacity-50"
              >
                {cleaningOrphans ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {t('settings_sync_orphans_checking')}
                  </>
                ) : (
                  <>
                    <Trash2 size={15} />
                    {t('settings_sync_orphans_button')}
                  </>
                )}
              </Button>
            )}

            {renderRestoreModal ? renderRestoreModal({ open: restoreModalOpen, onClose: () => setRestoreModalOpen(false) }) : null}
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

      {/* Local storage persistence & estimate */}
      <div className="p-4 rounded-xl border border-border-subtle space-y-3" data-testid="local-storage-card">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-sm font-medium text-text-main flex items-center gap-2">
              <HardDrive size={16} className="text-text-main/60" />
              {t('settings_storage_title')}
            </span>
            <p className="text-xs text-text-main/60">
              {storageStatus?.persisted
                ? t('settings_storage_persisted')
                : t('settings_storage_not_persisted')}
            </p>
          </div>
          {storageStatus && !storageStatus.persisted && (
            <Button
              onClick={() => void handleRequestPersist()}
              disabled={requestingPersist}
              className="px-3 py-1.5 rounded-lg border border-border-subtle text-xs text-text-main/70 hover:text-text-main transition-colors"
            >
              {t('settings_storage_request_btn')}
            </Button>
          )}
        </div>

        {storageStatus?.estimate && (
          <div className="text-xs text-text-main/60 flex items-center gap-2">
            <span>
              {t('settings_storage_usage', {
                usage: storageStatus.estimate.usageFormatted,
                quota: storageStatus.estimate.quotaFormatted,
              })}
            </span>
          </div>
        )}

        {storageStatus && !storageStatus.persisted && (!isAuthenticated || !autoSync) && (
          <div className="p-3 rounded-lg border border-accent-warning/30 bg-accent-warning/10 text-xs text-accent-warning flex items-start gap-2.5">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {t('settings_storage_warning_unprotected')}
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}

