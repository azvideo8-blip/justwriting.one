import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Cloud, HardDrive, Loader2 } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { useToast } from '../../../shared/components/Toast';
import { StorageService } from '../services/StorageService';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { reportError } from '../../../core/errors/reportError';
import { UnlockPrompt } from '../../auth/components/UnlockPrompt';

interface StorageDoc {
  localId?: string;
  cloudId?: string;
  hasLocal: boolean;
  hasCloud: boolean;
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
  onUnlockNeeded,
}: {
  doc: StorageDoc;
  userId: string;
  onStorageChange: () => void;
  onUnlockNeeded?: () => void;
}) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [confirmState, setConfirmState] = useState<ConfirmState>(IDLE);
  const [uploading, setUploading] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);

  const handleLocalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!doc.hasLocal) return;
    setConfirmState(doc.hasLocal && !doc.hasCloud ? { kind: 'delete-local-only' } : { kind: 'delete-local' });
  };

  const handleCloudClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (doc.hasCloud) {
      setConfirmState(doc.hasCloud && !doc.hasLocal ? { kind: 'delete-cloud-only' } : { kind: 'delete-cloud' });
      return;
    }
    if (!doc.localId || !userId || userId.startsWith('guest_')) return;
    if (!getSessionKey()) {
      showToast(t('error_session_key_missing'), 'error');
      reportError('ENCRYPT_REQUIRED: session key missing on cloud upload', { userId });
      onUnlockNeeded?.();
      setShowUnlock(true);
      return;
    }
    setUploading(true);
    try {
      const cloudId = await StorageService.addCloudCopy(userId, doc.localId);
      if (cloudId) {
        showToast(t('storage_uploaded_cloud'), 'success');
        onStorageChange();
      } else {
        showToast(t('error_generic_action'), 'error');
      }
    } catch (e) {
      reportError(e, { action: 'addCloudCopy', userId, localId: doc.localId });
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

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={handleLocalClick}
        title={doc.hasLocal ? t('storage_remove_local') : t('storage_no_local')}
        className={cn(
          "w-6 h-6 rounded-lg flex items-center justify-center transition-all",
          doc.hasLocal
            ? "text-text-main/70 hover:text-red-400 hover:bg-red-400/10"
            : "text-text-main/20 cursor-default"
        )}
      >
        <HardDrive size={14} />
      </button>

      <button
        onClick={handleCloudClick}
        disabled={uploading}
        title={doc.hasCloud ? t('storage_remove_cloud') : canUpload ? t('storage_upload_to_cloud') : t('storage_no_cloud')}
        className={cn(
          "w-6 h-6 rounded-lg flex items-center justify-center transition-all",
          uploading && "animate-pulse text-blue-400",
          doc.hasCloud
            ? "text-blue-400 hover:text-red-400 hover:bg-red-400/10"
            : canUpload
              ? "text-text-main/30 hover:text-blue-400 hover:bg-blue-400/10 cursor-pointer"
              : "text-text-main/20 cursor-default"
        )}
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
      </button>

      <AnimatePresence>
        {confirmState.kind !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[300] flex items-center justify-center bg-surface-base/60 backdrop-blur-sm"
            onClick={() => setConfirmState(IDLE)}
          >
            <motion.div
              className="bg-surface-card border border-border-subtle rounded-2xl p-5 w-[320px] shadow-lg"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-text-main mb-2">
                {confirmTitle}
              </div>
              <div className="text-xs text-text-main/40 mb-4">
                {confirmHint}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-all"
                >
                  {t('storage_delete_confirm')}
                </button>
                <button
                  onClick={() => setConfirmState(IDLE)}
                  className="flex-1 py-2 rounded-xl border border-border-subtle text-text-main/50 text-sm hover:text-text-main transition-all"
                >
                  {t('common_cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showUnlock && userId && !userId.startsWith('guest_') && (
          <UnlockPrompt
            uid={userId}
            onUnlocked={() => { setShowUnlock(false); }}
            onClose={() => setShowUnlock(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
