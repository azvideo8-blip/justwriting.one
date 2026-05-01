import { useNavigate } from 'react-router-dom';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { MobileLogScreen } from '../components/MobileLogScreen';
import { Session } from '../../../types';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';

export function MobileLogPage() {
  const { user, isGuest } = useAuthStatus();
  const navigate = useNavigate();
  const userId = user?.uid ?? getOrCreateGuestId();

  const handleContinue = (session: Session) => {
    navigate('/', { state: { sessionToContinue: session } });
  };

  return (
    <MobileLogScreen
      userId={userId}
      isGuest={isGuest}
      onContinue={handleContinue}
    />
  );
}
