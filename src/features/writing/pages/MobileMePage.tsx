import { MobileMeScreen } from '../components/MobileMeScreen';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { signOut } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { useNavigate } from 'react-router-dom';

export function MobileMePage() {
  const { user, profile } = useAuthStatus();
  const navigate = useNavigate();

  if (!user) return null;

  const handleSignOut = async () => {
    await signOut(auth);
    navigate('/login');
  };

  return (
    <MobileMeScreen
      user={user}
      profile={profile}
      onSignOut={handleSignOut}
    />
  );
}
