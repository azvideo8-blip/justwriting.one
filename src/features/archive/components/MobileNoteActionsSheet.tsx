import { useState } from 'react';
import { motion } from 'motion/react';
import { X, ExternalLink, Pencil, Tag, Trash2, Cloud, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { useToast } from '../../../shared/components/Toast';
import { StorageService } from '../../../core/services/StorageService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { SyncService } from '../../../core/services/SyncService';

import { reportError } from '../../../core/errors/reportError';
import { Label } from '../../../types';
import { cn } from '../../../core/utils/utils';

interface MobileNoteActionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  session: {
    id: string;
    title?: string;
    labelId?: string;
    _isLocal?: boolean;
    _linkedCloudId?: string;
    _hasCloudCopy?: boolean;
    _hasPendingSync?: boolean;
  };
  userId: string;
  labels?: Label[];
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onLabelChange: (labelId: string | undefined) => void;
  onStorageChange: () => void;
}

export function MobileNoteActionsSheet({
  isOpen,
  onClose,
  session,
  userId,
  labels,
  onOpen,
  onRename,
  onDelete,
  onLabelChange,
  onStorageChange,
}: MobileNoteActionsSheetProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [showLabelsSelector, setShowLabelsSelector] = useState(false);

  if (!isOpen) return null;

  const doc = {
    localId: session._isLocal ? session.id : undefined,
    cloudId: session._linkedCloudId,
    hasLocal: !!session._isLocal,
    hasCloud: !!session._hasCloudCopy,
    hasPendingSync: !!session._hasPendingSync,
  };

  const handleUploadOrSync = async () => {
    if (!doc.localId || !userId || userId.startsWith('guest_')) return;
    setLoadingAction('upload');
    try {
      if (doc.hasPendingSync) {
        await SyncService.syncDocument(userId, doc.localId, false);
        showToast(t('storage_uploaded_cloud'), 'success');
      } else {
        const cloudId = await StorageService.addCloudCopy(userId, doc.localId, false);
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

  const canUpload = !doc.hasCloud && !!doc.localId && !!userId && !userId.startsWith('guest_');

  const selectedLabel = labels?.find(l => l.id === session.labelId);

  return (
    <div 
      className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center bg-black/60 backdrop-blur-sm touch-none"
      onTouchMove={e => e.preventDefault()}
    >
      <div className="absolute inset-0" onClick={onClose} />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="relative z-10 w-full max-w-lg bg-surface-card border-t border-white/[0.06] rounded-t-[28px] overflow-hidden flex flex-col max-h-[85vh] shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}
      >
        {/* Grab Handle */}
        <div className="flex justify-center py-3">
          <div className="w-12 h-1.5 rounded-full bg-white/10" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center px-6 pb-3">
          <span className="text-sm font-bold text-text-main/30 uppercase tracking-widest">
            {t('archive_note_actions') || 'Действия с заметкой'}
          </span>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.04] border-none flex items-center justify-center text-text-main/40 hover:text-text-main/70 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Document Title Header */}
        <div className="px-6 py-4 bg-white/[0.01] border-y border-white/[0.04] flex items-center justify-between">
          <div className="min-w-0 flex-1 pr-4">
            <div className="text-base font-bold text-text-main truncate">
              {session.title || t('common_untitled')}
            </div>
            {selectedLabel && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedLabel.color }} />
                <span className="text-xs text-text-main/50">{selectedLabel.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Options List */}
        <div className="px-6 py-5 overflow-y-auto no-scrollbar space-y-2"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}>
          {!showLabelsSelector ? (
            <>
              {/* 1. Preview Option */}
              <button
                onClick={() => { onOpen(); onClose(); }}
                className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-text-main/80 bg-white/[0.02] border border-white/[0.04] active:bg-white/[0.06] transition-colors text-left"
              >
                <ExternalLink size={18} className="text-text-main/40" />
                <span>{t('archive_preview') || 'Открыть превью'}</span>
              </button>

              {/* 2. Rename Option */}
              <button
                onClick={() => { onRename(); onClose(); }}
                className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-text-main/80 bg-white/[0.02] border border-white/[0.04] active:bg-white/[0.06] transition-colors text-left"
              >
                <Pencil size={18} className="text-text-main/40" />
                <span>{t('archive_rename_title') || 'Переименовать'}</span>
              </button>

              {/* 3. Label Selector Toggle */}
              {(labels && labels.length > 0 || session.labelId) && (
                <button
                  onClick={() => setShowLabelsSelector(true)}
                  className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-text-main/80 bg-white/[0.02] border border-white/[0.04] active:bg-white/[0.06] transition-colors text-left"
                >
                  <Tag size={18} className="text-text-main/40" />
                  <span>{t('archive_assign_label') || 'Назначить ярлык'}</span>
                </button>
              )}

              {/* 4. Storage Actions */}
              {(canUpload || doc.hasPendingSync) && (
                <button
                  onClick={handleUploadOrSync}
                  disabled={!!loadingAction}
                  className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-brand-primary bg-brand-primary/10 border border-brand-primary/20 active:bg-brand-primary/20 transition-colors text-left"
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
                      <Cloud size={18} />
                      <span>{t('storage_upload_to_cloud') || 'Загрузить в облако'}</span>
                    </>
                  )}
                </button>
              )}

              {doc.hasLocal && doc.hasCloud && (
                <button
                  onClick={handleDeleteLocalOnly}
                  disabled={!!loadingAction}
                  className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-text-main/70 bg-white/[0.02] border border-white/[0.04] active:bg-white/[0.06] transition-colors text-left"
                >
                  {loadingAction === 'delete-local' ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <>
                      <HardDrive size={18} className="text-text-main/40" />
                      <span>{t('storage_remove_local') || 'Удалить локальную копию'}</span>
                    </>
                  )}
                </button>
              )}

              {doc.hasLocal && doc.hasCloud && (
                <button
                  onClick={handleDeleteCloudOnly}
                  disabled={!!loadingAction}
                  className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-text-main/70 bg-white/[0.02] border border-white/[0.04] active:bg-white/[0.06] transition-colors text-left"
                >
                  {loadingAction === 'delete-cloud' ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <>
                      <Cloud size={18} className="text-text-main/40" />
                      <span>{t('storage_remove_cloud') || 'Удалить из облака'}</span>
                    </>
                  )}
                </button>
              )}

              {/* 5. Delete Completely Option */}
              <button
                onClick={() => { onDelete(); onClose(); }}
                className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 active:bg-red-500/20 transition-colors text-left"
              >
                <Trash2 size={18} />
                <span>{t('archive_delete') || 'Удалить полностью'}</span>
              </button>
            </>
          ) : (
            // Labels Sub-selector
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-text-main/40 uppercase tracking-wider">{t('archive_assign_label')}</span>
                <button onClick={() => setShowLabelsSelector(false)} className="text-xs text-brand-soft hover:underline">
                  {t('writing_back') || 'Назад'}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {session.labelId && (
                  <button
                    onClick={() => {
                      onLabelChange(undefined);
                      onClose();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-left transition-colors border bg-white/[0.01] border-white/[0.04] text-text-main/40 hover:bg-white/[0.03]"
                  >
                    <div className="w-3.5 h-3.5 rounded-full border border-dashed border-text-main/20 shrink-0" />
                    <span className="flex-1">{t('archive_no_label')}</span>
                  </button>
                )}
                {labels?.map(l => (
                  <button
                    key={l.id}
                    onClick={() => {
                      onLabelChange(session.labelId === l.id ? undefined : l.id);
                      onClose();
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-left transition-colors border",
                      session.labelId === l.id
                        ? "bg-text-main/10 border-text-main/20 text-text-main"
                        : "bg-white/[0.01] border-white/[0.04] text-text-main/60 hover:bg-white/[0.03]"
                    )}
                  >
                    <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                    <span className="flex-1">{l.name}</span>
                    {session.labelId === l.id && <span className="text-xs text-brand-soft">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
