import { useNavigate } from 'react-router-dom';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { MobileLogScreen } from '../components/MobileLogScreen';
import { Session } from '../../../types';
import { getOrCreateGuestId } from '../../../core/storage/localDb';

export function MobileLogPage() {
  const { user, isGuest, profile } = useAuthStatus();
  const navigate = useNavigate();
  const userId = user?.uid ?? getOrCreateGuestId();

  const handleContinue = (session: Session) => {
    void navigate('/', { state: { sessionToContinue: session } });
  };

  return (
    <MobileLogScreen
      userId={userId}
      isGuest={isGuest}
      onContinue={handleContinue}
      labels={profile?.labels || []}
    />
  );
}
