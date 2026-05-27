import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { auth } from '../../../core/firebase/auth';
import { onConnectionChange } from '../../../core/firebase/firestore';
import { getClient } from '../../../core/firebase/firestoreClient';
import { onAuthStateChanged, User } from 'firebase/auth';
import { UserProfile } from '../../../types';
import * as Sentry from '@sentry/react';
import { clearSessionKey } from '../../../core/crypto/encrypt';
import { reportError } from '../../../core/errors/reportError';
import { analytics } from '../../../core/analytics/analytics';
import { setEncryptionEnabled, setProfileLoaded } from '../../../core/crypto/cryptoHelpers';
import { userProfileDbSchema } from '../../../core/firebase/schemas/firestoreSchemas';
import { STORAGE_KEYS } from '../../../core/constants/storageKeys';

type AuthState = 'loading' | 'authenticated' | 'guest';

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
  const profileSetBySnapshotRef = useRef(false);

  useEffect(() => {
    const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
    const isSentryInitialized = sentryDsn && sentryDsn.startsWith('https://');

    if (user && isSentryInitialized) {
      Sentry.setUser({ id: user.uid });
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

      if (!u) {
        setProfileLoaded('guest', true);
      } else {
        setProfileLoaded(u.uid, false);
      }

      if (!uidChanged) return;

      if (u) {
        analytics.identify(u.uid);
        try {
          const guestId = localStorage.getItem(STORAGE_KEYS.GUEST_ID);
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(STORAGE_KEYS.LOCAL_SESSION_PREFIX)) {
              if (!guestId || !key.includes(guestId)) keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch (e) {
          reportError(e, { action: 'cleanupOldSessionKeys', uid: u.uid }, 'warning');
        }
      } else {
        analytics.reset();
        clearSessionKey();
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting profile when user signs out
      setProfile(null);
      setProfileLoaded('guest', true);
      creationAttemptedRef.current = false;
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const { db, mod } = await getClient();
      const { onSnapshot, doc, setDoc, getDoc } = mod;
      if (cancelled) return;

      const userDoc = doc(db, 'users', user.uid);
      unsubscribe = onSnapshot(userDoc, async (snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data();
          if (data && typeof data === 'object' && 'uid' in data) {
            const parsed = userProfileDbSchema.safeParse(data);
            if (parsed.success) {
              profileSetBySnapshotRef.current = true;
              setProfile(parsed.data as UserProfile);
              setEncryptionEnabled(user.uid, !!(parsed.data.encryptionSalt && parsed.data.encryptedDataKey));
              setProfileLoaded(user.uid, true);
            } else {
              if (import.meta.env.DEV) console.warn('Invalid profile data for uid:', user.uid, parsed.error.flatten());
              setProfile(null);
              setEncryptionEnabled(user.uid, false);
              setProfileLoaded(user.uid, true);
            }
          } else {
            if (import.meta.env.DEV) console.warn('Invalid profile data for uid:', user.uid, data);
            setProfile(null);
            setEncryptionEnabled(user.uid, false);
            setProfileLoaded(user.uid, true);
          }
        } else {
          setEncryptionEnabled(user.uid, false);
          if (creationAttemptedRef.current) return;
          creationAttemptedRef.current = true;

          try {
            const existingSnap = await getDoc(userDoc);
            if (existingSnap.exists()) {
              creationAttemptedRef.current = false;
              return;
            }
          } catch (e) {
            reportError(e, { action: 'checkProfileExists', uid: user.uid });
            creationAttemptedRef.current = false;
            return;
          }

          const initialProfile: UserProfile = {
            uid: user.uid,
            email: user.email || '',
            nickname: user.displayName || user.email?.split('@')[0] || 'User'
          };

          if (import.meta.env.DEV) {
            console.warn('Creating initial user profile:', JSON.stringify(initialProfile));
          }

          setDoc(userDoc, initialProfile, { merge: true }).then(() => {
            creationAttemptedRef.current = false;
            if (!cancelled && !profileSetBySnapshotRef.current) {
              setProfile(initialProfile);
              setProfileLoaded(user.uid, true);
            }
          }).catch(err => {
            console.error('Error creating user profile:', err);
            Sentry.captureException(err, {
              tags: { context: 'profile_creation' },
              extra: { uid: user.uid },
            });
            creationAttemptedRef.current = false;
            if (!cancelled) {
              setProfile(null);
              setProfileLoaded(user.uid, true);
            }
          });
        }
      }, (err) => {
        console.error('Firestore snapshot error:', err);
        reportError(err, { action: 'profileSnapshot', uid: user.uid });
        setIsConnected(false);
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
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
