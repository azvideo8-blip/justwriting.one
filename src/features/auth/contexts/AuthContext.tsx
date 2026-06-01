import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthState(u ? 'authenticated' : 'guest');
    });
    return unsubscribe;
  }, []);

  const value: AuthContextValue = {
    user,
    authState,
    isAuthenticated: authState === 'authenticated',
    isGuest: authState === 'guest',
    loading: authState === 'loading',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export { AuthContext };
export { useAuthStatus } from '../hooks/useAuthStatus';
