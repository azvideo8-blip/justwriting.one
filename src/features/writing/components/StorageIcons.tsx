import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Cloud, HardDrive, Loader2 } from 'lucide-react';
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

type ConfirmState =
  | { kind: 'idle' }
  | { kind: 'delete-local-only' }
  | { kind: 'delete-local' }
  | { kind: 'delete-cloud-only' }
  | { kind: 'delete-cloud' };

const IDLE: ConfirmState = { kind: 'idle' };

export function StorageIcons({
  doc,
  userId,
  onStorageChange,
}: {
  doc: StorageDoc;
  userId: string;
  onStorageChange: () => void;
}) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { profile } = useAuthStatus();
  const hasEncryption = !!(profile?.encryptionMeta || (profile?.encryptionSalt && profile?.encryptedDataKey));
  const [confirmState, setConfirmState] = useState<ConfirmState>(IDLE);
  const [uploading, setUploading] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [showEncryptionSetup, setShowEncryptionSetup] = useState(false);

  const handleLocalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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
      if (hasEncryption) {
        setShowUnlock(true);
      } else {
        setShowEncryptionSetup(true);
      }
      return;
    }
    void doUpload();
  };

  const doUpload = async () => {
    if (!doc.localId || !userId || userId.startsWith('guest_')) return;
    setUploading(true);
    try {
      if (doc.hasPendingSync) {
        await SyncService.syncDocument(userId, doc.localId, true);
        showToast(t('storage_uploaded_cloud'), 'success');
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
            await LocalDocumentService.updateLinkedCloudId(doc.localId, '');
          }
          showToast(t('storage_deleted_cloud'), 'success');
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
        icon={<HardDrive size={14} />}
        label={doc.hasLocal ? t('storage_remove_local') : t('storage_no_local')}
        onClick={handleLocalClick}
        size="sm"
        className={cn(
          "w-6 h-6 rounded-lg",
          doc.hasLocal
            ? "text-text-main/70 hover:text-accent-danger hover:bg-accent-danger/10"
            : "text-text-main/60 cursor-default"
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
          uploading && "animate-pulse text-blue-400",
          !uploading && isUnsynced && "text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 cursor-pointer",
          !uploading && !isUnsynced && doc.hasCloud && "text-blue-400 hover:text-accent-danger hover:bg-accent-danger/10",
          !uploading && !isUnsynced && !doc.hasCloud && canUpload && "text-text-main/60 hover:text-blue-400 hover:bg-blue-400/10 cursor-pointer",
          !uploading && !isUnsynced && !doc.hasCloud && !canUpload && "text-text-main/60 cursor-default"
        )}
      />

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
                  variant="danger"
                  size="sm"
                  onClick={() => void handleConfirmDelete()}
                  className="flex-1 py-2 rounded-xl bg-accent-danger/10 border border-accent-danger/20 text-accent-danger text-sm font-medium hover:bg-accent-danger/20"
                >
                  {t('storage_delete_confirm')}
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
            onUnlocked={() => { setShowUnlock(false); void doUpload(); }}
            onClose={() => setShowUnlock(false)}
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
