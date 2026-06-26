import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { auth } from '../../../core/firebase/auth';
import { onAuthStateChanged, User } from 'firebase/auth';

type AuthState = 'loading' | 'authenticated' | 'guest';

interface AuthContextValue {
  user: User | null;
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
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthState(u ? 'authenticated' : 'guest');
    });
    // Fallback: if Firebase Auth never calls back (network/init failure),
    // transition from loading to guest after 10s so the app isn't stuck.
    const timeout = setTimeout(() => {
      setAuthState(prev => prev === 'loading' ? 'guest' : prev);
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
export { useAuthStatus } from '../hooks/useAuthStatus';
