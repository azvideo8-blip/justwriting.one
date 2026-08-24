import { ThemeProvider } from '../core/theme/ThemeProvider';
import { WritingSettingsProvider } from '../features/writing/contexts/WritingSettingsContext';
import { SettingsProvider } from '../core/settings/SettingsProvider';
import { SettingsPanel } from '../features/settings/components/SettingsPanel';
import { LanguageProvider } from '../shared/i18n';
import { ToastProvider } from '../shared/components/Toast';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { LoginModalProvider } from '../features/auth/contexts/LoginModalContext';
import { AuthProvider } from '../features/auth/contexts/AuthContext';
import { ProfileProvider } from '../features/auth/contexts/ProfileContext';
import { AnalyticsProvider } from '../features/auth/contexts/AnalyticsContext';
import { HelmetProvider } from 'react-helmet-async';
import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { PrivacyModal, usePrivacyCheck } from '../features/auth/components/PrivacyModal';
import { SyncConsentModal, useSyncConsentCheck } from '../features/settings/components/SyncConsentModal';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { getOrCreateGuestId } from '../core/storage/localDb';

import { LocalDocumentService } from '../core/services/LocalDocumentService';
import { useBackgroundSync } from '../features/ai/hooks/useBackgroundSync';
import { useOnlineStatus } from '../shared/hooks/useOnlineStatus';

import { SyncService } from '../core/services/SyncService';
import { STORAGE_KEYS } from '../shared/constants/storageKeys';
import { reportError } from '../shared/errors/reportError';

// Resolves the auth-aware userId here so core's SettingsProvider stays free of
// feature imports (core must not import from features/).
function AuthAwareSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthStatus();
  // AUDIT-L18: getOrCreateGuestId пишет в localStorage — side effect не место
  // в render path; вычисляем один раз за монтирование провайдера.
  const guestId = useMemo(() => getOrCreateGuestId(), []);
  const userId = user?.uid ?? guestId;
  return (
    <SettingsProvider userId={userId} renderSettingsPanel={(props) => <SettingsPanel {...props} />}>
      {children}
    </SettingsProvider>
  );
}

function PrivacyGuard({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuthStatus();
  const { showPrivacy, setShowPrivacy } = usePrivacyCheck();
  const { showConsent, setShowConsent } = useSyncConsentCheck();
  useBackgroundSync();

  // One-time backfill: give canonical uuids to notes created before C1.1.
  // Uses useAuthStatus() so the effect fires once auth resolves —
  // supabase.auth.getSession() is async too — the session is not yet known
  // which caused backfill to run with a guest id, missing the auth user's docs.
  const backfillRanForRef = useRef<string | null>(null);
  useEffect(() => {
    const userId = user?.uid ?? getOrCreateGuestId();
    if (backfillRanForRef.current === userId) return;
    backfillRanForRef.current = userId;
    LocalDocumentService.backfillDocumentUuids(userId).catch(e =>
      reportError(e, { action: 'backfillDocumentUuids' })
    );
  }, [user]);

  return (
    <>
      {children}
      {isAuthenticated && showPrivacy && (
        <PrivacyModal onAccepted={() => setShowPrivacy(false)} />
      )}
      {isAuthenticated && !showPrivacy && showConsent && user && (
        <SyncConsentModal userId={user.uid} onClose={() => setShowConsent(false)} />
      )}
    </>
  );
}

/** Global sync queue drain — fires on connection recovery from any screen. */
function SyncManager() {
  const { user } = useAuthStatus();
  const isBrowserOnline = useOnlineStatus();
  const prevBrowserOnline = useRef(isBrowserOnline);


  // Browser online recovery
  useEffect(() => {
    if (isBrowserOnline && !prevBrowserOnline.current && user && localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED) === 'true') {
      SyncService.syncPending(user.uid).catch(e => reportError(e, { action: 'sync_manager_online_recovery' }));
    }
    prevBrowserOnline.current = isBrowserOnline;
  }, [isBrowserOnline, user]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ProfileProvider>
          <AnalyticsProvider>
            <LanguageProvider>
              <ThemeProvider>
                <WritingSettingsProvider>
                  <ToastProvider>
                    <LoginModalProvider>
                      <AuthAwareSettingsProvider>
                        <HelmetProvider>
                          <PrivacyGuard>
                            <SyncManager />
                            {children}
                          </PrivacyGuard>
                        </HelmetProvider>
                      </AuthAwareSettingsProvider>
                    </LoginModalProvider>
                  </ToastProvider>
                </WritingSettingsProvider>
              </ThemeProvider>
            </LanguageProvider>
          </AnalyticsProvider>
        </ProfileProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
