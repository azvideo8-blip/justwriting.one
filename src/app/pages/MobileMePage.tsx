import { MobileMeScreen } from './MobileMeScreen';
import { useAuthStatus } from '../useAuthStatus';

/** MF-9: «Выйти» в профиле открывает то же окно подтверждения, что /settings. */
export function MobileMePage() {
  const { user, profile } = useAuthStatus();
  return <MobileMeScreen user={user} profile={profile} />;
}
