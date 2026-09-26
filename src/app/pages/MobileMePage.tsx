import { useState } from 'react';
import { MobileMeScreen } from './MobileMeScreen';
import { useAuthStatus } from '../useAuthStatus';
import { AuthService } from '../AuthService';
import { useToast } from '../../shared/components/Toast';
import { useLoginModal } from '../useLoginModal';
import { SignOutConfirmModal } from '../../features/auth/components/SignOutConfirmModal';

export function MobileMePage() {
  const { user, profile } = useAuthStatus();
  const { showToast } = useToast();
  const { openLoginModal } = useLoginModal();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const handleConfirmSignOut = async (opts: { clearLocalData: boolean; force?: boolean }) => {
    try {
      // Выход перезагружает страницу на /login, сообщение показывает она же.
      await AuthService.signOut(opts);
    } catch (e) {
      const isUnsynced = (e as { name?: string }).name === 'UnsyncedLocalDataError';
      // AUD-11: выход состоялся, об очистке скажет перезагруженная страница.
      if ((e as { name?: string }).name === 'LocalWipeFailedError') return;
      if (!isUnsynced) {
        showToast('Не удалось выйти из аккаунта', 'error');
      }
      throw e;
    }
  };

  return (
    <>
      <MobileMeScreen
        user={user}
        profile={profile}
        onSignOut={() => setShowSignOutConfirm(true)}
        onSignIn={openLoginModal}
      />
      <SignOutConfirmModal
        open={showSignOutConfirm}
        onClose={() => setShowSignOutConfirm(false)}
        onConfirm={handleConfirmSignOut}
      />
    </>
  );
}
