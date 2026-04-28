import { MobileMeScreen } from '../components/MobileMeScreen';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { signOut } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { useNavigate } from 'react-router-dom';
import { useServiceAction } from '../hooks/useServiceAction';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';

export function MobileMePage() {
  const { user, profile } = useAuthStatus();
  const navigate = useNavigate();
  const { execute } = useServiceAction();
  const { openLoginModal } = useLoginModal();

  const handleSignOut = () => {
    execute(
      () => signOut(auth),
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
