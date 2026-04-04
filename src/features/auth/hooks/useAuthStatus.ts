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
    if (user && import.meta.env.VITE_SENTRY_DSN) {
      Sentry.setUser({ id: user.uid, email: user.email ?? undefined });
    } else if (!user) {
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
      setProfile(null);
      creationAttemptedRef.current = false;
      return;
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
        
        console.log('Creating initial user profile:', JSON.stringify(initialProfile));
        
        setDoc(userDoc, initialProfile).catch(err => {
          console.error('Error creating user profile:', err);
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
