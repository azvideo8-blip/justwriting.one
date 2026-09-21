import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { onAuthStateChange } from '../../../core/auth';
import { reportError } from '../../../shared/errors/reportError';

import type { AppUser } from '../../../core/auth/types';

type AuthState = 'loading' | 'authenticated' | 'guest';

interface AuthContextValue {
  user: AppUser | null;
  authState: AuthState;
  isAuthenticated: boolean;
  isGuest: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  authState: 'loading',
  isAuthenticated: false,
  isGuest: false,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    const unsubscribe = onAuthStateChange((u) => {
      setUser(u);
      setAuthState(u ? 'authenticated' : 'guest');
    });

    const timeout = setTimeout(() => {
      setAuthState(prev => {
        if (prev === 'loading') {
          reportError(
            new Error('AUTH_TIMEOUT: Supabase auth state change did not fire within 10s'),
            { action: 'auth_init_timeout' },
            'warning',
          );
          return 'guest';
        }
        return prev;
      });
    }, 10_000);
    return () => { unsubscribe(); clearTimeout(timeout); };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    authState,
    isAuthenticated: authState === 'authenticated',
    isGuest: authState === 'guest',
    loading: authState === 'loading',
  }), [user, authState]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export { AuthContext };
