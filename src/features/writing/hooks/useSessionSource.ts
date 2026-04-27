import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useWritingSettings } from '../contexts/WritingSettingsContext';

export type SessionSource = 'local' | 'cloud' | 'both';

export function useSessionSource(): SessionSource {
  const { isGuest, isAuthenticated } = useAuthStatus();
  const { storagePreference } = useWritingSettings();

  if (isGuest) return 'local';
  if (!isAuthenticated) return 'local';

  return storagePreference;
}
