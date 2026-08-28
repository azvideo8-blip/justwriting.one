import { useState } from 'react';
import { MobileMeScreen } from './MobileMeScreen';
import { useAuthStatus } from '../useAuthStatus';
import { AuthService } from '../AuthService';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../shared/components/Toast';
import { useLoginModal } from '../useLoginModal';
import { SignOutConfirmModal } from '../../features/auth/components/SignOutConfirmModal';

export function MobileMePage() {
  const { user, profile } = useAuthStatus();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { openLoginModal } = useLoginModal();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const handleConfirmSignOut = async (opts: { clearLocalData: boolean; force?: boolean }) => {
    try {
      await AuthService.signOut(opts);
      showToast(opts.clearLocalData ? 'Вы вышли, локальные данные удалены' : 'Вы вышли из аккаунта', 'success');
      void navigate('/login');
    } catch (e) {
      const isUnsynced = (e as { name?: string }).name === 'UnsyncedLocalDataError';
      // AUD-11: очистка локальных данных не удалась — данные остались на машине.
      const isWipeFailed = (e as { name?: string }).name === 'LocalWipeFailedError';
      if (isWipeFailed) {
        showToast('Вы вышли, но очистить локальные данные не удалось. Очистите данные сайта в браузере вручную.', 'error');
        void navigate('/login');
        return;
      }
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
