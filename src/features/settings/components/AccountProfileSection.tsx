import { useState } from 'react';
import { HardDrive, LogIn, User as UserIcon, LogOut } from 'lucide-react';
import { AuthService } from '../../../app/AuthService';
import { useLanguage } from '../../../shared/i18n';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLoginModal } from '../../../app/useLoginModal';
import { emitDomainEvent } from '../../../core/events/domainEvents';
import { useToast } from '../../../shared/components/Toast';
import { Section } from './SettingsHelpers';
import { Button } from '../../../shared/components/Button';
import { SignOutConfirmModal } from '../../auth/components/SignOutConfirmModal';

interface AccountProfileSectionProps {
  userId: string;
}

export function AccountProfileSection({ userId: _userId }: AccountProfileSectionProps) {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const { showToast } = useToast();

  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const handleConfirmSignOut = async (opts: { clearLocalData: boolean; force?: boolean }) => {
    try {
      await AuthService.signOut(opts);
      emitDomainEvent({ type: 'account.reset' });
      showToast(opts.clearLocalData ? 'Вы вышли, локальные данные удалены' : 'Вы вышли из аккаунта', 'success');
    } catch (e) {
      const isUnsynced = (e as { name?: string }).name === 'UnsyncedLocalDataError';
      // AUD-11: очистка локальных данных не удалась — данные остались на машине.
      const isWipeFailed = (e as { name?: string }).name === 'LocalWipeFailedError';
      if (isWipeFailed) {
        showToast('Вы вышли, но очистить локальные данные не удалось. Очистите данные сайта в браузере вручную.', 'error');
      } else if (!isUnsynced) {
        showToast(t('error_signout_failed'), 'error');
      }
      throw e;
    }
  };

  if (isAuthenticated) {
    const user = AuthService.getCurrentUser();
    const displayName = user?.displayName || user?.email?.split('@')[0] || t('common_untitled');

    return (
      <Section>
        <div className="p-4 rounded-xl border border-border-subtle space-y-4">
          <div className="flex items-center gap-4">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                className="w-12 h-12 rounded-full object-cover border border-border-subtle shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10 border border-border-subtle shrink-0">
                <UserIcon size={24} className="text-text-main/60" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-text-main truncate">
                {displayName}
              </div>
              <div className="text-xs text-text-main/60 truncate">
                {user?.email}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-border-subtle">
            <Button
              onClick={() => setShowSignOutConfirm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border-subtle text-xs text-text-main/70 hover:text-accent-danger hover:border-accent-danger/30 transition-colors"
            >
              <LogOut size={14} />
              {t('me_sign_out')}
            </Button>
          </div>

          <SignOutConfirmModal
            open={showSignOutConfirm}
            onClose={() => setShowSignOutConfirm(false)}
            onConfirm={handleConfirmSignOut}
          />
        </div>
      </Section>
    );
  }

  return (
    <Section>
      <div className="p-4 rounded-xl border border-dashed border-border-subtle space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10 shrink-0">
            <HardDrive size={24} className="text-text-main/60" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-main">
              {t('guest_saved_locally')}
            </div>
            <div className="text-xs text-text-main/60 mt-0.5">
              {t('guest_sync_hint')}
            </div>
          </div>
        </div>
        <Button
          onClick={openLoginModal}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-text-main bg-text-main text-surface-base text-sm font-bold hover:opacity-90 transition-colors"
        >
          <LogIn size={16} />
          {t('auth_sign_in')}
        </Button>
      </div>
    </Section>
  );
}
