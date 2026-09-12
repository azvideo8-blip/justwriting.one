import React, { useCallback } from 'react';
const LoginPage = React.lazy(() => import('../pages/LoginPage').then(m => ({ default: m.LoginPage })));
import { useLoginModal } from '../contexts/LoginModalContext';
import { useLanguage } from '../../../shared/i18n';
import { ModalShell } from '../../../shared/components/ModalShell';

export function LoginModalOverlay({ open }: { open: boolean }) {
  const { closeLoginModal } = useLoginModal();
  const { t } = useLanguage();

  const handleAuthSuccess = useCallback(() => {
    closeLoginModal();
  }, [closeLoginModal]);

  if (!open) return null;

  return (
    <ModalShell
      open={open}
      onClose={closeLoginModal}
      labelId="login-modal-title"
      className="w-full max-w-sm"
    >
      <h3 id="login-modal-title" className="sr-only">{t('auth_sign_in')}</h3>
      <React.Suspense fallback={<div className="h-48" />}>
        <LoginPage isModal onSuccess={handleAuthSuccess} onClose={closeLoginModal} />
      </React.Suspense>
    </ModalShell>
  );
}
