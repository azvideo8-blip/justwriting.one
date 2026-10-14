import React, { useContext, useEffect, Suspense } from 'react';
import { EarlierQuestionOpenContext } from './onboardingQueue';
import { useLocation } from 'react-router-dom';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useWritingSettings } from '../core/settings/WritingSettingsContext';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';
import { useLanguage } from '../shared/i18n';
import { cn } from '../core/utils/utils';
import { useLoginModal } from '../features/auth/contexts/LoginModalContext';
import { useSyncStatus } from '../core/sync/useSyncStatus';
import { useToast } from '../shared/components/Toast';
import { VAULT_PASSWORD_CONVERGED_EVENT } from '../core/services/EncryptionService';
import { takeAccountChangeNotice } from '../core/auth/accountReload';
import { offerLostSessionWipe } from '../features/auth/services/lostSessionWipe';

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

import { AppRoutes } from './AppRoutes';
import { ConfirmDialogRenderer, useConfirmDialog } from '../shared/components/ConfirmDialog';
import { useAdminStatus } from '../features/auth/hooks/useAdminStatus';
import { useEmptyDeviceDetection } from '../core/sync/useEmptyDeviceDetection';
const RestoreFromCloudModal = React.lazy(() =>
  import('./modals/RestoreFromCloudModal').then(m => ({ default: m.RestoreFromCloudModal })),
);
import { useOtherUserDetection } from '../features/auth/hooks/useOtherUserDetection';
import { OtherUserDataModal } from '../features/auth/components/OtherUserDataModal';
import { GuestMigrationGate } from '../features/auth/components/GuestMigrationGate';

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
  const { loginModalOpen } = useLoginModal();
  const { openSettings } = useSettings();
  const { mode: encryptionMode, check: recheckEncryption, dismiss: dismissEncryption } = useEncryptionSetup();
  const { shouldPrompt: shouldPromptEmptyDevice, localCount, cloudCount, dismiss: dismissEmptyDevice } = useEmptyDeviceDetection();
  const { hasOtherData, dismiss: dismissOtherData, clear: clearOtherData } = useOtherUserDetection();
  // Окна первого входа — по одному: пока открыт вопрос политики или синхронизации,
  // остальные ждут (onboardingQueue.ts).
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

  // Выход перезагружает страницу — сообщение о нём показывает уже новая.
  useEffect(() => {
    const notice = takeAccountChangeNotice();
    if (notice === 'signed_out') showToast(t('settings_sign_out_notice'), 'success');
    else if (notice === 'signed_out_wiped') showToast(t('settings_sign_out_notice_wiped'), 'success');
    else if (notice === 'wipe_failed') showToast(t('settings_sign_out_notice_wipe_failed'), 'error');
    else if (notice === 'account_deleted') showToast(t('settings_delete_account_success'), 'success');
    else if (notice === 'account_deleted_wipe_failed') showToast(t('settings_delete_account_wipe_failed'), 'error');
    else if (notice === 'lost_session') void offerLostSessionWipe(showToast, t, confirmDialog);
  }, [showToast, t, confirmDialog]);

  const currentPath = location.pathname;
  const showZen = isZenActive && zenModeEnabled && currentPath === '/';
  // The AI chat manages its own full-height layout; on desktop it must fill the
  // viewport edge-to-edge (only clearing the fixed nav rail) instead of inheriting
  // the padded, scrolling <main> used by the other pages.
  const isChatPageDesktop = currentPath === '/ai' && layoutMode === 'desktop';

  return (
    <AppLayout className="min-h-screen bg-surface-base text-text-main font-sans selection:bg-white/10">
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
      {!isResetPassword && (
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
          : cn(
              "min-h-screen pt-8",
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
      {!queued && <GuestMigrationGate />}
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
      {shouldPromptEmptyDevice && user && !queued && (
        <Suspense fallback={null}>
          <RestoreFromCloudModal
            open={shouldPromptEmptyDevice}
            onClose={dismissEmptyDevice}
            initialLocalCount={localCount}
            initialCloudCount={cloudCount}
            onRestoreAIData={(uid) =>
              import('../features/ai/services/AIRestoreService').then(m => m.restoreAndReattachAIData(uid))
            }
          />
        </Suspense>
      )}
      {hasOtherData && user && !shouldPromptEmptyDevice && !queued && (
        <OtherUserDataModal
          open={hasOtherData}
          onClose={dismissOtherData}
          onClear={clearOtherData}
        />
      )}
    </AppLayout>
  );
}
