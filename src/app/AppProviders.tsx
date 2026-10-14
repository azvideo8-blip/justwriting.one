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
import { MobileLayoutAccessProvider } from './MobileLayoutAccessProvider';
import { AnalyticsProvider } from '../features/auth/contexts/AnalyticsContext';
import { HelmetProvider } from 'react-helmet-async';
import { ReactNode, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePrivacyCheck } from '../features/auth/components/usePrivacyCheck';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';
import { useMobileLayoutAccessAnswered } from '../shared/hooks/useMobileLayoutAccess';
import { decideFirstRunShell, FIRST_RUN_ACCESS_WAIT_MS } from './firstRunShell';
// Окно политики нужно редко — грузится лениво, проверка выше остаётся в стартовом куске.
const PrivacyModal = lazy(() => import('../features/auth/components/PrivacyModal').then(m => ({ default: m.PrivacyModal })));
// MC-6: степпер первого входа — только телефон, и тоже лениво: на десктопе он
// не монтируется вовсе, и его кусок не платит за стартовый бандл.
const FirstRunFlow = lazy(() => import('../features/auth/components/FirstRunStepper').then(m => ({ default: m.FirstRunFlow })));
import { useSyncConsentCheck } from '../features/settings/components/useSyncConsentCheck';
// MC-6: окно вопроса об облаке грузится лениво — на телефоне его заменяет
// степпер, и таскать его разметку в index-кусок больше незачем.
const SyncConsentModal = lazy(() => import('../features/settings/components/SyncConsentModal').then(m => ({ default: m.SyncConsentModal })));
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
  const { layoutMode, mobilePreferred } = useLayoutMode();
  const accessAnswered = useMobileLayoutAccessAnswered();
  const [accessTimedOut, setAccessTimedOut] = useState(false);
  const [stepperOpen, setStepperOpen] = useState(false);
  useBackgroundSync();

  // MC-6: право на мобильный макет приходит RPC уже после входа. Пока ответа
  // нет, окно первого входа молчит — иначе телефон успел бы показать десктопный
  // стек и тут же его сменить. Ждём не больше FIRST_RUN_ACCESS_WAIT_MS.
  useEffect(() => {
    if (accessAnswered) return;
    const id = setTimeout(() => setAccessTimedOut(true), FIRST_RUN_ACCESS_WAIT_MS);
    return () => clearTimeout(id);
  }, [accessAnswered]);

  const firstRunShell = decideFirstRunShell({
    mobileLayout: layoutMode === 'mobile',
    mobilePreferred,
    accessAnswered,
    timedOut: accessTimedOut,
  });

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

  // Очередь за `PrivacyGuard` (код восстановления, загрузка из облака) обязана
  // молчать, пока открыт степпер или пока мы ещё не знаем, чем отвечать на
  // вопросы входа.
  const firstRunOpen = firstRunShell === 'hold'
    ? true
    : firstRunShell === 'stepper'
      ? stepperOpen
      : (showPrivacy || showConsent);
  const earlierQuestionOpen = isAuthenticated && !isResetPassword && firstRunOpen;
  return (
    <EarlierQuestionOpenContext.Provider value={earlierQuestionOpen}>
      {children}
      {isAuthenticated && !isResetPassword && firstRunShell === 'stepper' && user && (
        <Suspense fallback={null}>
          <FirstRunFlow
            uid={user.uid}
            showPrivacy={showPrivacy}
            showConsent={showConsent}
            onPrivacyDone={() => setShowPrivacy(false)}
            onConsentDone={() => setShowConsent(false)}
            onOpenChange={setStepperOpen}
          />
        </Suspense>
      )}
      {isAuthenticated && !isResetPassword && firstRunShell === 'dialogs' && showPrivacy && (
        <Suspense fallback={null}>
          <PrivacyModal onAccepted={() => setShowPrivacy(false)} />
        </Suspense>
      )}
      {isAuthenticated && !isResetPassword && firstRunShell === 'dialogs' && !showPrivacy && showConsent && user && (
        <Suspense fallback={null}>
          <SyncConsentModal userId={user.uid} onClose={() => setShowConsent(false)} />
        </Suspense>
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
        {/* MB-1: право на мобильный макет читается один раз здесь, а не по RPC
            на каждого из 15 потребителей useLayoutMode. */}
        <MobileLayoutAccessProvider>
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
        </MobileLayoutAccessProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
