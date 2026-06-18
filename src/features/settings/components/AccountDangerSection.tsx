import React, { useState } from 'react';
import { useLanguage } from '../../../shared/i18n';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { ProfileService } from '../../profile/services/ProfileService';
import { Section } from './SettingsHelpers';
import { Button } from '../../../shared/components/Button';

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
        <Button
          onClick={() => setConfirmReset(true)}
          className="w-full px-4 py-3 rounded-xl border border-accent-danger/25 text-sm text-accent-danger/70 hover:text-accent-danger hover:border-accent-danger/40 transition-colors text-left"
        >
          {t('profile_reset_achievements')}
        </Button>
      </div>
      <div
        ref={resetConfirmRef}
        hidden={!confirmReset || undefined}
        style={!confirmReset ? { contentVisibility: 'hidden' } : undefined}
        className="flex flex-col gap-3 p-4 rounded-xl border border-accent-danger/20 bg-accent-danger/5"
      >
        <span className="text-sm text-text-main/70">{t('reset_achievements_confirm')}</span>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              void execute(
                async () => {
                  await ProfileService.resetAchievements(userId);
                  localStorage.removeItem(`unlocked_achievements_${userId}`);
                  window.dispatchEvent(new Event('achievements-reset'));
                },
                { successMessage: t('save_success'), errorMessage: t('error_generic_action'), onSuccess: () => setConfirmReset(false) }
              );
            }}
            className="px-4 py-2 rounded-xl text-sm font-bold text-accent-danger border border-accent-danger/30 hover:bg-accent-danger/10 transition-colors"
          >
            {t('finish_discard')}
          </Button>
          <Button onClick={() => setConfirmReset(false)} className="text-sm text-text-main/60 hover:text-text-main/60 transition-colors">
            {t('writing_cancel')}
          </Button>
        </div>
      </div>
    </Section>
  );
}
