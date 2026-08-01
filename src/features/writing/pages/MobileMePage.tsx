import { MobileMeScreen } from '../components/MobileMeScreen';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { AuthService } from '../../../app/AuthService';
import { useNavigate } from 'react-router-dom';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { useToast } from '../../../shared/components/Toast';
import { useLoginModal } from '../../../app/useLoginModal';

export function MobileMePage() {
  const { user, profile } = useAuthStatus();
  const navigate = useNavigate();
  const { execute } = useServiceAction();
  const { showToast } = useToast();
  const { openLoginModal } = useLoginModal();

  const handleSignOut = () => {
    void execute(
      async () => {
        try {
          await AuthService.signOut();
        } catch (e) {
          // Sign-out refuses while a wipe would destroy data with no cloud copy.
          // The counts and the way out (upload or export) live in Settings, so
          // send the user there instead of failing with a generic error.
          const data = (e as { name?: string; data?: { total: number } }).data;
          if ((e as { name?: string }).name === 'UnsyncedLocalDataError' && data) {
            showToast(`Не выходим: ${data.total} записей есть только на этом устройстве. Откройте настройки — выгрузите или экспортируйте их.`, 'error');
            return;
          }
          throw e;
        }
      },
      { onSuccess: () => void navigate('/login') }
    );
  };

  return (
    <MobileMeScreen
      user={user}
      profile={profile}
      onSignOut={handleSignOut}
      onSignIn={openLoginModal}
    />
  );
}
