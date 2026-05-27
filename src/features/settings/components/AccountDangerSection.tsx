import React, { useState } from 'react';
import { useLanguage } from '../../../core/i18n';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { ProfileService } from '../../profile/services/ProfileService';
import { Section } from './SettingsHelpers';

interface AccountDangerSectionProps {
  userId: string;
}

export function AccountDangerSection({ userId }: AccountDangerSectionProps) {
  const { t } = useLanguage();
  const { execute } = useServiceAction();
  const [confirmReset, setConfirmReset] = useState(false);

  const resetConfirmRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = resetConfirmRef.current;
    const handleBeforeMatch = () => setConfirmReset(true);
    el?.addEventListener('beforematch', handleBeforeMatch);
    return () => { el?.removeEventListener('beforematch', handleBeforeMatch); };
  }, []);

  return (
    <Section title={t('settings_danger_zone')}>
      <div
        hidden={confirmReset ? true : undefined}
        style={confirmReset ? { display: 'none' } : undefined}
      >
        <button
          onClick={() => setConfirmReset(true)}
          className="w-full px-4 py-3 rounded-xl border border-red-400/25 text-sm text-red-400/70 hover:text-red-400 hover:border-red-400/40 transition-colors text-left"
        >
          {t('profile_reset_achievements')}
        </button>
      </div>
      <div
        ref={resetConfirmRef}
        hidden={!confirmReset || undefined}
        style={!confirmReset ? { contentVisibility: 'hidden' } : undefined}
        className="flex flex-col gap-3 p-4 rounded-xl border border-red-400/20 bg-red-400/5"
      >
        <span className="text-sm text-text-main/70">{t('reset_achievements_confirm')}</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => execute(
              async () => {
                await ProfileService.resetAchievements(userId);
                localStorage.removeItem(`unlocked_achievements_${userId}`);
                window.dispatchEvent(new Event('achievements-reset'));
              },
              { successMessage: t('save_success'), errorMessage: t('error_generic_action'), onSuccess: () => setConfirmReset(false) }
            )}
            className="px-4 py-2 rounded-xl text-sm font-bold text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-colors"
          >
            {t('finish_discard')}
          </button>
          <button onClick={() => setConfirmReset(false)} className="text-sm text-text-main/40 hover:text-text-main/60 transition-colors">
            {t('writing_cancel')}
          </button>
        </div>
      </div>
    </Section>
  );
}
