import { MobileMeScreen } from '../components/MobileMeScreen';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { AuthService } from '../../auth/services/AuthService';
import { useNavigate } from 'react-router-dom';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';

export function MobileMePage() {
  const { user, profile } = useAuthStatus();
  const navigate = useNavigate();
  const { execute } = useServiceAction();
  const { openLoginModal } = useLoginModal();

  const handleSignOut = () => {
    execute(
      () => AuthService.signOut(),
      { onSuccess: () => navigate('/login') }
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
