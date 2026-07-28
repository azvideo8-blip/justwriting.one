import { useEffect, useState, useCallback } from 'react';
import { getAuth, onIdTokenChanged, type User } from 'firebase/auth';
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

  const [isAdmin, setIsAdmin] = useState(false);
  const [isStaleToken, setIsStaleToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAdminClaim = useCallback(async (authUser: User | null, isProfileAdmin: boolean) => {
    if (!authUser) {
      setIsAdmin(false);
      setIsStaleToken(false);
      setError(null);
      setLoading(false);
      return false;
    }

    try {
      setLoading(true);
      // 1. Read claim from initial ID Token result
      let tokenResult = await authUser.getIdTokenResult();
      let hasClaim = tokenResult.claims.role === 'admin';

      // 2. If profile field says admin but token claim does not, try silent refresh once
      if (!hasClaim && isProfileAdmin) {
        await authUser.getIdToken(true);
        tokenResult = await authUser.getIdTokenResult();
        hasClaim = tokenResult.claims.role === 'admin';
      }

      // 3. Still no claim. A refresh only re-issues what already exists, so a
      // claim that was never granted stays absent forever — the state a first
      // admin promoted directly in the console is in. Ask the server to derive
      // it from the (server-controlled) profile field, then refresh again.
      if (!hasClaim && isProfileAdmin) {
        try {
          const { getFunctions, httpsCallable } = await import('firebase/functions');
          // Default region (us-central1) — syncMyAdminClaim declares none, like
          // every other callable here except deleteAccount.
          const sync = httpsCallable<unknown, { changed: boolean; isAdmin: boolean }>(
            getFunctions(),
            'syncMyAdminClaim',
          );
          const { data } = await sync({});
          if (data.isAdmin) {
            await authUser.getIdToken(true);
            tokenResult = await authUser.getIdTokenResult();
            hasClaim = tokenResult.claims.role === 'admin';
          }
        } catch {
          // Offline, App Check, not deployed yet — fall through to the
          // stale-token branch, which tells the user something they can act on.
          // A generic "could not check permissions" would be a downgrade.
        }
      }

      if (hasClaim) {
        setIsAdmin(true);
        setIsStaleToken(false);
        setError(null);
        setLoading(false);
        return true;
      } else if (isProfileAdmin) {
        // Field says admin, but after token refresh, claim is STILL missing
        setIsAdmin(false);
        setIsStaleToken(true);
        setError('Учётная запись помечена как администратор в БД, но токен сессии устарел. Пожалуйста, выйдите из системы и войдите снова.');
        setLoading(false);
        return false;
      } else {
        setIsAdmin(false);
        setIsStaleToken(false);
        setError(null);
        setLoading(false);
        return false;
      }
    } catch {
      setIsAdmin(false);
      setIsStaleToken(false);
      setError('Не удалось проверить права администратора');
      setLoading(false);
      return false;
    }
  }, []);

  const refreshAdminClaim = useCallback(async (): Promise<boolean> => {
    const auth = getAuth();
    const currentUser = auth.currentUser ?? user;
    const isProfileAdmin = profile?.role === 'admin';
    return checkAdminClaim(currentUser, isProfileAdmin);
  }, [user, profile, checkAdminClaim]);

  useEffect(() => {
    if (authLoading) return;
    const isProfileAdmin = profile?.role === 'admin';
    let isMounted = true;

    const auth = getAuth();
    const unsubscribe = onIdTokenChanged(auth, (changedUser) => {
      if (isMounted) {
        void checkAdminClaim(changedUser, isProfileAdmin);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [profile, authLoading, checkAdminClaim]);

  return {
    isAdmin,
    isStaleToken,
    loading: authLoading || loading,
    error,
    refreshAdminClaim,
  };
}
