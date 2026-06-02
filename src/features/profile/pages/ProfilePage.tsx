import { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { AlertCircle, Sparkles } from 'lucide-react';
import { UserProfile } from '../../../types';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { useUserId } from '../../../shared/hooks/useUserId';
import { reportError } from '../../../shared/errors/reportError';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { ProfileHero } from '../components/ProfileHero';
import { KPIStrip } from '../components/KPIStrip';
import { StreakRibbon } from '../components/StreakRibbon';
import { Heatmap } from '../components/Heatmap';
import { HourRhythm } from '../components/HourRhythm';
import { Achievements } from '../components/Achievements';
import { ProfileService } from '../services/ProfileService';
import { useToast } from '../../../shared/components/Toast';
import { useProfileStats } from '../hooks/useProfileStats';
import { Button } from '../../../shared/components/Button';

interface ProfilePageProps {
  user: User | null;
  profile: UserProfile | null;
}

export function ProfilePage({ user, profile }: ProfilePageProps) {
  const { t } = useLanguage();
  const isGuest = !user;
  const userId = useUserId(user);
  const navigate = useNavigate();

  const { sessions, kpiStats, loading, error, refresh } = useProfileStats(userId, user);
  const [achResetKey, setAchResetKey] = useState(0);
  const { showToast: _showToast } = useToast();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showProfileConfirm, setShowProfileConfirm] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  const handleGenerateProfile = async () => {
    setShowProfileConfirm(false);
    setProfileLoading(true);
    try {
      const { AIProfileService } = await import('../../ai/services/AIProfileService');
      await AIProfileService.exportMarkdown();
    } catch (e) {
      reportError(e, { action: 'generateAIProfile' });
      _showToast('Недостаточно данных для портрета (нужно минимум 3 саммари)', 'error');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleResetAchievements = useCallback(() => {
    localStorage.removeItem(`unlocked_achievements_${user?.uid ?? 'guest'}`);
    setAchResetKey(k => k + 1);
    setShowResetConfirm(false);
    if (user) {
      ProfileService.resetAchievements(user.uid).catch(e => {
        reportError(e, { action: 'resetCloudAchievements', userId: user.uid });
      });
    }
  }, [user]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24">
        <motion.div
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
          className="drop-shadow-[0_0_24px_color-mix(in_srgb,var(--brand-soft)_40%,transparent)]"
        >
          <JustWritingLogo size={120} variant="dark" showRailway={true} showRoman={true} showCrown={true} />
        </motion.div>
        <p className="text-sm text-text-main/40 tracking-widest uppercase font-sans">
          {t("profile_loading")}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-12 text-center rounded-2xl border bg-accent-danger/10 border-accent-danger/20">
        <AlertCircle size={24} className="mx-auto mb-3 text-accent-danger/70" /><p className="text-accent-danger text-sm mb-4">{t('profile_load_error')}</p>
          <Button onClick={() => void refresh()} className="px-4 py-2 rounded-xl text-sm font-medium text-accent-danger border border-accent-danger/30 hover:bg-accent-danger/10 transition-colors">
           {t('retry')}
         </Button>
      </div>
    );
  }

  if (!loading && sessions.length === 0) {
    return (
      <div className="min-h-screen bg-surface-base flex flex-col items-center justify-center gap-8 px-6 text-center">
        <ProfileHero user={user} profile={profile} isGuest={isGuest} onStartSession={() => void navigate('/')} />
        <div className="max-w-sm space-y-3">
          <p className="text-[15px] text-text-main/50 leading-relaxed">
            {t('profile_empty_desc')}
          </p>
          <p className="text-[13px] text-text-main/30 font-mono uppercase tracking-widest">
            {t('profile_empty_hint')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-base">
        <ProfileHero
        user={user} profile={profile} isGuest={isGuest}
        onStartSession={() => void navigate('/')}
      />
      <div className="px-4 md:px-9 pt-6 flex flex-row md:flex-col overflow-x-auto md:overflow-x-visible scroll-snap-x-container gap-6 md:gap-0 pb-6 md:pb-0">
          <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden">
            <KPIStrip stats={kpiStats} />
          </div>
          <div className="hidden md:block h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--flow-pulse-color)_30%,var(--border-light))] to-transparent" />
          <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden">
            <Heatmap sessions={sessions} />
          </div>
          <div className="hidden md:block h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--flow-pulse-color)_30%,var(--border-light))] to-transparent" />
          <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden">
            <HourRhythm sessions={sessions} />
          </div>
          <div className="hidden md:block h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--flow-pulse-color)_30%,var(--border-light))] to-transparent" />
          <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden">
            <StreakRibbon sessions={sessions} />
          </div>
          <div className="hidden md:block h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--flow-pulse-color)_30%,var(--border-light))] to-transparent" />
          <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden animate-none">
            <Achievements key={achResetKey} stats={kpiStats} sessions={sessions} />
          </div>
      </div>
      <div className="px-9 pt-3 pb-12 text-center">
        <div className="flex items-center justify-center gap-4 mb-4">
          <Button
            onClick={() => setShowProfileConfirm(true)}
            disabled={profileLoading}
            className="flex items-center gap-1.5 font-mono text-label-sm text-text-main/20 hover:text-brand-soft/50 transition-colors uppercase tracking-widest disabled:opacity-40"
          >
            <Sparkles size={12} />
            {profileLoading ? 'Генерация...' : 'Мой портрет'}
          </Button>
        </div>

        {showProfileConfirm && (
          <div className="inline-flex items-center gap-3 bg-brand-soft/10 border border-brand-soft/20 rounded-lg px-4 py-2 mb-3">
            <span className="text-[12px] text-brand-soft">Для создания портрета ваши тексты будут переданы в ИИ. Продолжить?</span>
            <Button onClick={() => void handleGenerateProfile()} className="text-label-sm font-medium text-brand-soft hover:text-brand-soft/80 transition-colors uppercase tracking-widest">
              Да
            </Button>
            <Button onClick={() => setShowProfileConfirm(false)} className="text-label-sm font-medium text-text-main/40 hover:text-text-main/60 transition-colors uppercase tracking-widest">
              ✕
            </Button>
          </div>
        )}

        {showResetConfirm ? (
          <div className="inline-flex items-center gap-3 bg-accent-danger/10 border border-accent-danger/20 rounded-lg px-4 py-2">
            <span className="text-[12px] text-accent-danger">{t('profile_ach_reset_confirm')}</span>
            <Button onClick={handleResetAchievements} className="text-label-sm font-medium text-accent-danger hover:text-red-300 transition-colors uppercase tracking-widest">
              {t('profile_ach_reset')}
            </Button>
            <Button onClick={() => setShowResetConfirm(false)} className="text-label-sm font-medium text-text-main/40 hover:text-text-main/60 transition-colors uppercase tracking-widest">
              ✕
            </Button>
          </div>
        ) : (
          <Button onClick={() => setShowResetConfirm(true)} className="font-mono text-label-sm text-text-main/20 hover:text-accent-danger/50 transition-colors uppercase tracking-widest">
            {t('profile_ach_reset')}
          </Button>
        )}

      </div>
    </div>
  );
}
