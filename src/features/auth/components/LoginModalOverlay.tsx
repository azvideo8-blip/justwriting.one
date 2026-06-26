import React, { useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
const LoginPage = React.lazy(() => import('../pages/LoginPage').then(m => ({ default: m.LoginPage })));
import { useLoginModal } from '../contexts/LoginModalContext';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { auth } from '../../../core/firebase/auth';
import { MigrationPrompt, checkGuestDocuments } from './MigrationPrompt';
import { useFocusTrap } from '../../../shared/hooks/useFocusTrap';
import { useModalEscape } from '../../../shared/hooks/useModalEscape';

export function LoginModalOverlay({ open }: { open: boolean }) {
  const { closeLoginModal } = useLoginModal();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const reducedMotion = useReducedMotion();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, open);
  useModalEscape(open, closeLoginModal);

  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false);
  const [localDocCount, setLocalDocCount] = useState(0);
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);

  const handleAuthSuccess = useCallback(async () => {
    closeLoginModal();

    const u = auth.currentUser;
    if (!u) return;

    const result = await checkGuestDocuments();
    if (result) {
      setLocalDocCount(result.docs.length);
      setLoggedInUserId(u.uid);
      setShowMigrationPrompt(true);
    }
  }, [closeLoginModal]);

  const onSuccessWrapped = useCallback(() => {
    void handleAuthSuccess();
  }, [handleAuthSuccess]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[var(--z-sheet)] bg-surface-base/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeLoginModal}
          >
            <motion.div
              data-modal
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('login_title')}
              initial={reducedMotion ? {} : { scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reducedMotion ? {} : { scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              <React.Suspense fallback={<div className="h-48" />}>
                <LoginPage isModal onSuccess={onSuccessWrapped} onClose={closeLoginModal} />
              </React.Suspense>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {showMigrationPrompt && loggedInUserId && (
        <MigrationPrompt
          userId={loggedInUserId}
          docCount={localDocCount}
          onDone={() => {
            setShowMigrationPrompt(false);
            showToast(t('migration_success_local', { count: localDocCount }), 'success');
          }}
          onCloudSynced={(synced) => showToast(t('migration_synced_cloud', { count: synced }), 'success')}
        />
      )}
    </>
  );
}
