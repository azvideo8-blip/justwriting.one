import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Cloud, HardDrive } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { useToast } from '../../../shared/components/Toast';
import { StorageService } from '../services/StorageService';
import { LocalDocumentService } from '../services/LocalDocumentService';

export interface StorageDoc {
  localId?: string;
  cloudId?: string;
  hasLocal: boolean;
  hasCloud: boolean;
}

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
  const [confirmState, setConfirmState] = useState<{
    type: 'local' | 'cloud' | null;
    isOnly: boolean;
  }>({ type: null, isOnly: false });

  const handleLocalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!doc.hasLocal) return;
    const isOnly = doc.hasLocal && !doc.hasCloud;
    setConfirmState({ type: 'local', isOnly });
  };

  const handleCloudClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!doc.hasCloud) return;
    const isOnly = doc.hasCloud && !doc.hasLocal;
    setConfirmState({ type: 'cloud', isOnly });
  };

  const handleConfirmDelete = async () => {
    try {
      if (confirmState.type === 'local' && confirmState.isOnly) {
        await StorageService.deleteDocument(userId, doc.localId, doc.cloudId);
        showToast(t('storage_deleted_completely'), 'success');
      } else if (confirmState.type === 'local') {
        await StorageService.removeLocalCopy(doc.localId!);
        showToast(t('storage_deleted_local'), 'success');
      } else if (confirmState.type === 'cloud' && confirmState.isOnly) {
        await StorageService.deleteDocument(userId, doc.localId, doc.cloudId);
        showToast(t('storage_deleted_completely'), 'success');
      } else if (confirmState.type === 'cloud') {
        await StorageService.removeCloudCopy(userId, doc.cloudId!);
        if (doc.localId) {
          await LocalDocumentService.updateLinkedCloudId(doc.localId, '');
        }
        showToast(t('storage_deleted_cloud'), 'success');
      }
      onStorageChange();
    } catch {
      showToast(t('error_generic_action'), 'error');
    } finally {
      setConfirmState({ type: null, isOnly: false });
    }
  };

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
        title={doc.hasCloud ? t('storage_remove_cloud') : t('storage_no_cloud')}
        className={cn(
          "w-6 h-6 rounded-lg flex items-center justify-center transition-all",
          doc.hasCloud
            ? "text-blue-400 hover:text-red-400 hover:bg-red-400/10"
            : "text-text-main/20 cursor-default"
        )}
      >
        <Cloud size={14} />
      </button>

      <AnimatePresence>
        {confirmState.type && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[300] flex items-center justify-center bg-surface-base/60 backdrop-blur-sm"
            onClick={() => setConfirmState({ type: null, isOnly: false })}
          >
            <motion.div
              className="bg-surface-card border border-border-subtle rounded-2xl p-5 w-[320px] shadow-lg"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-text-main mb-2">
                {confirmState.isOnly
                  ? t('storage_confirm_delete_only')
                  : confirmState.type === 'local'
                    ? t('storage_confirm_delete_local')
                    : t('storage_confirm_delete_cloud')}
              </div>
              <div className="text-xs text-text-main/40 mb-4">
                {confirmState.isOnly
                  ? t('storage_confirm_delete_only_hint')
                  : confirmState.type === 'local'
                    ? t('storage_confirm_delete_local_hint')
                    : t('storage_confirm_delete_cloud_hint')}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-all"
                >
                  {t('storage_delete_confirm')}
                </button>
                <button
                  onClick={() => setConfirmState({ type: null, isOnly: false })}
                  className="flex-1 py-2 rounded-xl border border-border-subtle text-text-main/50 text-sm hover:text-text-main transition-all"
                >
                  {t('common_cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
