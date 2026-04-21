import { useNavigate } from 'react-router-dom';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { MobileLogScreen } from '../components/MobileLogScreen';
import { Session } from '../../../types';

export function MobileLogPage() {
  const { user } = useAuthStatus();
  const navigate = useNavigate();

  if (!user) return null;

  const handleContinue = (session: Session) => {
    navigate('/', { state: { sessionToContinue: session } });
  };

  return (
    <MobileLogScreen
      userId={user.uid}
      onContinue={handleContinue}
    />
  );
}
