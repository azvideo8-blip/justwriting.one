import { MobileMeScreen } from '../components/MobileMeScreen';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { AuthService } from '../../../app/AuthService';
import { useNavigate } from 'react-router-dom';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { useLoginModal } from '../../../app/useLoginModal';

export function MobileMePage() {
  const { user, profile } = useAuthStatus();
  const navigate = useNavigate();
  const { execute } = useServiceAction();
  const { openLoginModal } = useLoginModal();

  const handleSignOut = () => {
    void execute(
      () => AuthService.signOut(),
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
