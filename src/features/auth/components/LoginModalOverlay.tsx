import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { HardDrive } from 'lucide-react';
import { LoginPage } from '../pages/LoginPage';
import { useLoginModal } from '../contexts/LoginModalContext';
import { useLanguage } from '../../../core/i18n';
import { useToast } from '../../../shared/components/Toast';
import { getOrCreateGuestId, getLocalDb } from '../../../shared/lib/localDb';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { auth } from '../../../core/firebase/auth';

export function LoginModalOverlay({ open }: { open: boolean }) {
  const { closeLoginModal } = useLoginModal();
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false);
  const [localDocCount, setLocalDocCount] = useState(0);
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);

  const handleAuthSuccess = useCallback(async () => {
    closeLoginModal();

    const u = auth.currentUser;
    if (!u) return;

    const guestId = getOrCreateGuestId();

    try {
      const localDocs = await LocalDocumentService.getGuestDocuments(guestId);
      if (localDocs.length > 0) {
        setLocalDocCount(localDocs.length);
        setLoggedInUserId(u.uid);
        setShowMigrationPrompt(true);
      }
    } catch (e) {
      console.error('Failed to check local docs for migration:', e);
    }
  }, [closeLoginModal]);

  const handleMigrateDocuments = async (userId: string) => {
    const guestId = getOrCreateGuestId();

    try {
      const db = await getLocalDb();
      const guestDocs = await db.getAllFromIndex('documents', 'by-guest', guestId);
      if (guestDocs.length === 0) return;

      const guestVersions = await db.getAll('versions');
      const versionsToMigrate = guestVersions.filter(v => v.guestId === guestId);

      const tx = db.transaction(['documents', 'versions'], 'readwrite');

      for (const doc of guestDocs) {
        await tx.objectStore('documents').put({ ...doc, guestId: userId });
      }
      for (const ver of versionsToMigrate) {
        await tx.objectStore('versions').put({ ...ver, guestId: userId });
      }

      await tx.done;

      showToast(t('migration_success_local', { count: guestDocs.length }), 'success');
    } catch (e) {
      console.error('Migration failed:', e);
      showToast(t('error_generic_action'), 'error');
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-surface-base/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeLoginModal}
          >
            <motion.div
              data-modal
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              <LoginPage isModal onSuccess={handleAuthSuccess} onClose={closeLoginModal} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMigrationPrompt && loggedInUserId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-surface-base/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              data-modal
              initial={{ scale: 0.95, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
            >
              <div className="w-10 h-10 rounded-2xl bg-text-main/5 border border-border-subtle flex items-center justify-center mb-4">
                <HardDrive size={18} className="text-text-main/60" />
              </div>

              <h2 className="text-base font-medium text-text-main mb-2">
                {t('migration_found_title')}
              </h2>
              <p className="text-sm text-text-main/50 mb-6">
                {t('migration_found_hint', { count: localDocCount })}
              </p>

              <div className="flex flex-col gap-2">
                <button
                  onClick={async () => {
                    await handleMigrateDocuments(loggedInUserId);
                    setShowMigrationPrompt(false);
                  }}
                  className="w-full py-2.5 rounded-xl bg-text-main text-surface-base text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  {t('migration_move_to_account')}
                </button>
                <button
                  onClick={() => setShowMigrationPrompt(false)}
                  className="w-full py-2.5 rounded-xl text-text-main/40 text-sm hover:text-text-main/60 transition-colors"
                >
                  {t('migration_keep_local')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
