import { motion, AnimatePresence } from 'motion/react';
import { HardDrive } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';
import { getOrCreateGuestId, getLocalDb } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { SyncService } from '../../../core/services/SyncService';
import { migrateDocuments } from '../services/migrateDocuments';
import { Button } from '../../../shared/components/Button';

interface MigrationPromptProps {
  userId: string;
  docCount: number;
  onDone: () => void;
  onCloudSynced?: (count: number) => void;
}

export function MigrationPrompt({ userId, docCount, onDone, onCloudSynced }: MigrationPromptProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const handleMigrate = async () => {
    try {
      const count = await migrateDocuments(userId);
      if (count > 0) {
        try {
          const { synced, failed } = await SyncService.syncAllUnlinked(userId);
          if (synced > 0) onCloudSynced?.(synced);
          // Заметки перенесены в аккаунт локально в любом случае; в облако —
          // не все. Молчать об этом нельзя: человек закрывает окно с мыслью,
          // что копия в облаке есть.
          if (failed > 0) {
            showToast(t('migration_cloud_pending', { count: failed }), 'error');
          }
        } catch (e) {
          reportError(e, { action: 'migrateCloudSync', userId });
          showToast(t('error_generic_action'), 'error');
        }
      }
      onDone();
    } catch (e) {
      reportError(e, { action: 'migrateDocuments', userId });
      showToast(t('error_generic_action'), 'error');
      onDone();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[var(--z-auth)] bg-surface-base/80 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          data-modal
          initial={{ opacity: 0, transform: "translateY(8px) scale(0.95)" }}
          animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          exit={{ opacity: 0, transform: "translateY(8px) scale(0.95)" }}
          className="w-full max-w-sm bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
        >
          <div className="w-10 h-10 rounded-2xl bg-text-main/5 border border-border-subtle flex items-center justify-center mb-4">
            <HardDrive size={18} className="text-text-main/60" />
          </div>

          <h2 className="text-base font-medium text-text-main mb-2">
            {t('migration_found_title')}
          </h2>
          <p className="text-sm text-text-main/60 mb-6">
            {/* Гость мог не сохранить ни одной заметки, но иметь черновик — окно
                показывают и ему. Общий текст в этом случае читается как
                «У тебя 0 локальных записей», то есть предлагает перенести ничто. */}
            {docCount > 0 ? t('migration_found_hint', { count: docCount }) : t('migration_found_draft_hint')}
          </p>

          <div className="flex flex-col gap-2">
            <Button
              onClick={() => void handleMigrate()}
              className="w-full py-2.5 rounded-xl bg-text-main text-surface-base text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {t('migration_move_to_account')}
            </Button>
            <Button
              onClick={onDone}
              className="w-full py-2.5 rounded-xl text-text-main/60 text-sm hover:text-text-main/60 transition-colors"
            >
              {t('migration_keep_local')}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export async function checkGuestDocuments(): Promise<{ guestId: string; docs: import('../../../core/storage/localDb').LocalDocument[]; hasDraft: boolean } | null> {
  const guestId = getOrCreateGuestId();
  try {
    const localDocs = await LocalDocumentService.getGuestDocuments(guestId);
    
    // Незаконченный черновик — тоже работа, которую надо перенести. Без этой
    // проверки человек, писавший в гостевом режиме и не сохранивший заметку,
    // не увидит окна переноса вовсе, и текст останется на прежнем аккаунте.
    const db = await getLocalDb();
    const hasDraft = db.objectStoreNames.contains('drafts') && !!(await db.get('drafts', 'guest_draft'));
    
    if (localDocs.length > 0 || hasDraft) return { guestId, docs: localDocs, hasDraft };
  } catch (e) {
    reportError(e, { action: 'checkGuestDocuments' });
  }
  return null;
}
