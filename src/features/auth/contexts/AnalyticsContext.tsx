import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { clearSessionKey } from '../../../core/crypto/encrypt';
import { analytics } from '../../../core/analytics/analytics';
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
    const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
    const isSentryInitialized = Boolean(sentryDsn && typeof sentryDsn === 'string' && sentryDsn.startsWith('https://'));

    if (user != null && isSentryInitialized) {
      const encoder = new TextEncoder();
      void crypto.subtle.digest('SHA-256', encoder.encode(user.uid)).then(hashBuffer => {
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashedId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
        Sentry.setUser({ id: hashedId });
      });
    } else if (user == null && isSentryInitialized) {
      Sentry.setUser(null);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      analytics.identify(user.uid);
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
      analytics.reset();
      clearSessionKey();
    }
  }, [user]);

  return (
    <AnalyticsContext.Provider value={{ isConnected }}>
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalytics(): AnalyticsContextValue {
  return useContext(AnalyticsContext);
}

export { AnalyticsContext };
