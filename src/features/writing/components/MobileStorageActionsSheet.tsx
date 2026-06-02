import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cloud, HardDrive, Loader2, Trash2, X, Upload, RefreshCw } from 'lucide-react';

import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { StorageService } from '../../../core/services/StorageService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { SyncService } from '../../../core/services/SyncService';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { reportError } from '../../../shared/errors/reportError';
import { UnlockPrompt } from '../../auth/components/UnlockPrompt';
import { EncryptionPasswordModal } from '../../encryption/components/EncryptionPasswordModal';
import { useAuthStatus } from '../../auth/contexts/AuthContext';

interface MobileStorageActionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  session: {
    id: string;
    title?: string;
    _isLocal?: boolean;
    _linkedCloudId?: string;
    _hasCloudCopy?: boolean;
    _hasPendingSync?: boolean;
  };
  userId: string;
  onStorageChange: () => void;
}

export function MobileStorageActionsSheet({
  isOpen,
  onClose,
  session,
  userId,
  onStorageChange,
}: MobileStorageActionsSheetProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { profile } = useAuthStatus();
  const hasEncryption = !!(profile?.encryptionMeta || (profile?.encryptionSalt && profile?.encryptedDataKey));
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [showEncryptionSetup, setShowEncryptionSetup] = useState(false);

  if (!isOpen) return null;

  const doc = {
    localId: session._isLocal ? session.id : undefined,
    cloudId: session._linkedCloudId,
    hasLocal: !!session._isLocal,
    hasCloud: !!session._hasCloudCopy,
    hasPendingSync: !!session._hasPendingSync,
  };

  const triggerVibration = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(60);
      } catch {
        // ignore
      }
    }
  };

  const handleUploadOrSync = async () => {
    if (!doc.localId || !userId || userId.startsWith('guest_')) return;
    if (!getSessionKey()) {
      if (hasEncryption) {
        setShowUnlock(true);
      } else {
        setShowEncryptionSetup(true);
      }
      return;
    }

    setLoadingAction('upload');
    triggerVibration();
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
      onClose();
    } catch (e) {
      reportError(e, { action: doc.hasPendingSync ? 'syncDocument' : 'addCloudCopy', userId, localId: doc.localId });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDeleteLocalOnly = async () => {
    setLoadingAction('delete-local');
    triggerVibration();
    try {
      await StorageService.removeLocalCopy(doc.localId!);
      showToast(t('storage_deleted_local'), 'success');
      onStorageChange();
      onClose();
    } catch (e) {
      reportError(e, { action: 'removeLocalCopy', userId });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDeleteCloudOnly = async () => {
    setLoadingAction('delete-cloud');
    triggerVibration();
    try {
      await StorageService.removeCloudCopy(userId, doc.cloudId!);
      if (doc.localId) {
        await LocalDocumentService.updateLinkedCloudId(doc.localId, '');
      }
      showToast(t('storage_deleted_cloud'), 'success');
      onStorageChange();
      onClose();
    } catch (e) {
      reportError(e, { action: 'removeCloudCopy', userId });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDeleteCompletely = async () => {
    setLoadingAction('delete-complete');
    triggerVibration();
    try {
      await StorageService.deleteDocument(userId, doc.localId, doc.cloudId);
      showToast(t('storage_deleted_completely'), 'success');
      onStorageChange();
      onClose();
    } catch (e) {
      reportError(e, { action: 'deleteDocument', userId });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setLoadingAction(null);
    }
  };

  const canUpload = !doc.hasCloud && !!doc.localId && !!userId && !userId.startsWith('guest_');

  return (
    <div 
      className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center bg-black/60 backdrop-blur-sm touch-none"
      onTouchMove={e => e.preventDefault()}
    >
      {/* Dismiss Tap Area */}
      <div className="absolute inset-0" onClick={onClose} />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="relative z-10 w-full max-w-lg bg-surface-card border-t border-white/[0.06] rounded-t-[28px] overflow-hidden flex flex-col max-h-[85vh] shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
      >
        {/* Grab Handle */}
        <div className="flex justify-center py-3">
          <div className="w-12 h-1.5 rounded-full bg-white/10" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center px-6 pb-3">
          <span className="text-sm font-bold text-text-main/30 uppercase tracking-widest">
            {t('storage_title') || 'Управление хранилищем'}
          </span>
          <IconButton
            icon={<X size={18} />}
            label={t('common_close')}
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.04] text-text-main/40 hover:text-text-main/70"
          />
        </div>

        {/* Details Summary */}
        <div className="px-6 py-4 bg-white/[0.01] border-y border-white/[0.04]">
          <div className="text-base font-bold text-text-main truncate mb-1">
            {session.title || t('common_untitled') || 'Без названия'}
          </div>
          <div className="flex items-center gap-4 text-xs text-text-main/40">
            <div className="flex items-center gap-1">
              <HardDrive size={12} className={doc.hasLocal ? "text-brand-primary" : "text-text-main/20"} />
              <span>{doc.hasLocal ? (t('storage_local') || 'Локально') : (t('storage_no_local') || 'Нет на устройстве')}</span>
            </div>
            <div className="flex items-center gap-1">
              <Cloud size={12} className={doc.hasCloud ? (doc.hasPendingSync ? "text-amber-500" : "text-blue-400") : "text-text-main/20"} />
              <span>
                {doc.hasPendingSync
                  ? (t('storage_sync_pending') || 'Ожидает синхронизации')
                  : doc.hasCloud
                  ? (t('storage_cloud') || 'В облаке')
                  : (t('storage_no_cloud') || 'Нет в облаке')}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons List */}
        <div className="px-6 py-6 overflow-y-auto no-scrollbar space-y-3">
          {/* 1. Upload or Sync Button */}
          {(canUpload || doc.hasPendingSync) && (
            <Button
              variant="brand"
              size="md"
              onClick={() => void handleUploadOrSync()}
              isLoading={loadingAction === 'upload'}
              className="w-full min-h-[48px] flex items-center justify-center gap-3 px-4 py-3 rounded-2xl font-semibold text-sm active:scale-[0.98]"
            >
              {loadingAction === 'upload' ? (
                <Loader2 size={18} className="animate-spin" />
              ) : doc.hasPendingSync ? (
                <>
                  <RefreshCw size={18} />
                  <span>{t('storage_sync_pending') || 'Синхронизировать изменения'}</span>
                </>
              ) : (
                <>
                  <Upload size={18} />
                  <span>{t('storage_upload_to_cloud') || 'Загрузить в облако'}</span>
                </>
              )}
            </Button>
          )}

          {/* 2. Delete Local Copy Button */}
          {doc.hasLocal && doc.hasCloud && (
            <Button
              variant="ghost"
              size="md"
              onClick={() => void handleDeleteLocalOnly()}
              isLoading={loadingAction === 'delete-local'}
              className="w-full min-h-[48px] flex items-center justify-center gap-3 px-4 py-3 rounded-2xl font-semibold text-sm border border-white/[0.06] text-text-main/70 hover:text-accent-danger active:scale-[0.98]"
            >
              {loadingAction === 'delete-local' ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  <HardDrive size={18} />
                  <span>{t('storage_remove_local') || 'Удалить локальную копию'}</span>
                </>
              )}
            </Button>
          )}

          {/* 3. Delete Cloud Copy Button */}
          {doc.hasLocal && doc.hasCloud && (
            <Button
              variant="ghost"
              size="md"
              onClick={() => void handleDeleteCloudOnly()}
              isLoading={loadingAction === 'delete-cloud'}
              className="w-full min-h-[48px] flex items-center justify-center gap-3 px-4 py-3 rounded-2xl font-semibold text-sm border border-white/[0.06] text-text-main/70 hover:text-accent-danger active:scale-[0.98]"
            >
              {loadingAction === 'delete-cloud' ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  <Cloud size={18} />
                  <span>{t('storage_remove_cloud') || 'Удалить из облака'}</span>
                </>
              )}
            </Button>
          )}

          {/* 4. Delete Completely Button */}
          {(doc.hasLocal || doc.hasCloud) && (
            <Button
              variant="danger"
              size="md"
              onClick={() => void handleDeleteCompletely()}
              isLoading={loadingAction === 'delete-complete'}
              className="w-full min-h-[48px] flex items-center justify-center gap-3 px-4 py-3 rounded-2xl font-semibold text-sm bg-accent-danger/10 border border-accent-danger/20 text-accent-danger active:scale-[0.98]"
            >
              {loadingAction === 'delete-complete' ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  <Trash2 size={18} />
                  <span>{t('storage_delete_completely') || 'Удалить полностью'}</span>
                </>
              )}
            </Button>
          )}

          {/* Cancel / Close Button */}
          <div className="pt-2">
            <Button
              variant="ghost"
              size="md"
              onClick={onClose}
              className="w-full min-h-[48px] py-3 rounded-2xl font-semibold text-sm bg-white/[0.04] text-text-main/50 text-center active:scale-[0.98]"
            >
              {t('common_cancel') || 'Отмена'}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Unlock encryption prompt */}
      <AnimatePresence>
        {showUnlock && hasEncryption && userId && !userId.startsWith('guest_') && (
          <UnlockPrompt
            uid={userId}
            onUnlocked={() => { setShowUnlock(false); void handleUploadOrSync(); }}
            onClose={() => setShowUnlock(false)}
          />
        )}
      </AnimatePresence>

      {showEncryptionSetup && userId && !userId.startsWith('guest_') && (
        <EncryptionPasswordModal
          mode="setup"
          userId={userId}
          context="cloud-sync"
          onDone={() => { setShowEncryptionSetup(false); void handleUploadOrSync(); }}
          onClose={() => setShowEncryptionSetup(false)}
        />
      )}
    </div>
  );
}
