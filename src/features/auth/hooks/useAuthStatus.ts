import { useState, useEffect, useRef } from 'react';
import { auth } from '../../../core/firebase/auth';
import { db, onConnectionChange } from '../../../core/firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { onSnapshot, doc, setDoc } from 'firebase/firestore';
import { UserProfile } from '../../../types';
import * as Sentry from '@sentry/react';

export function useAuthStatus() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
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
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      const timer = setTimeout(() => {
        setProfile(null);
      }, 0);
      creationAttemptedRef.current = false;
      return () => clearTimeout(timer);
    }

    const userDoc = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDoc, (snap) => {
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
          creationAttemptedRef.current = false;
        });
        setProfile(initialProfile);
      }
    }, (err) => {
      console.error('Firestore snapshot error:', err);
    });

    return unsubscribe;
  }, [user]);

  return { user, profile, loading, isConnected };
}
