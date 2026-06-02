import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { clearSessionKey } from '../../../core/crypto/encrypt';
import { analytics } from '../../../core/analytics/analytics';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { reportError } from '../../../shared/errors/reportError';
import { onConnectionChange } from '../../../core/firebase/firestore';
import { useAuth } from './AuthContext';

interface AnalyticsContextValue {
  isConnected: boolean;
}

const AnalyticsContext = createContext<AnalyticsContextValue>({ isConnected: true });

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    return onConnectionChange(setIsConnected);
  }, []);

  useEffect(() => {
    const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
    const isSentryInitialized = Boolean(sentryDsn && typeof sentryDsn === 'string' && sentryDsn.startsWith('https://'));

    if (user != null && isSentryInitialized) {
      Sentry.setUser({ id: user.uid });
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
