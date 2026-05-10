import React, { useState } from 'react';
import { HardDrive, LogIn, User as UserIcon } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { useWritingStore } from '../../writing/store/useWritingStore';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';
import { ProfileService } from '../../profile/services/ProfileService';
import { Section } from './SettingsHelpers';

interface AccountTabProps {
  userId: string;
}

export function AccountTab({ userId }: AccountTabProps) {
  const { t } = useLanguage();
  const [confirmReset, setConfirmReset] = useState(false);
  const { isAuthenticated } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const { execute } = useServiceAction();

  return (
    <div className="space-y-4 mt-2">
      {isAuthenticated ? (
        <Section title={t('me_tab_account')}>
          <div className="flex items-center gap-4 p-4 rounded-xl border border-border-subtle">
            {auth.currentUser?.photoURL ? (
              <img
                src={auth.currentUser.photoURL}
                alt=""
                className="w-12 h-12 rounded-full object-cover border border-border-subtle"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10 border border-border-subtle">
                <UserIcon size={24} className="text-text-main/40" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-main truncate">
                {auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || t('common_untitled')}
              </div>
              <div className="text-xs text-text-main/40 truncate">
                {auth.currentUser?.email}
              </div>
            </div>
          </div>
        </Section>
      ) : (
        <Section title={t('me_tab_account')}>
          <div className="flex items-center gap-4 p-4 rounded-xl border border-dashed border-border-subtle">
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10">
              <HardDrive size={24} className="text-text-main/40" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-main/60">
                {t('guest_saved_locally')}
              </div>
              <div className="text-xs text-text-main/30 mt-0.5">
                {t('guest_sync_hint')}
              </div>
            </div>
          </div>
        </Section>
      )}

      {isAuthenticated ? (
        <button
          onClick={() => {
            const s = useWritingStore.getState();
            if (s.status === 'writing' || s.status === 'paused') {
              if (!window.confirm(t('writing_cancel_confirm'))) return;
              useWritingStore.getState().resetAndClear();
            }
            execute(
              () => signOut(auth),
              { errorMessage: t('error_signout_failed') }
            );
          }}
          className="w-full px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-red-400 hover:border-red-400/30 transition-all text-left"
        >
          {t('me_sign_out')}
        </button>
      ) : (
        <button
          onClick={openLoginModal}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-text-main bg-text-main text-surface-base text-sm font-bold hover:opacity-90 transition-all"
        >
          <LogIn size={16} />
          {t('auth_sign_in')}
        </button>
      )}

      <Section title={t('profile_achievements')}>
        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            className="w-full px-4 py-3 rounded-xl border border-red-400/25 text-sm text-red-400/70 hover:text-red-400 hover:border-red-400/40 transition-all text-left"
          >
            {t('profile_reset_achievements')}
          </button>
        ) : (
          <div className="flex flex-col gap-3 p-4 rounded-xl border border-red-400/20 bg-red-400/5">
            <span className="text-sm text-text-main/70">{t('reset_achievements_confirm')}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => execute(
                  () => ProfileService.resetAchievements(userId),
                  { successMessage: t('save_success'), errorMessage: t('error_generic_action'), onSuccess: () => setConfirmReset(false) }
                )}
                className="px-4 py-2 rounded-xl text-sm font-bold text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-all"
              >
                {t('finish_discard')}
              </button>
              <button onClick={() => setConfirmReset(false)} className="text-sm text-text-main/40 hover:text-text-main/60 transition-colors">
                {t('writing_cancel')}
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
