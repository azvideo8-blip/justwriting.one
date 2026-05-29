import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { EncryptionService } from '../../../core/crypto/EncryptionService';
import { AuthService } from '../../auth/services/AuthService';
import { useLanguage } from '../../../core/i18n';
import { reportError } from '../../../core/errors/reportError';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useTimerStore } from '../../writing/store/useTimerStore';
import { resetAndClear } from '../../writing/store/storeActions';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { Section, ToggleRow } from './SettingsHelpers';
import { AccountProfileSection } from './AccountProfileSection';
import { AccountVaultSection } from './AccountVaultSection';
import { AccountExportSection } from './AccountExportSection';
import { AccountDangerSection } from './AccountDangerSection';

interface AccountTabProps {
  userId: string;
}

export function AccountTab({ userId }: AccountTabProps) {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuthStatus();
  const { execute } = useServiceAction();

  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(() => localStorage.getItem('diagnostics_unlocked') === 'true');

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const changePasswordRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    const el = changePasswordRef.current;
    const handleBeforeMatch = () => setShowChangePassword(true);
    el?.addEventListener('beforematch', handleBeforeMatch);
    return () => { el?.removeEventListener('beforematch', handleBeforeMatch); };
  }, []);

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      setPasswordError(t('auth_error_weak_password'));
      return;
    }
    setPasswordLoading(true);
    setPasswordError(null);
    setPasswordSuccess(false);
    try {
      await EncryptionService.changePassword(userId, currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: unknown) {
      reportError(err, { action: 'changePassword', userId });
      const firebaseError = err as { code?: string; message?: string };
      let msg = t('auth_error_generic');
      if (firebaseError.code === 'auth/wrong-password' || firebaseError.code === 'auth/invalid-credential') {
        msg = t('auth_error_wrong_password');
      }
      if (firebaseError.code === 'auth/weak-password') msg = t('auth_error_weak_password');
      setPasswordError(msg);
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="space-y-4 mt-2">
      <AccountProfileSection userId={userId} />

      <ToggleRow
        emoji="🔧"
        label="Диагностика"
        hint={diagnosticsEnabled ? 'Отображается в боковом меню' : 'Включить страницу диагностики'}
        value={diagnosticsEnabled}
        onChange={() => {
          const next = !diagnosticsEnabled;
          setDiagnosticsEnabled(next);
          localStorage.setItem('diagnostics_unlocked', String(next));
        }}
      />

      {isAuthenticated ? (
        <>
          {showSignOutConfirm ? (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowSignOutConfirm(false);
                  resetAndClear();
                  execute(
                    () => AuthService.signOut(),
                    { errorMessage: t('error_signout_failed') }
                  );
                }}
                className="flex-1 px-4 py-3 rounded-xl border border-red-400/40 text-sm text-red-400 hover:bg-red-400/10 transition-colors text-left"
              >
                {t('writing_cancel_confirm') || 'Да, выйти'}
              </button>
              <button
                onClick={() => setShowSignOutConfirm(false)}
                className="px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors"
              >
                {t('cancel') || 'Отмена'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                const s = useTimerStore.getState();
                if (s.status === 'writing' || s.status === 'paused') {
                  setShowSignOutConfirm(true);
                  return;
                }
                execute(
                  () => AuthService.signOut(),
                  { errorMessage: t('error_signout_failed') }
                );
              }}
              className="w-full px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-red-400 hover:border-red-400/30 transition-colors text-left"
            >
              {t('me_sign_out')}
            </button>
          )}

          <Section title={t('settings_change_password')}>
            <div
              hidden={showChangePassword ? true : undefined}
              style={showChangePassword ? { display: 'none' } : undefined}
            >
              <button
                onClick={() => setShowChangePassword(true)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors text-left"
              >
                <Lock size={16} className="text-text-main/40" />
                {t('settings_change_password')}
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleChangePassword();
              }}
              ref={changePasswordRef}
              hidden={!showChangePassword || undefined}
              style={!showChangePassword ? { contentVisibility: 'hidden' } : undefined}
              className="space-y-3 p-4 rounded-xl border border-border-subtle"
            >
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={AuthService.getCurrentUser()?.email || ''}
                readOnly
                className="hidden"
                style={{ display: 'none' }}
              />
              {passwordError && (
                <div className="p-3 rounded-lg text-xs bg-red-500/10 border border-red-500/30 text-red-400">{passwordError}</div>
              )}
              {passwordSuccess && (
                <div className="p-3 rounded-lg text-xs bg-green-500/10 border border-green-500/30 text-green-400">{t('settings_password_changed')}</div>
              )}
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t('settings_current_password')}
                className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
              />
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('settings_new_password')}
                className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors bg-brand-primary"
                >
                  {passwordLoading ? <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white mx-auto" /> : t('settings_change_password')}
                </button>
                <button
                  onClick={() => { setShowChangePassword(false); setPasswordError(null); setPasswordSuccess(false); }}
                  className="px-4 py-2.5 rounded-xl text-sm text-text-main/40 hover:text-text-main/60 transition-colors"
                >
                  {t('writing_cancel')}
                </button>
              </div>
            </form>
          </Section>

          <AccountVaultSection userId={userId} />

          <AccountExportSection userId={userId} />
        </>
      ) : null}

      <AccountDangerSection userId={userId} />
    </div>
  );
}
