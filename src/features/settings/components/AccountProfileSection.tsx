import { useState } from 'react';
import { HardDrive, LogIn, User as UserIcon, LogOut } from 'lucide-react';
import { AuthService } from '../../../app/AuthService';
import { useLanguage } from '../../../shared/i18n';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLoginModal } from '../../../app/useLoginModal';
import { Section } from './SettingsHelpers';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { LanguageSwitch } from '../../../shared/components/LanguageSwitch';
import { Button } from '../../../shared/components/Button';
import { SignOutConfirmModal } from '../../auth/components/SignOutConfirmModal';
import { useConfirmSignOut } from '../hooks/useConfirmSignOut';

interface AccountProfileSectionProps {
  userId: string;
}

export function AccountProfileSection({ userId: _userId }: AccountProfileSectionProps) {
  const { t } = useLanguage();
  const { layoutMode } = useLayoutMode();
  const { isAuthenticated } = useAuthStatus();
  const { openLoginModal } = useLoginModal();

  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const handleConfirmSignOut = useConfirmSignOut();

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

          {/* MR-5: язык переехал в «Профиль → Настройки»: шестерёнка профиля
              открывает настройки приложения, и язык должен быть там же. Только
              в мобильном макете: на десктопе язык остаётся в «Редакторе», второй
              переключатель на /settings — изменение десктопа (ревью 0.9.39). */}
          {layoutMode === 'mobile' && <div className="pt-2 border-t border-border-subtle">
            {/* U-28 (решение владельца 2026-10-18): язык на телефоне — общий
                контрол на токенах; раньше был `bg-white/[0.04]` и
                `bg-white/[0.08]`, в тёплой теме «notion» он был не виден. */}
            <div className="py-3.5">
              <div className="text-sm text-text-main/80">{t('settings_language')}</div>
              <div className="mt-2">
                <LanguageSwitch />
              </div>
            </div>
          </div>}

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
