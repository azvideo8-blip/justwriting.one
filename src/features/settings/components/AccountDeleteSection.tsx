import { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { AuthService } from '../../../app/AuthService';
import { ProfileService } from '../../../core/services/ProfileService';
import { emitDomainEvent } from '../../../core/events/domainEvents';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { reportError } from '../../../shared/errors/reportError';
import { Button } from '../../../shared/components/Button';

interface AccountDeleteSectionProps {
  userId: string;
}

export function AccountDeleteSection({ userId }: AccountDeleteSectionProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();
  const { isAuthenticated } = useAuthStatus();

  const [deleting, setDeleting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resettingAchievements, setResettingAchievements] = useState(false);
  // AUD-20: удаление требует пароль снова — подтверждения кликом мало.
  const [askingPassword, setAskingPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState(false);

  if (!isAuthenticated) {
    return null;
  }

  const handleDeleteAccount = async () => {
    const ok = await confirmDialog({
      title: t('settings_delete_account_confirm_title'),
      message: t('settings_delete_account_confirm_message'),
    });
    if (!ok) return;
    setAuthError(false);
    setPassword('');
    setAskingPassword(true);
  };

  const handleConfirmPassword = async () => {
    setDeleting(true);
    setAuthError(false);
    try {
      // Выход после удаления перезагружает страницу на /login; «Аккаунт
      // удалён» показывает уже она.
      await AuthService.deleteAccount(password);
      emitDomainEvent({ type: 'account.reset', userId });
    } catch (err) {
      reportError(err, { action: 'deleteAccount', userId });
      if (err instanceof Error && err.message === 'REAUTH_FAILED') {
        setAuthError(true);
        setDeleting(false);
        return;
      }
      showToast(t('settings_delete_account_error'), 'error');
      setAskingPassword(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleResetAchievements = async () => {
    setResettingAchievements(true);
    try {
      await ProfileService.resetAchievements(userId);
      localStorage.removeItem(`unlocked_achievements_${userId}`);
      window.dispatchEvent(new Event('achievements-reset'));
      showToast(t('save_success'), 'success');
      setConfirmReset(false);
    } catch (err) {
      reportError(err, { action: 'resetAchievements', userId });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setResettingAchievements(false);
    }
  };

  return (
    <div className="pt-4 border-t-2 border-accent-danger/20">
      <div className="p-5 rounded-2xl border border-accent-danger/30 bg-accent-danger/[0.03] space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-accent-danger/10 border border-accent-danger/20 flex items-center justify-center text-accent-danger shrink-0 mt-0.5">
            <AlertTriangle size={18} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-accent-danger uppercase tracking-wider">
              {t('settings_delete_account_title')}
            </h3>
            <p className="text-xs text-text-main/70 leading-relaxed">
              {t('settings_delete_account_desc')}
            </p>
          </div>
        </div>

        {askingPassword ? (
          <form
            className="space-y-2 pt-2"
            onSubmit={(e) => { e.preventDefault(); if (password && !deleting) void handleConfirmPassword(); }}
          >
            <p className="text-xs text-text-main/70">
              {t('settings_delete_account_password_prompt')}
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={deleting}
              autoFocus
              className="w-full px-3 py-2 rounded-xl border border-border-subtle bg-transparent text-sm text-text-main focus:border-accent-danger/50 outline-none"
              placeholder={t('settings_delete_account_password_placeholder')}
            />
            {authError && (
              <p className="text-xs text-accent-danger">{t('settings_delete_account_wrong_password')}</p>
            )}
          </form>
        ) : (
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button
            onClick={() => void handleDeleteAccount()}
            disabled={deleting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-accent-danger/40 bg-accent-danger/10 text-accent-danger hover:bg-accent-danger/20 text-xs font-bold transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} />
            {deleting ? t('settings_delete_account_progress') : t('settings_delete_account_button')}
          </Button>

          {!confirmReset ? (
            <Button
              onClick={() => setConfirmReset(true)}
              className="px-4 py-3 rounded-xl border border-border-subtle text-xs text-text-main/60 hover:text-accent-danger hover:border-accent-danger/30 transition-colors text-center"
            >
              {t('profile_reset_achievements')}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => void handleResetAchievements()}
                disabled={resettingAchievements}
                className="px-3 py-2 rounded-xl text-xs font-bold text-accent-danger border border-accent-danger/40 bg-accent-danger/10 hover:bg-accent-danger/20 transition-colors"
              >
                {t('finish_discard')}
              </Button>
              <Button
                onClick={() => setConfirmReset(false)}
                className="px-3 py-2 rounded-xl text-xs text-text-main/60 hover:text-text-main transition-colors"
              >
                {t('writing_cancel')}
              </Button>
            </div>
          )}
        </div>
        )}
        {askingPassword && (
          <div className="flex gap-2">
            <Button
              onClick={() => void handleConfirmPassword()}
              disabled={deleting || !password}
              className="px-4 py-3 rounded-xl border border-accent-danger/40 bg-accent-danger/10 text-accent-danger hover:bg-accent-danger/20 text-xs font-bold transition-colors disabled:opacity-50"
            >
              {deleting ? t('settings_delete_account_progress') : t('settings_delete_account_confirm_button')}
            </Button>
            <Button
              onClick={() => { setAskingPassword(false); setPassword(''); }}
              className="px-4 py-3 rounded-xl border border-border-subtle text-xs text-text-main/60 hover:text-text-main transition-colors"
            >
              {t('writing_cancel')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
