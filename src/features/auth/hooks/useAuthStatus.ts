import { useState, useEffect, useRef } from 'react';
import { auth } from '../../../core/firebase/auth';
import { db, onConnectionChange } from '../../../core/firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { onSnapshot, doc, setDoc } from 'firebase/firestore';
import { UserProfile } from '../../../types';
import * as Sentry from '@sentry/react';

export type AuthState = 'loading' | 'authenticated' | 'guest';

export function useAuthStatus() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authState, setAuthState] = useState<AuthState>('loading');
  const creationAttemptedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(true);

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
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthState(u ? 'authenticated' : 'guest');
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
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

  return { user, profile, authState, isAuthenticated: authState === 'authenticated', isGuest: authState === 'guest', loading: authState === 'loading', isConnected };
}
