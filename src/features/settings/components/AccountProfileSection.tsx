import React from 'react';
import { HardDrive, LogIn, User as UserIcon } from 'lucide-react';
import { AuthService } from '../../auth/services/AuthService';
import { useLanguage } from '../../../shared/i18n';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';
import { Section } from './SettingsHelpers';
import { Button } from '../../../shared/components/Button';

interface AccountProfileSectionProps {
  userId: string;
}

export function AccountProfileSection({ userId: _userId }: AccountProfileSectionProps) {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuthStatus();
  const { openLoginModal } = useLoginModal();

  if (isAuthenticated) {
    return (
      <Section title={t('me_tab_account')}>
        <div className="flex items-center gap-4 p-4 rounded-xl border border-border-subtle">
          {AuthService.getCurrentUser()?.photoURL ? (
            <img
              src={AuthService.getCurrentUser()!.photoURL!}
              alt=""
              className="w-12 h-12 rounded-full object-cover border border-border-subtle"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10 border border-border-subtle">
              <UserIcon size={24} className="text-text-main/60" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-main truncate">
              {AuthService.getCurrentUser()?.displayName || AuthService.getCurrentUser()?.email?.split('@')[0] || t('common_untitled')}
            </div>
            <div className="text-xs text-text-main/60 truncate">
              {AuthService.getCurrentUser()?.email}
            </div>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <>
      <Section title={t('me_tab_account')}>
        <div className="flex items-center gap-4 p-4 rounded-xl border border-dashed border-border-subtle">
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10">
            <HardDrive size={24} className="text-text-main/60" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-main/60">
              {t('guest_saved_locally')}
            </div>
            <div className="text-xs text-text-main/60 mt-0.5">
              {t('guest_sync_hint')}
            </div>
          </div>
        </div>
      </Section>
      <Button
        onClick={openLoginModal}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-text-main bg-text-main text-surface-base text-sm font-bold hover:opacity-90 transition-colors"
      >
        <LogIn size={16} />
        {t('auth_sign_in')}
      </Button>
    </>
  );
}
