import React, { useState, useCallback } from 'react';
const LoginPage = React.lazy(() => import('../pages/LoginPage').then(m => ({ default: m.LoginPage })));
import { useLoginModal } from '../contexts/LoginModalContext';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { getCurrentUser } from '../../../core/auth';
import { MigrationPrompt, checkGuestDocuments } from './MigrationPrompt';
import { ModalShell } from '../../../shared/components/ModalShell';

export function LoginModalOverlay({ open }: { open: boolean }) {
  const { closeLoginModal } = useLoginModal();
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false);
  const [localDocCount, setLocalDocCount] = useState(0);
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);

  const handleAuthSuccess = useCallback(async () => {
    closeLoginModal();

    const u = getCurrentUser();
    if (!u) return;

    const result = await checkGuestDocuments();
    if (result) {
      setLocalDocCount(result.docs.length + (result.hasDraft ? 1 : 0));
      setLoggedInUserId(u.uid);
      setShowMigrationPrompt(true);
    }
  }, [closeLoginModal]);

  const onSuccessWrapped = useCallback(() => {
    void handleAuthSuccess();
  }, [handleAuthSuccess]);

  return (
    <>
      {open && (
        <ModalShell
          open={open}
          onClose={closeLoginModal}
          labelId="login-modal-title"
          className="w-full max-w-sm"
        >
          <h3 id="login-modal-title" className="sr-only">{t('auth_sign_in')}</h3>
          <React.Suspense fallback={<div className="h-48" />}>
            <LoginPage isModal onSuccess={onSuccessWrapped} onClose={closeLoginModal} />
          </React.Suspense>
        </ModalShell>
      )}

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
