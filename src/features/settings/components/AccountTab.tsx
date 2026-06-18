import React, { useState } from 'react';
import { Lock, ChevronDown, ChevronRight } from 'lucide-react';
import { EncryptionService } from '../../../core/services/EncryptionService';
import { AuthService } from '../../auth/services/AuthService';
import { useLanguage } from '../../../shared/i18n';
import { reportError } from '../../../shared/errors/reportError';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useTimerStore } from '../../writing/store/useTimerStore';
import { resetAndClear } from '../../writing/store/storeActions';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { Section } from './SettingsHelpers';
import { AccountProfileSection } from './AccountProfileSection';
import { AccountVaultSection } from './AccountVaultSection';
import { AccountExportSection } from './AccountExportSection';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/Input';

interface AccountTabProps {
  userId: string;
}

export function AccountTab({ userId }: AccountTabProps) {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuthStatus();
  const { execute } = useServiceAction();

  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [isSecurityExpanded, setIsSecurityExpanded] = useState(false);

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

      {isAuthenticated ? (
        <>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setIsSecurityExpanded(!isSecurityExpanded)}
              className="w-full flex items-center justify-between font-bold text-label-sm uppercase tracking-widest text-text-main/40 px-1 py-1 hover:text-text-main/60 transition-colors"
            >
              <span>{t('settings_security')}</span>
              {isSecurityExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {isSecurityExpanded && (
              <div className="space-y-4 pt-1">
                <Section title={t('settings_change_password')}>
                  <div
                    hidden={showChangePassword ? true : undefined}
                    style={showChangePassword ? { display: 'none' } : undefined}
                  >
                    <Button
                      onClick={() => setShowChangePassword(true)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors text-left"
                    >
                      <Lock size={16} className="text-text-main/40" />
                      {t('settings_change_password')}
                    </Button>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleChangePassword();
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
                      className="hidden hidden"
                    />
                    {passwordError && (
                      <div className="p-3 rounded-lg text-xs bg-accent-danger/10 border border-accent-danger/30 text-accent-danger">{passwordError}</div>
                    )}
                    {passwordSuccess && (
                      <div className="p-3 rounded-lg text-xs bg-green-500/10 border border-green-500/30 text-green-400">{t('settings_password_changed')}</div>
                    )}
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder={t('settings_current_password')}
                      className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
                    />
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={t('settings_new_password')}
                      className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        disabled={passwordLoading}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors bg-brand-primary"
                      >
                        {passwordLoading ? <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white mx-auto" /> : t('settings_change_password')}
                      </Button>
                      <Button
                        onClick={() => { setShowChangePassword(false); setPasswordError(null); setPasswordSuccess(false); }}
                        className="px-4 py-2.5 rounded-xl text-sm text-text-main/40 hover:text-text-main/60 transition-colors"
                      >
                        {t('writing_cancel')}
                      </Button>
                    </div>
                  </form>
                </Section>

                <AccountVaultSection userId={userId} />
              </div>
            )}
          </div>

          <AccountExportSection userId={userId} />

          {showSignOutConfirm ? (
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setShowSignOutConfirm(false);
                  resetAndClear();
                  void execute(
                    () => AuthService.signOut(),
                    { errorMessage: t('error_signout_failed') }
                  );
                }}
                className="flex-1 px-4 py-3 rounded-xl border border-accent-danger/40 text-sm text-accent-danger hover:bg-accent-danger/10 transition-colors text-left"
              >
                {t('writing_cancel_confirm') || 'Да, выйти'}
              </Button>
              <Button
                onClick={() => setShowSignOutConfirm(false)}
                className="px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors"
              >
                {t('cancel') || 'Отмена'}
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => {
                const s = useTimerStore.getState();
                if (s.status === 'writing' || s.status === 'paused') {
                  setShowSignOutConfirm(true);
                  return;
                }
                void execute(
                  () => AuthService.signOut(),
                  { errorMessage: t('error_signout_failed') }
                );
              }}
              className="w-full px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-accent-danger hover:border-accent-danger/30 transition-colors text-left"
            >
              {t('me_sign_out')}
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}
