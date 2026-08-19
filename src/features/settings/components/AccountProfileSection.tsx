import { useState } from 'react';
import { HardDrive, LogIn, User as UserIcon, LogOut } from 'lucide-react';
import { AuthService } from '../../../app/AuthService';
import { useLanguage } from '../../../shared/i18n';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLoginModal } from '../../../app/useLoginModal';
import { resetAndClear } from '../../writing/store/storeActions';
import { useToast } from '../../../shared/components/Toast';
import { Section } from './SettingsHelpers';
import { Button } from '../../../shared/components/Button';

interface AccountProfileSectionProps {
  userId: string;
}

export function AccountProfileSection({ userId: _userId }: AccountProfileSectionProps) {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const { showToast } = useToast();

  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [unsynced, setUnsynced] = useState<{ localOnly: number; pending: number; drafts: number; total: number } | null>(null);

  if (isAuthenticated) {
    const user = AuthService.getCurrentUser();
    const displayName = user?.displayName || user?.email?.split('@')[0] || t('common_untitled');

    return (
      <Section title={t('me_tab_account')}>
        <p className="text-xs text-text-muted -mt-1 mb-3">
          {t('settings_account_desc')}
        </p>
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
            {showSignOutConfirm ? (
              <div className="space-y-3">
                <p className="text-xs text-text-main/70 leading-relaxed">
                  {t('signout_wipes_local')}
                </p>
                {unsynced && (
                  <p className="text-xs text-accent-danger leading-relaxed">
                    Не всё в облаке. На устройстве останется без копии: заметок — {unsynced.localOnly},
                    несохранённых правок — {unsynced.pending}, черновиков — {unsynced.drafts}.
                    Их восстановить будет неоткуда. Сначала выгрузите или экспортируйте их в секции «Резервная копия».
                    Если всё равно выходить, нажмите «Да, выйти» ещё раз: локальные данные будут удалены.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      void (async () => {
                        try {
                          await AuthService.signOut({ force: unsynced !== null });
                          setShowSignOutConfirm(false);
                          resetAndClear();
                        } catch (e) {
                          const data = (e as { name?: string; data?: typeof unsynced }).data;
                          if ((e as { name?: string }).name === 'UnsyncedLocalDataError' && data) {
                            setUnsynced(data);
                            return;
                          }
                          showToast(t('error_signout_failed'), 'error');
                        }
                      })();
                    }}
                    className="flex-1 px-4 py-2 rounded-xl border border-accent-danger/40 text-xs font-bold text-accent-danger hover:bg-accent-danger/10 transition-colors"
                  >
                    {t('writing_cancel_confirm') || 'Да, выйти'}
                  </Button>
                  <Button
                    onClick={() => { setShowSignOutConfirm(false); setUnsynced(null); }}
                    className="px-4 py-2 rounded-xl border border-border-subtle text-xs text-text-main/60 hover:text-text-main transition-colors"
                  >
                    {t('common_cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={() => setShowSignOutConfirm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border-subtle text-xs text-text-main/70 hover:text-accent-danger hover:border-accent-danger/30 transition-colors"
              >
                <LogOut size={14} />
                {t('me_sign_out')}
              </Button>
            )}
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section title={t('me_tab_account')}>
      <p className="text-xs text-text-muted -mt-1 mb-3">
        {t('settings_account_desc')}
      </p>
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
