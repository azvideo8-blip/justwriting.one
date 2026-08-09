import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';

export interface AdminStatus {
  isAdmin: boolean;
  isStaleToken: boolean;
  loading: boolean;
  error: string | null;
  refreshAdminClaim: () => Promise<boolean>;
}

export function useAdminStatus(): AdminStatus {
  const { user, loading: authLoading } = useAuth();
  const { profile } = useProfile();

  const profileLoading = !!user && profile === null;
  const isAdmin = profile?.role === 'admin';

  const refreshAdminClaim = async (): Promise<boolean> => {
    return isAdmin;
  };

  return {
    isAdmin,
    isStaleToken: false,
    loading: authLoading || profileLoading,
    error: null,
    refreshAdminClaim,
  };
}
