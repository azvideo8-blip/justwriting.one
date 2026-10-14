import { MobileMeScreen } from './MobileMeScreen';
import { useAuthStatus } from '../useAuthStatus';

/**
 * MR-5: «Выйти» и язык переехали в настройки аккаунта (/settings#account), поэтому
 * экрану профиля больше не нужна модалка подтверждения выхода.
 */
export function MobileMePage() {
  const { user, profile } = useAuthStatus();
  return <MobileMeScreen user={user} profile={profile} />;
}
