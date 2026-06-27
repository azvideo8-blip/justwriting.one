import { createContext, useContext, useState, useEffect, useRef, useMemo, ReactNode } from 'react';
import { getClient } from '../../../core/firebase/firestoreClient';
import { UserProfile } from '../../../types';
import { userProfileDbSchema } from '../../../core/firebase/schemas/firestoreSchemas';
import { setEncryptionEnabled, setProfileLoaded } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { useAuth } from './AuthContext';

interface ProfileContextValue {
  profile: UserProfile | null;
}

const ProfileContext = createContext<ProfileContextValue>({ profile: null });

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const creationAttemptedRef = useRef(false);
  const profileSetBySnapshotRef = useRef(false);

  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting profile when user signs out
      setProfile(null);
      setProfileLoaded('guest', true);
      creationAttemptedRef.current = false;
      return;
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      try {
        const { db, mod } = await getClient();
        const { onSnapshot, doc, setDoc, getDoc } = mod;
        if (cancelled) return;

      const userDoc = doc(db, 'users', user.uid);
      unsubscribe = onSnapshot(userDoc, (snap) => {
        if (cancelled) return;
        void (async () => {
          if (snap.exists()) {
            const data = snap.data();
            if (typeof data === 'object' && data != null && 'uid' in data) {
              const parsed = userProfileDbSchema.safeParse(data);
              if (parsed.success) {
                profileSetBySnapshotRef.current = true;
                setProfile(parsed.data as UserProfile);
                setEncryptionEnabled(user.uid, !!(parsed.data.encryptionSalt && parsed.data.encryptedDataKey) || !!parsed.data.encryptionMeta);
                setProfileLoaded(user.uid, true);
              } else {
                if (import.meta.env.DEV) console.warn('Invalid profile data for uid:', user.uid, parsed.error.flatten());
                setProfile(null);
                // V-1: profile parse failed — can't determine if encryption is
                // configured. Do NOT flip encryptionEnabled to false; keep the
                // vault locked so maybeEncrypt blocks plaintext writes
                // (ref: security-invariants.md #2).
                setProfileLoaded(user.uid, true);
              }
            } else {
              if (import.meta.env.DEV) console.warn('Invalid profile data for uid:', user.uid, data);
              setProfile(null);
              // V-1: profile data shape invalid — same invariant as above.
              // Do NOT set encryptionEnabled=false (ref: security-invariants.md #2).
              setProfileLoaded(user.uid, true);
            }
          } else {
            // V-1: no profile doc exists — confirmed brand-new user with no
            // encryption config. Safe to set false (ref: security-invariants.md #2).
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

            void setDoc(userDoc, initialProfile, { merge: true }).then(() => {
              creationAttemptedRef.current = false;
              if (!cancelled && !profileSetBySnapshotRef.current) {
                setProfile(initialProfile);
                setProfileLoaded(user.uid, true);
              }
            }).catch(err => {
              reportError(err, { action: 'createUserProfile', uid: user.uid });
              creationAttemptedRef.current = false;
              if (!cancelled) {
                setProfile(null);
                setProfileLoaded(user.uid, true);
              }
            });
          }
        })();
      }, (err) => {
        reportError(err, { action: 'profileSnapshot', uid: user.uid });
      });
      } catch (e) {
        reportError(e, { action: 'profileContext_init', uid: user.uid });
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [user]);

  const value = useMemo(() => ({ profile }), [profile]);

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext);
}

export { ProfileContext };
