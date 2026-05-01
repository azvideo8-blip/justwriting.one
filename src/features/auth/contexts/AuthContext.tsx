import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { auth } from '../../../core/firebase/auth';
import { db, onConnectionChange } from '../../../core/firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { onSnapshot, doc, setDoc } from 'firebase/firestore';
import { UserProfile } from '../../../types';
import * as Sentry from '@sentry/react';

export type AuthState = 'loading' | 'authenticated' | 'guest';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  authState: AuthState;
  isAuthenticated: boolean;
  isGuest: boolean;
  loading: boolean;
  isConnected: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  authState: 'loading',
  isAuthenticated: false,
  isGuest: false,
  loading: true,
  isConnected: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [isConnected, setIsConnected] = useState(true);
  const creationAttemptedRef = useRef(false);
  const prevUidRef = useRef<string | null>(null);

  useEffect(() => {
    const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
    const isSentryInitialized = sentryDsn && sentryDsn.startsWith('https://');

    if (user && isSentryInitialized) {
      Sentry.setUser({ id: user.uid, email: user.email ?? undefined });
    } else if (!user && isSentryInitialized) {
      Sentry.setUser(null);
    }
  }, [user]);

  useEffect(() => {
    return onConnectionChange(setIsConnected);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      const newUid = u?.uid ?? null;
      const uidChanged = prevUidRef.current !== newUid;
      prevUidRef.current = newUid;

      setUser(u);
      setAuthState(u ? 'authenticated' : 'guest');

      if (!uidChanged) return;

      if (u) {
        try {
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith('local_session_')) keysToRemove.push(key);
          }
          keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch { /* ignore */ }
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setTimeout(() => setProfile(null), 0);
      creationAttemptedRef.current = false;
      return;
    }

    let cancelled = false;
    const userDoc = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDoc, (snap) => {
      if (cancelled) return;
      if (snap.exists()) {
        setProfile(snap.data() as UserProfile);
      } else {
        if (creationAttemptedRef.current) return;
        creationAttemptedRef.current = true;
        const initialProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          nickname: user.displayName || user.email?.split('@')[0] || 'User'
        };

        if (import.meta.env.DEV) {
          console.warn('Creating initial user profile:', JSON.stringify(initialProfile));
        }

        setDoc(userDoc, initialProfile).then(() => {
          creationAttemptedRef.current = false;
        }).catch(err => {
          console.error('Error creating user profile:', err);
          Sentry.captureException(err, {
            tags: { context: 'profile_creation' },
            extra: { uid: user.uid },
          });
          creationAttemptedRef.current = false;
        });
        if (!cancelled) setProfile(initialProfile);
      }
    }, (err) => {
      console.error('Firestore snapshot error:', err);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user]);

  const value: AuthContextValue = {
    user,
    profile,
    authState,
    isAuthenticated: authState === 'authenticated',
    isGuest: authState === 'guest',
    loading: authState === 'loading',
    isConnected,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthStatus(): AuthContextValue {
  return useContext(AuthContext);
}
