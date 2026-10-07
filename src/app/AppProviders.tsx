import { ThemeProvider } from '../core/theme/ThemeProvider';
import { WritingSettingsProvider } from '../core/settings/WritingSettingsContext';
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
import { ReactNode, lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { usePrivacyCheck } from '../features/auth/components/usePrivacyCheck';
// Окно политики нужно редко — грузится лениво, проверка выше остаётся в стартовом куске.
const PrivacyModal = lazy(() => import('../features/auth/components/PrivacyModal').then(m => ({ default: m.PrivacyModal })));
import { SyncConsentModal, useSyncConsentCheck } from '../features/settings/components/SyncConsentModal';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { getOrCreateGuestId } from '../core/storage/localDb';

import { LocalDocumentService } from '../core/services/LocalDocumentService';
import { useBackgroundSync } from '../features/ai/hooks/useBackgroundSync';
import { useOnlineStatus } from '../shared/hooks/useOnlineStatus';

import { SyncService } from '../core/services/SyncService';
import { VAULT_UNLOCKED_EVENT } from '../core/crypto/useEncryptionStore';
import { STORAGE_KEYS } from '../shared/constants/storageKeys';
import { reportError } from '../shared/errors/reportError';
import { checkAndSyncCursor } from '../core/sync/changeCursor';

import { initAiDomainEvents } from '../features/ai/subscribeDomainEvents';
import { EarlierQuestionOpenContext } from './onboardingQueue';

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
  const location = useLocation();
  const isResetPassword = location.pathname.startsWith('/reset-password');
  const { showPrivacy, setShowPrivacy } = usePrivacyCheck(isResetPassword);
  const { showConsent, setShowConsent } = useSyncConsentCheck(isResetPassword);
  useBackgroundSync();

  useEffect(() => {
    return initAiDomainEvents();
  }, []);

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

  const earlierQuestionOpen = isAuthenticated && !isResetPassword && (showPrivacy || showConsent);
  return (
    <EarlierQuestionOpenContext.Provider value={earlierQuestionOpen}>
      {children}
      {isAuthenticated && !isResetPassword && showPrivacy && (
        <Suspense fallback={null}>
          <PrivacyModal onAccepted={() => setShowPrivacy(false)} />
        </Suspense>
      )}
      {isAuthenticated && !isResetPassword && !showPrivacy && showConsent && user && (
        <SyncConsentModal userId={user.uid} onClose={() => setShowConsent(false)} />
      )}
    </EarlierQuestionOpenContext.Provider>
  );
}

/** Global sync queue drain — fires on connection recovery from any screen. */
export function SyncManager() {
  const { user } = useAuthStatus();
  const isBrowserOnline = useOnlineStatus();
  const prevBrowserOnline = useRef(isBrowserOnline);


  // Сейф открыт (в этой вкладке или в соседней) — задачи, отложенные в карантин
  // из-за закрытого сейфа, оживают. Стор объявляет об этом событием: прямой
  // импорт SyncService из него замыкает цикл модулей.
  useEffect(() => {
    const onVaultUnlocked = () => {
      void SyncService.reviveLockedTasks(user?.uid)
        .then(() => {
          if (user?.uid) {
            void SyncService.syncPending(user.uid).catch(e =>
              reportError(e, { action: 'sync_pending_on_vault_unlock' }),
            );
            if (localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid)) === 'true') {
              void SyncService.downloadAllFromCloud(user.uid).catch(e =>
                reportError(e, { action: 'download_all_on_vault_unlock' }),
              );
            }
          }
        })
        .catch(e => reportError(e, { action: 'revive_locked_tasks_on_vault_unlock' }));
    };
    window.addEventListener(VAULT_UNLOCKED_EVENT, onVaultUnlocked);
    return () => window.removeEventListener(VAULT_UNLOCKED_EVENT, onVaultUnlocked);
  }, [user]);

  // Browser online recovery
  useEffect(() => {
    if (isBrowserOnline && !prevBrowserOnline.current && user) {
      SyncService.syncPending(user.uid).catch(e => reportError(e, { action: 'sync_manager_online_recovery' }));
      if (localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid)) === 'true') {
        SyncService.downloadAllFromCloud(user.uid).catch(e => reportError(e, { action: 'download_all_online_recovery' }));
      }
    }
    prevBrowserOnline.current = isBrowserOnline;
  }, [isBrowserOnline, user]);

  // Initial mount / auth login sync: device converges on cloud notes
  const initialSyncRanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || initialSyncRanRef.current === user.uid) return;
    if (localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid)) !== 'true') return;
    initialSyncRanRef.current = user.uid;
    SyncService.downloadAllFromCloud(user.uid).catch(e =>
      reportError(e, { action: 'download_all_on_auth' }),
    );
  }, [user]);

  // SYNC-CURSOR-2: check change cursor on visibilitychange (tab regains focus)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) return;
      if (!user?.uid) return;
      if (localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid)) !== 'true') return;
      void checkAndSyncCursor(user.uid).catch(e =>
        reportError(e, { action: 'check_and_sync_cursor_visibility' }),
      );
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [user]);

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
