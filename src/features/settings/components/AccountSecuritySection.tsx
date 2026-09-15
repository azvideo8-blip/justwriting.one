import React, { useState, useRef, useEffect } from 'react';
import { Lock } from 'lucide-react';
import { EncryptionService } from '../../../core/services/EncryptionService';
import { AuthService } from '../../../app/AuthService';
import { useLanguage } from '../../../shared/i18n';
import { reportError } from '../../../shared/errors/reportError';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { Section } from './SettingsHelpers';
import { AccountVaultSection } from './AccountVaultSection';
import { AccountAISection } from './AccountAISection';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/Input';

interface AccountSecuritySectionProps {
  userId: string;
}

export function AccountSecuritySection({ userId }: AccountSecuritySectionProps) {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuthStatus();

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const changePasswordRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
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
      // Коды Supabase: до переезда здесь ждали auth/* от Firebase — любая
      // ошибка обновления пароля показывалась как общая.
      const e = (err ?? {}) as { code?: string; status?: number };
      let msg = t('auth_error_generic');
      if (e.code === 'invalid_credentials') {
        msg = t('auth_error_wrong_password');
      } else if (e.code === 'weak_password') {
        msg = t('auth_error_weak_password');
      } else if (e.status === 429 || e.code === 'over_request_rate_limit' || e.code === 'too_many_requests') {
        msg = t('auth_error_rate_limited');
      }
      setPasswordError(msg);
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <Section>

      {isAuthenticated ? (
        <div className="space-y-4">
          {/* Change Account Password */}
          <div className="p-4 rounded-xl border border-border-subtle space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-medium text-text-main flex items-center gap-2">
                  <Lock size={16} className="text-text-main/60" />
                  {t('settings_change_password')}
                </div>
                <div className="text-xs text-text-main/60">
                  {AuthService.getCurrentUser()?.email}
                </div>
              </div>
              {!showChangePassword && (
                <Button
                  onClick={() => setShowChangePassword(true)}
                  className="py-1.5 px-3 rounded-lg border border-border-subtle text-xs text-text-main/70 hover:text-text-main transition-colors"
                >
                  {t('settings_change_password')}
                </Button>
              )}
            </div>

            {showChangePassword && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleChangePassword();
                }}
                ref={changePasswordRef}
                className="space-y-3 pt-2 border-t border-border-subtle"
              >
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={AuthService.getCurrentUser()?.email || ''}
                  readOnly
                  className="hidden"
                />
                {passwordError && (
                  <div className="p-3 rounded-lg text-xs bg-accent-danger/10 border border-accent-danger/30 text-accent-danger">{passwordError}</div>
                )}
                {passwordSuccess && (
                  <div className="p-3 rounded-lg text-xs bg-accent-success/10 border border-accent-success/30 text-accent-success">{t('settings_password_changed')}</div>
                )}
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t('settings_current_password')}
                  className="px-4 py-2.5 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/40"
                />
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('settings_new_password')}
                  className="px-4 py-2.5 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/40"
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={passwordLoading}
                    className="flex-1 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors bg-brand-primary"
                  >
                    {passwordLoading ? <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white mx-auto" /> : t('settings_change_password')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => { setShowChangePassword(false); setPasswordError(null); setPasswordSuccess(false); }}
                    className="px-4 py-2 rounded-xl text-sm text-text-main/60 hover:text-text-main transition-colors"
                  >
                    {t('writing_cancel')}
                  </Button>
                </div>
              </form>
            )}
          </div>

          {/* End-to-End Encryption Vault */}
          <AccountVaultSection userId={userId} />

          {/* AI Privacy & Consent */}
          <AccountAISection userId={userId} />
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-dashed border-border-subtle">
          <p className="text-xs text-text-main/60">
            {t('settings_guest_security_hint')}
          </p>
        </div>
      )}
    </Section>
  );
}
