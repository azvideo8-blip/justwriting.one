import React, { useContext, useEffect, Suspense } from 'react';
import { EarlierQuestionOpenContext } from './onboardingQueue';
import { useLocation } from 'react-router-dom';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useWritingSettings } from '../core/settings/WritingSettingsContext';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';
import { useNarrowViewport } from '../shared/hooks/useNarrowViewport';
import { useLanguage } from '../shared/i18n';
import { cn } from '../core/utils/utils';
import { useLoginModal } from '../features/auth/contexts/LoginModalContext';
import { useSyncStatus } from '../core/sync/useSyncStatus';
import { useToast } from '../shared/components/Toast';
import { VAULT_PASSWORD_CONVERGED_EVENT } from '../core/crypto/vaultEvents';
import { takeAccountChangeNotice, getAccountChangeNoticeUid } from '../core/auth/accountReload';
import { getClockSkewSec, takeClockSkewWarning } from '../core/auth/supabaseAuthProvider';

import { AppLayout } from '../shared/components/Layout/AppLayout';
import { Sidebar } from '../features/navigation/components/Sidebar';
import { BottomNav } from '../features/navigation/components/BottomNav';
import { ConnectionStatusBanner } from '../features/writing/components/ConnectionStatusBanner';
import { ThemeBackground } from '../core/theme/ThemeBackground';
import { LoginModalOverlay } from '../features/auth/components/LoginModalOverlay';
import { useSettings } from '../core/settings/SettingsContext';
// DEBT-1 (#55): модальные окна не нужны первому экрану — в отдельные чанки.
const EncryptionPasswordModal = React.lazy(() =>
  import('../features/encryption/components/EncryptionPasswordModal').then(m => ({ default: m.EncryptionPasswordModal })),
);
import { useEncryptionSetup } from '../features/encryption/hooks/useEncryptionSetup';
import { RecoveryCodeGate } from '../features/encryption/components/RecoveryCodeGate';
import { setupGlobalErrorListeners } from '../shared/errors/reportError';
import { ActivityLogBadge } from './ActivityLogBadge';
import { LOCAL_DB_STALLED_EVENT } from '../core/storage/localDbStall';

import { AppRoutes } from './AppRoutes';
import { ConfirmDialogRenderer, useConfirmDialog } from '../shared/components/ConfirmDialog';
import { useAdminStatus } from '../features/auth/hooks/useAdminStatus';
// BR-3: окна первого входа (восстановление из облака + «данные другого
// пользователя») — одним ленивым узлом. Их статические импорты тянули в
// стартовый кусок `useEmptyDeviceDetection` и `OtherUserDataModal`.
const FirstEntryModals = React.lazy(() =>
  import('./FirstEntryModals').then(m => ({ default: m.FirstEntryModals })),
);
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
// BS (N-2): мост миграции гостя — окно для немногих, а его статический импорт
// через MigrationPrompt тянул за собой SyncService и LocalDocumentService в
// стартовый кусок.
const GuestMigrationGate = React.lazy(() =>
  import('../features/auth/components/GuestMigrationGate').then(m => ({ default: m.GuestMigrationGate })),
);

export function AppShell() {
  const location = useLocation();
  // ON-1: мастер приглашения сам создаёт сейф и показывает код восстановления —
  // окна сейфа и кода поверх него не нужны.
  const isResetPassword = location.pathname.startsWith('/reset-password');
  const { t } = useLanguage();
  const { user, isGuest } = useAuthStatus();
  const { isAdmin } = useAdminStatus();
  const { isZenActive, zenModeEnabled, silenceMode } = useWritingSettings();
  const { layoutMode } = useLayoutMode();
  const narrow = useNarrowViewport();
  const { loginModalOpen } = useLoginModal();
  const { openSettings } = useSettings();
  const { mode: encryptionMode, check: recheckEncryption, dismiss: dismissEncryption } = useEncryptionSetup();
  // Окна первого входа — по одному: пока открыт вопрос политики или синхронизации,
  // остальные ждут (onboardingQueue.ts, `queued` читает сам узел).
  const queued = useContext(EarlierQuestionOpenContext);


  useSyncStatus(isGuest ? null : (user?.uid ?? null));

  useEffect(() => {
    setupGlobalErrorListeners();
  }, []);

  // D-28: после сброса пароля по почте сейф перешифрован паролем входа.
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();
  useEffect(() => {
    const onConverged = () => showToast(t('enc_password_converged'), 'success');
    window.addEventListener(VAULT_PASSWORD_CONVERGED_EVENT, onConverged);
    return () => window.removeEventListener(VAULT_PASSWORD_CONVERGED_EVENT, onConverged);
  }, [showToast, t]);

  // DY10-9: локальная база не отвечает — подсказка, раз в минуту, а не на каждую операцию.
  useEffect(() => {
    let shownAt = 0;
    const onStalled = () => {
      if (Date.now() - shownAt < 60_000) return;
      shownAt = Date.now();
      showToast(t('local_db_stalled'), 'error');
    };
    window.addEventListener(LOCAL_DB_STALLED_EVENT, onStalled);
    return () => window.removeEventListener(LOCAL_DB_STALLED_EVENT, onStalled);
  }, [showToast, t]);

  // Выход перезагружает страницу — сообщение о нём показывает уже новая.
  useEffect(() => {
    const notice = takeAccountChangeNotice();
    if (notice === 'signed_out') showToast(t('settings_sign_out_notice'), 'success');
    else if (notice === 'signed_out_wiped') showToast(t('settings_sign_out_notice_wiped'), 'success');
    else if (notice === 'wipe_failed') showToast(t('settings_sign_out_notice_wipe_failed'), 'error');
    else if (notice === 'account_deleted') showToast(t('settings_delete_account_success'), 'success');
    else if (notice === 'account_deleted_wipe_failed') showToast(t('settings_delete_account_wipe_failed'), 'error');
    // Бюджет стартового чанка (ci.yml): предложение стирания и тост про часы — по
    // требованию, они нужны только странице после нечаянного выхода.
    else if (notice === 'lost_session') void import('../features/auth/services/lostSessionWipe').then(m => m.offerLostSessionWipe(showToast, t, confirmDialog));
    else if (notice === 'clock_skew') {
      // CK-3: часы спешат — вход оборвался не потому, что сессию отозвали.
      // Стирать здесь нечего: локальные данные целы и принадлежат этому человеку,
      // поэтому предложение стирания (S-28) не показывается вовсе.
      const skewSec = getClockSkewSec(getAccountChangeNoticeUid());
      void import('../features/auth/services/clockSkewToast').then(m => m.showClockSkewToast(showToast, t, skewSec, true));
    }
  }, [showToast, t, confirmDialog]);

  // CK-2: часы спешат — сказать сразу после входа, а не ждать, пока сессия
  // оборвётся. Один тост на вкладку: при просроченном по часам токене обновлений
  // бывает десятки подряд, и каждый с тостом превратил бы экран в мелькание.
  useEffect(() => {
    const uid = user?.uid ?? null;
    if (!takeClockSkewWarning(uid)) return;
    const skewSec = getClockSkewSec(uid);
    void import('../features/auth/services/clockSkewToast').then(m => m.showClockSkewToast(showToast, t, skewSec, false));
  }, [user?.uid, showToast, t]);

  const currentPath = location.pathname;
  // SA-20 (N-1): экраны входа гостя на телефоне — без навигации и без отступов
  // под неё. Гость ещё не выбирал макет, право `mobile_layout_allowed` к нему не
  // применяется, а рейка 64 px снимает 18 % ширины 360 и показывает вкладки, до
  // которых человеку до входа нет дела. На широком экране вход остаётся десктопным.
  const isGuestAuthScreen = isGuest && narrow && (currentPath === '/login' || isResetPassword);
  const showZen = isZenActive && zenModeEnabled && currentPath === '/';
  // The AI chat manages its own full-height layout; on desktop it must fill the
  // viewport edge-to-edge (only clearing the fixed nav rail) instead of inheriting
  // the padded, scrolling <main> used by the other pages.
  const isChatPageDesktop = currentPath === '/ai' && layoutMode === 'desktop';
  // SA-4: на телефоне экран ИИ = окно минус вкладки; без pt-8/px-4 документ
  // был выше окна на 158 px и прокручивался вместе с шапкой.
  // 0.10.1: и min-h-0 — иначе min-h-screen (100vh) побеждал h-[100dvh], пока видна
  // панель браузера, документ снова был выше окна и шапка уезжала вверх.
  const isChatPageMobile = currentPath === '/ai' && layoutMode !== 'desktop';
  // Владелец 28.10: шапка «Заметок» на телефоне — как у «Профиля», у самого верха,
  // без pt-8 над ней (32 px пустоты над заголовком).
  const isArchivePageMobile = currentPath === '/archive' && layoutMode !== 'desktop';

  return (
    <AppLayout className={cn("min-h-screen bg-surface-base text-text-main font-sans selection:bg-white/10", isChatPageMobile && "h-[100dvh] min-h-0 overflow-hidden")}>
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          const textarea = document.querySelector<HTMLTextAreaElement>('#main-content textarea');
          if (textarea) { textarea.focus(); } else { document.getElementById('main-content')?.focus(); }
        }}
        className="sr-only focus:not-sr-only focus:min-h-11 focus:fixed focus:top-4 focus:left-4 focus:z-[var(--z-skip)] focus:px-4 focus:py-2 focus:bg-surface-card focus:text-text-main focus:rounded-xl focus:border focus:border-border-subtle"
      >
        {t('skip_to_content')}
      </a>
      <ThemeBackground silenceMode={silenceMode} />

      {/* Мастер приглашения и сброс пароля — без навигации: до конца шагов
          приложения для человека ещё нет, а боковая панель сжимала экран. */}
      {!isResetPassword && !isGuestAuthScreen && (
        <>
          {layoutMode === 'desktop' ? (
            <Sidebar isAdmin={isAdmin} onOpenSettings={openSettings} />
          ) : (
            // MB-2: в мобильном макете дзен не прячет нижнюю панель — на телефоне
            // это единственный путь к другим вкладкам.
            <BottomNav />
          )}
          <ConnectionStatusBanner showZen={showZen} />
        </>
      )}

      <main id="main-content" tabIndex={-1} className={cn(
        "w-full relative z-10",
        isResetPassword ? "min-h-screen" : isChatPageDesktop
          ? "h-screen overflow-hidden pl-16"
          : isChatPageMobile
          // Баннер сети/сейфа стоит в потоке над main (MB-8): main забирает
          // остаток окна, а не целые 100dvh.
          // Две обёртки ErrorBoundary (div) между main и экраном тоже тянутся
          // на всю высоту, иначе h-full экрана ИИ = высоте содержимого.
          ? "flex-1 min-h-0 overflow-hidden pb-safe-nav [&>div]:h-full [&>div>div]:h-full"
          : isGuestAuthScreen
          // SA-20: страницы входа считают отступы сами; pt-8 плюс pl-20 сверху
          // и панель снизу сдвигали «Забыли пароль?» за нижний край 360×640.
          ? "min-h-screen"
          : cn(
              "min-h-screen pt-8",
              isArchivePageMobile && "pt-[env(safe-area-inset-top,0px)]",
              layoutMode === 'desktop' && "pl-20 pr-4",
              // MB-2: панель остаётся видимой и в дзене, поэтому отступ под неё
              // не уменьшается. MB-7: плюс 32 px под чип «Активность» — он висит
              // над панелью всегда (не только при ошибке), и без этого закрывал
              // последнюю строку списка, счётчик квоты в чате и «Выйти» в
              // настройках. Компенсируется отступом, а не переносом чипа внутрь:
              // панель уже забита вкладками, а на 320 px с пятой вкладкой
              // (F-7) теснота там — предмет отдельной правки.
              layoutMode !== 'desktop' && "pb-safe-nav px-4"
            )
      )}>
        <AppRoutes />
      </main>

      {/* [U-03] спейсер h-28 убран: отступ main компенсирует высоту BottomNav (MB-7 — вместе с чипом) */}
      <LoginModalOverlay open={loginModalOpen} />
      {!isResetPassword && !queued && <RecoveryCodeGate />}
      {!queued && (
        // Ревью приёмки 0.10.0: ленивый кусок на каждом старте — отказ его загрузки
        // гасит только мост миграции, а не всё приложение.
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <GuestMigrationGate />
          </Suspense>
        </ErrorBoundary>
      )}
      <ConfirmDialogRenderer />
      <ActivityLogBadge />
      {encryptionMode !== 'none' && user && !isResetPassword && !queued && (
        <Suspense fallback={null}>
          <EncryptionPasswordModal
            mode={encryptionMode}
            userId={user.uid}
            onDone={() => void recheckEncryption()}
            onClose={dismissEncryption}
          />
        </Suspense>
      )}
      {/* BR-3: окно восстановления из облака и окно «данные другого пользователя»
          живут в одном ленивом узле; развязка по `queued` — там же. */}
      <ErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <FirstEntryModals />
        </Suspense>
      </ErrorBoundary>
    </AppLayout>
  );
}
