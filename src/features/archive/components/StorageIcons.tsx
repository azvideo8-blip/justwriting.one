import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Cloud, EyeOff, HardDrive, Loader2, Sparkles } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { StorageService } from '../../../core/services/StorageService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { SyncService } from '../../../core/services/SyncService';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { reportError } from '../../../shared/errors/reportError';
import { UnlockPrompt } from '../../../app/UnlockPrompt';
import { EncryptionPasswordModal } from '../../../app/EncryptionPasswordModal';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

interface StorageDoc {
  localId?: string | undefined;
  cloudId?: string | undefined;
  hasLocal: boolean;
  hasCloud: boolean;
  hasPendingSync?: boolean | undefined;
}

/** Разбор заметки ИИ: третья кнопка в ряду, рядом с устройством и облаком.
 *  Заметки не разбираются сами — только по этому нажатию. Повторное нажатие
 *  на разобранной заметке удаляет сводку и вектор, включая облачные копии. */
export interface AIAnalysis {
  processed: boolean;
  loading: boolean;
  onClick: () => void;
}

export interface AIExclusion {
  excluded: boolean;
  loading: boolean;
  onClick: () => void;
}

type ConfirmState =
  | { kind: 'idle' }
  | { kind: 'delete-local-only' }
  | { kind: 'delete-local' }
  | { kind: 'delete-cloud-only' }
  | { kind: 'delete-cloud' }
  | { kind: 'exclude-ai' }
  | { kind: 'download-local' };

const IDLE: ConfirmState = { kind: 'idle' };

export function StorageIcons({
  doc,
  userId,
  onStorageChange,
  ai,
  exclusion,
}: {
  doc: StorageDoc;
  userId: string;
  onStorageChange: () => void;
  ai?: AIAnalysis | undefined;
  exclusion?: AIExclusion | undefined;
}) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { profile } = useAuthStatus();
  const hasEncryption = !!(profile?.encryptionMeta || (profile?.encryptionSalt && profile?.encryptedDataKey));
  const [confirmState, setConfirmState] = useState<ConfirmState>(IDLE);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pendingAction, setPendingAction] = useState<'upload' | 'download' | null>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [showEncryptionSetup, setShowEncryptionSetup] = useState(false);

  const handleLocalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!doc.hasLocal && doc.hasCloud && doc.cloudId) {
      if (hasEncryption && !getSessionKey()) {
        setPendingAction('download');
        setShowUnlock(true);
        return;
      }
      setConfirmState({ kind: 'download-local' });
      return;
    }
    if (!doc.hasLocal) return;
    setConfirmState(doc.hasLocal && !doc.hasCloud ? { kind: 'delete-local-only' } : { kind: 'delete-local' });
  };

  const handleCloudClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (doc.hasCloud && !doc.hasPendingSync) {
      setConfirmState(doc.hasCloud && !doc.hasLocal ? { kind: 'delete-cloud-only' } : { kind: 'delete-cloud' });
      return;
    }
    if (!doc.localId || !userId || userId.startsWith('guest_')) return;
    if (!getSessionKey()) {
      setPendingAction('upload');
      if (hasEncryption) {
        setShowUnlock(true);
      } else {
        setShowEncryptionSetup(true);
      }
      return;
    }
    void doUpload();
  };

  const doDownload = async () => {
    if (!doc.cloudId || !userId || userId.startsWith('guest_')) return;
    setDownloading(true);
    try {
      await StorageService.addLocalCopy(userId, doc.cloudId);
      showToast(t('storage_downloaded_local'), 'success');
      onStorageChange();
    } catch (e) {
      const errStr = String((e as { message?: string })?.message || e);
      if (errStr.startsWith('LOCK_HELD') || errStr.includes('LOCK_HELD')) {
        showToast(t('storage_download_in_progress'), 'info');
      } else {
        reportError(e, { action: 'downloadLocalCopy', userId, cloudId: doc.cloudId });
        if (String(e).includes('LOCKED')) {
          setPendingAction('download');
          setShowUnlock(true);
        } else {
          showToast(t('error_generic_action'), 'error');
        }
      }
    } finally {
      setDownloading(false);
    }
  };

  const doUpload = async () => {
    if (!doc.localId || !userId || userId.startsWith('guest_')) return;
    setUploading(true);
    try {
      if (doc.hasPendingSync) {
        const ok = await SyncService.syncDocument(userId, doc.localId, true);
        if (ok) {
          showToast(t('storage_uploaded_cloud'), 'success');
        } else {
          showToast(t('error_generic_action'), 'error');
        }
      } else {
        const cloudId = await StorageService.addCloudCopy(userId, doc.localId, true);
        if (cloudId) {
          showToast(t('storage_uploaded_cloud'), 'success');
        } else {
          showToast(t('error_generic_action'), 'error');
        }
      }
      onStorageChange();
    } catch (e) {
      reportError(e, { action: doc.hasPendingSync ? 'syncDocument' : 'addCloudCopy', userId, localId: doc.localId });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmDelete = async () => {
    try {
      switch (confirmState.kind) {
        case 'delete-local-only':
          await StorageService.deleteDocument(userId, doc.localId, doc.cloudId);
          showToast(t('storage_deleted_completely'), 'success');
          break;
        case 'delete-local':
          await StorageService.removeLocalCopy(doc.localId!);
          showToast(t('storage_deleted_local'), 'success');
          break;
        case 'delete-cloud-only':
          await StorageService.deleteDocument(userId, doc.localId, doc.cloudId);
          showToast(t('storage_deleted_completely'), 'success');
          break;
        case 'delete-cloud':
          await StorageService.removeCloudCopy(userId, doc.cloudId!);
          if (doc.localId) {
            // Deliberate removal from the cloud: record the intent, do not just
            // drop the link. `updateLinkedCloudId(id, '')` leaves the note looking
            // like one whose link was LOST, and the re-link pass restores it —
            // putting back the copy the user just asked to delete.
            await LocalDocumentService.unlinkFromCloud(doc.localId);
          }
          showToast(t('storage_deleted_cloud'), 'success');
          break;
        case 'exclude-ai':
          if (exclusion) exclusion.onClick();
          break;
        case 'download-local':
          await doDownload();
          break;
      }
      onStorageChange();
    } catch (e) {
      reportError(e, { action: confirmState.kind, userId });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setConfirmState(IDLE);
    }
  };

  const confirmTitle = confirmState.kind === 'idle' ? '' : (() => {
    switch (confirmState.kind) {
      case 'delete-local-only':
      case 'delete-cloud-only':
        return t('storage_confirm_delete_only');
      case 'delete-local':
        return t('storage_confirm_delete_local');
      case 'delete-cloud':
        return t('storage_confirm_delete_cloud');
      case 'exclude-ai':
        return t('ai_note_exclude_confirm');
      case 'download-local':
        return t('storage_confirm_download_local');
    }
  })();

  const confirmHint = confirmState.kind === 'idle' ? '' : (() => {
    switch (confirmState.kind) {
      case 'delete-local-only':
      case 'delete-cloud-only':
        return t('storage_confirm_delete_only_hint');
      case 'delete-local':
        return t('storage_confirm_delete_local_hint');
      case 'delete-cloud':
        return t('storage_confirm_delete_cloud_hint');
      case 'exclude-ai':
        return t('ai_note_exclude_confirm_hint');
      case 'download-local':
        return t('storage_confirm_download_local_hint');
    }
  })();

  const canUpload = !doc.hasCloud && !!doc.localId && !!userId && !userId.startsWith('guest_');
  const isUnsynced = doc.hasPendingSync;

  const cloudTitle = uploading
    ? (t('common_loading') || 'Loading...')
    : isUnsynced
      ? (t('storage_sync_pending') || 'Pending changes (click to sync)')
      : doc.hasCloud
        ? t('storage_remove_cloud')
        : canUpload
          ? t('storage_upload_to_cloud')
          : t('storage_no_cloud');

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <IconButton
        icon={downloading ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />}
        label={
          downloading
            ? (t('storage_downloading') || 'Загрузка…')
            : doc.hasLocal
              ? t('storage_remove_local')
              : doc.hasCloud
                ? (t('storage_download_to_local') || 'Скачать на это устройство')
                : t('storage_no_local')
        }
        onClick={handleLocalClick}
        disabled={downloading}
        size="sm"
        className={cn(
          "w-6 h-6 rounded-lg",
          downloading && "animate-pulse text-brand-primary",
          !downloading && doc.hasLocal && "text-text-main/70 hover:text-accent-danger hover:bg-accent-danger/10",
          !downloading && !doc.hasLocal && doc.hasCloud && "text-text-main/60 hover:text-brand-primary hover:bg-brand-primary/10 cursor-pointer",
          !downloading && !doc.hasLocal && !doc.hasCloud && "text-text-main/60 cursor-default"
        )}
      />

      <IconButton
        icon={uploading ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} style={{
          ...(isUnsynced && !uploading ? {
            filter: 'drop-shadow(0 0 6px var(--accent-warning))',
            transition: 'filter 0.4s ease, color 0.4s ease',
          } : {}),
        }} />}
        label={cloudTitle}
        onClick={(e) => void handleCloudClick(e)}
        disabled={uploading}
        size="sm"
        className={cn(
          "w-6 h-6 rounded-lg",
          uploading && "animate-pulse text-accent-info",
          !uploading && isUnsynced && "text-accent-warning hover:text-accent-warning hover:bg-accent-warning/10 cursor-pointer",
          !uploading && !isUnsynced && doc.hasCloud && "text-accent-info hover:text-accent-danger hover:bg-accent-danger/10",
          !uploading && !isUnsynced && !doc.hasCloud && canUpload && "text-text-main/60 hover:text-accent-info hover:bg-accent-info/10 cursor-pointer",
          !uploading && !isUnsynced && !doc.hasCloud && !canUpload && "text-text-main/60 cursor-default"
        )}
      />

      {exclusion && (
        <IconButton
          icon={exclusion.loading ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} />}
          label={exclusion.loading ? t('common_loading') : exclusion.excluded ? t('ai_note_include') : t('ai_note_exclude')}
          onClick={(e) => {
            e.stopPropagation();
            if (exclusion.loading) return;
            if (exclusion.excluded) {
              exclusion.onClick();
            } else {
              setConfirmState({ kind: 'exclude-ai' });
            }
          }}
          disabled={exclusion.loading}
          size="sm"
          className={cn(
            "w-6 h-6 rounded-lg",
            exclusion.loading && "text-text-main/60",
            !exclusion.loading && exclusion.excluded && "text-accent-danger hover:bg-accent-danger/10",
            !exclusion.loading && !exclusion.excluded && "text-text-main/60 hover:text-text-main hover:bg-text-main/10 cursor-pointer",
          )}
        />
      )}

      {ai && (
        <IconButton
          icon={ai.loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          label={ai.loading ? t('common_loading') : exclusion?.excluded ? t('ai_note_excluded') : ai.processed ? t('ai_note_clear') : t('ai_note_analyze')}
          onClick={(e) => { e.stopPropagation(); if (!ai.loading && !exclusion?.excluded) ai.onClick(); }}
          disabled={ai.loading || !!exclusion?.excluded}
          size="sm"
          className={cn(
            "w-6 h-6 rounded-lg",
            exclusion?.excluded && "text-text-main/20 cursor-not-allowed",
            !exclusion?.excluded && ai.loading && "text-brand-soft",
            !exclusion?.excluded && !ai.loading && ai.processed && "text-brand-soft hover:text-accent-danger hover:bg-accent-danger/10",
            !exclusion?.excluded && !ai.loading && !ai.processed && "text-text-main/60 hover:text-brand-soft hover:bg-brand-soft/10 cursor-pointer",
          )}
        />
      )}

      <AnimatePresence>
        {confirmState.kind !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[var(--z-critical)] flex items-center justify-center bg-surface-base/60 backdrop-blur-sm"
            onClick={() => setConfirmState(IDLE)}
          >
            <motion.div
              className="bg-surface-card border border-border-subtle rounded-2xl p-5 w-[320px] shadow-lg"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-text-main mb-2">
                {confirmTitle}
              </div>
              <div className="text-xs text-text-main/60 mb-4">
                {confirmHint}
              </div>
              <div className="flex gap-2">
                <Button
                  variant={confirmState.kind === 'download-local' ? 'primary' : 'danger'}
                  size="sm"
                  onClick={() => void handleConfirmDelete()}
                  className={cn(
                    "flex-1 py-2 rounded-xl text-sm font-medium",
                    confirmState.kind === 'download-local'
                      ? "bg-text-main text-surface-base hover:opacity-90 cursor-pointer"
                      : "bg-accent-danger/10 border border-accent-danger/20 text-accent-danger hover:bg-accent-danger/20"
                  )}
                >
                  {confirmState.kind === 'exclude-ai'
                    ? t('ai_note_exclude')
                    : confirmState.kind === 'download-local'
                      ? (t('storage_download_confirm') || 'Скачать')
                      : t('storage_delete_confirm')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmState(IDLE)}
                  className="flex-1 py-2 rounded-xl border border-border-subtle text-text-main/60 text-sm hover:text-text-main"
                >
                  {t('common_cancel')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showUnlock && hasEncryption && userId && !userId.startsWith('guest_') && (
          <UnlockPrompt
            uid={userId}
            onUnlocked={() => {
              setShowUnlock(false);
              if (pendingAction === 'download') {
                void doDownload();
              } else {
                void doUpload();
              }
            }}
            onClose={() => {
              setShowUnlock(false);
              setPendingAction(null);
            }}
          />
        )}
      </AnimatePresence>

      {showEncryptionSetup && userId && !userId.startsWith('guest_') && (
        <EncryptionPasswordModal
          mode="setup"
          userId={userId}
          context="cloud-sync"
          onDone={() => { setShowEncryptionSetup(false); void doUpload(); }}
          onClose={() => setShowEncryptionSetup(false)}
        />
      )}
    </div>
  );
}
