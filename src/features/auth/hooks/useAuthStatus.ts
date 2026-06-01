import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { useAnalytics } from '../contexts/AnalyticsContext';

export function useAuthStatus() {
  const { user, authState, isAuthenticated, isGuest, loading } = useAuth();
  const { profile } = useProfile();
  const { isConnected } = useAnalytics();

  return {
    user,
    profile,
    authState,
    isAuthenticated,
    isGuest,
    loading,
    isConnected,
  };
}

export { AuthProvider } from '../contexts/AuthContext';
