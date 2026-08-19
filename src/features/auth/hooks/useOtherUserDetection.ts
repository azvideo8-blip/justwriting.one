import { useState, useEffect, useCallback } from 'react';
import { useAuthStatus } from './useAuthStatus';
import { hasOtherUserData, clearOtherUserData } from '../services/localDataInventory';

export function useOtherUserDetection() {
  const { user, isGuest } = useAuthStatus();
  const [hasOtherData, setHasOtherData] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    if (!user || isGuest) {
      setHasOtherData(false);
      return;
    }
    const dismissed = sessionStorage.getItem(`jw_other_user_dismissed_${user.uid}`) === 'true';
    if (dismissed) {
      setHasOtherData(false);
      return;
    }

    setChecking(true);
    try {
      const found = await hasOtherUserData(user.uid);
      setHasOtherData(found);
    } catch {
      setHasOtherData(false);
    } finally {
      setChecking(false);
    }
  }, [user, isGuest]);

  useEffect(() => {
    void check();
  }, [check]);

  const dismiss = useCallback(() => {
    if (user) {
      sessionStorage.setItem(`jw_other_user_dismissed_${user.uid}`, 'true');
    }
    setHasOtherData(false);
  }, [user]);

  const clear = useCallback(async () => {
    if (!user) return { deletedDocs: 0 };
    const res = await clearOtherUserData(user.uid);
    setHasOtherData(false);
    sessionStorage.setItem(`jw_other_user_dismissed_${user.uid}`, 'true');
    return res;
  }, [user]);

  return {
    hasOtherData,
    checking,
    dismiss,
    clear,
    recheck: check,
  };
}
