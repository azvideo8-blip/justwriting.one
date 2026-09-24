import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react';
import { clearSessionKey } from '../../../core/crypto/encrypt';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { reportError } from '../../../shared/errors/reportError';

import { useAuth } from './AuthContext';

interface AnalyticsContextValue {
  isConnected: boolean;
}

const AnalyticsContext = createContext<AnalyticsContextValue>({ isConnected: true });

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Read the initial value during state init, not from inside the effect.
  // Setting state synchronously in an effect costs an extra render pass on every
  // mount, and eslint rejects it.
  const [isConnected, setIsConnected] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsConnected(true);
    const handleOffline = () => setIsConnected(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (user) {
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
        reportError(e, { action: 'cleanupOldSessionKeys', uid: user.uid }, 'warning');
      }
    } else {
      clearSessionKey();
    }
  }, [user]);

  const value = useMemo(() => ({ isConnected }), [isConnected]);

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalytics(): AnalyticsContextValue {
  return useContext(AnalyticsContext);
}

export { AnalyticsContext };
