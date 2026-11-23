import { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import type { AppUser } from '../../core/auth/types';
import { AlertCircle } from 'lucide-react';
import { UserProfile } from '../../types';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../shared/i18n';
import { useUserId } from '../../shared/hooks/useUserId';
import { reportError } from '../../shared/errors/reportError';
import { JustWritingLogo } from '../../shared/components/JustWritingLogo';
import { ProfileHero } from '../../features/profile/components/ProfileHero';
import { KPIStrip } from '../../features/profile/components/KPIStrip';
import { StreakRibbon } from '../../features/profile/components/StreakRibbon';
import { Heatmap } from '../../features/profile/components/Heatmap';
import { HourRhythm } from '../../features/profile/components/HourRhythm';
import { MoodTrend } from '../../features/profile/components/MoodTrend';
import { Achievements } from '../../features/profile/components/Achievements';
import { ProfileService } from '../../core/services/ProfileService';
import { useToast } from '../../shared/components/Toast';
import { useProfileStats } from '../../features/profile/hooks/useProfileStats';
import { useAdminStatus } from '../../features/auth/hooks/useAdminStatus';
import { Button } from '../../shared/components/Button';
import { LoadStateView, LoadNotice } from '../../shared/components/LoadStateView';
import { CollapsibleSection } from '../../features/profile/components/CollapsibleSection';
import { DialogueInsights } from '../../features/ai/components/DialogueInsights';
import { ProfileFacets } from '../../features/ai/components/ProfileFacets';
import { ContactDoors } from '../../features/ai/components/ContactDoors';
import { AuthorPortrait } from '../../features/ai/components/AuthorPortrait';
import { ProfileRefreshButton } from '../../features/ai/components/ProfileRefreshButton';
import { ArchiveAnalysisButton } from '../../features/ai/components/ArchiveAnalysisButton';
import { LifeStoryTimeline } from '../../features/ai/components/LifeStoryTimeline';

interface ProfilePageProps {
  user: AppUser | null;
  profile: UserProfile | null;
}

export function ProfilePage({ user, profile }: ProfilePageProps) {
  const { t } = useLanguage();
  const isGuest = !user;
  const { isAdmin } = useAdminStatus();
  const userId = useUserId(user);
  const navigate = useNavigate();

  const state = useProfileStats(userId, user);
  const [achResetKey, setAchResetKey] = useState(0);
  const { showToast: _showToast } = useToast();

  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleResetAchievements = useCallback(() => {
    localStorage.removeItem(`unlocked_achievements_${user?.uid ?? 'guest'}`);
    // Tombstone-момент (#100): без него union-merge мгновенно переигрывает
    // весь набор — сброс получался косметическим.
    localStorage.setItem(`achievements_reset_at_${user?.uid ?? 'guest'}`, String(Date.now()));
    try { localStorage.removeItem(`achievement_earned_at_${user?.uid ?? 'guest'}`); } catch { /* ignore */ }
    setAchResetKey(k => k + 1);
    setShowResetConfirm(false);
    if (user) {
      ProfileService.resetAchievements(user.uid).catch(e => {
        reportError(e, { action: 'resetCloudAchievements', userId: user.uid });
      });
    }
  }, [user]);

  // Порядок веток (загрузка → ошибка → пусто → данные) — в LoadStateView, один
  // с телефоном (MobileMeScreen). «Пусто» — только при целиком удавшемся чтении.
  return (
    <LoadStateView
      state={state}
      loading={
          <div className="flex flex-col items-center justify-center gap-6 py-24">
            <motion.div
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
              className="drop-shadow-[0_0_24px_color-mix(in_srgb,var(--brand-soft)_40%,transparent)]"
            >
              <JustWritingLogo size={120} variant="dark" showRailway={true} showRoman={true} showCrown={true} />
            </motion.div>
            <p className="text-sm text-text-main/60 tracking-widest uppercase font-sans">
              {t("profile_loading")}
            </p>
          </div>
      }
      error={retry => (
        <LoadNotice
          variant="panel" text={t('profile_load_error')} onRetry={retry}
          icon={<AlertCircle size={24} className="mx-auto mb-3 text-accent-danger/70" />}
        />
      )}
      partial={retry => <LoadNotice variant="row" text={t('profile_cloud_load_error')} onRetry={retry} />}
      empty={
        <div className="min-h-screen bg-surface-base flex flex-col items-center justify-center gap-8 px-6 text-center">
          <ProfileHero user={user} profile={profile} isGuest={isGuest} onStartSession={() => void navigate('/')} />
          <div className="max-w-sm space-y-3">
            <p className="text-[15px] text-text-main/60 leading-relaxed">
              {t('profile_empty_desc')}
            </p>
            <p className="text-[13px] text-text-main/60 font-mono uppercase tracking-widest">
              {t('profile_empty_hint')}
            </p>
          </div>
        </div>
      }
    >
      {({ sessions, kpiStats }, notice) => (
    <div className="min-h-screen bg-surface-base pb-12">
      <ProfileHero
        user={user} profile={profile} isGuest={isGuest}
        onStartSession={() => void navigate('/')}
      />
      
      <div className="max-w-screen-2xl mx-auto px-6 md:px-9 space-y-6 pt-6">
        {notice}
        <CollapsibleSection title={t('profile_sec_how_write')} storageKey="profile_sec_how_write_v2" defaultOpen={true}>
          <div className="flex flex-row md:flex-col overflow-x-auto md:overflow-x-visible scroll-snap-x-container gap-6 md:gap-0 pb-6 md:pb-0">
            <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden animate-none">
              <KPIStrip stats={kpiStats} />
            </div>
            <div className="hidden md:block h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--flow-pulse-color)_30%,var(--border-light))] to-transparent animate-none" />
            <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden animate-none">
              <Heatmap sessions={sessions} />
            </div>
            <div className="hidden md:block h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--flow-pulse-color)_30%,var(--border-light))] to-transparent animate-none" />
            <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden animate-none">
              <HourRhythm sessions={sessions} />
            </div>
            <div className="hidden md:block h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--flow-pulse-color)_30%,var(--border-light))] to-transparent animate-none" />
            <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden animate-none">
              <MoodTrend userId={userId} />
            </div>
            <div className="hidden md:block h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--flow-pulse-color)_30%,var(--border-light))] to-transparent animate-none" />
            <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden animate-none">
              <StreakRibbon sessions={sessions} />
            </div>
            <div className="hidden md:block h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--flow-pulse-color)_30%,var(--border-light))] to-transparent animate-none" />
            <div className="scroll-snap-card shrink-0 w-[88vw] md:w-full bg-surface-card/20 md:bg-transparent border border-border-subtle/20 md:border-0 rounded-3xl md:rounded-none overflow-hidden animate-none">
              <Achievements key={achResetKey} stats={kpiStats} sessions={sessions} />
            </div>
          </div>
          
          <div className="pt-3 text-center">
            {showResetConfirm ? (
              <div className="inline-flex items-center gap-3 bg-accent-danger/10 border border-accent-danger/20 rounded-lg px-4 py-2">
                <span className="text-[12px] text-accent-danger">{t('profile_ach_reset_confirm')}</span>
                <Button onClick={handleResetAchievements} className="text-label-sm font-medium text-accent-danger hover:text-accent-danger/80 transition-colors uppercase tracking-widest">
                  {t('profile_ach_reset')}
                </Button>
                <Button onClick={() => setShowResetConfirm(false)} className="text-label-sm font-medium text-text-main/60 hover:text-text-main transition-colors uppercase tracking-widest">
                  ✕
                </Button>
              </div>
            ) : (
              <Button onClick={() => setShowResetConfirm(true)} className="font-mono text-label-sm text-text-main/60 hover:text-accent-danger/50 transition-colors uppercase tracking-widest">
                {t('profile_ach_reset')}
              </Button>
            )}
          </div>
        </CollapsibleSection>

        {/*
          Профиль ИИ — портрет, грани, двери контакта и оба прохода пересчёта —
          пока только для владельца.

          Дело не в секретности, а в том, что показывать эту машинерию людям
          рано: обновление профиля стоит около 125 вызовов на архиве в полторы
          сотни заметок, при обычном дневном лимите в 30 оно недостижимо, и оно
          НЕ возобновляемое — упёршись в лимит на четвёртом шаге из шести, оно
          оставляет портрет несобранным. Кнопка, которая гарантированно доводит
          до половины и бросает, хуже отсутствующей кнопки.

          Разбор отдельной заметки (✨ в архиве) этим не затронут: сводки,
          карточки и векторы поиска работают у всех.
        */}
        {isAdmin && (
          <CollapsibleSection title={t('profile_sec_about_me')} storageKey="profile_sec_about_me_v3" defaultOpen={false}>
            <div className="space-y-6">
              <ArchiveAnalysisButton />
              <ProfileRefreshButton />
              <AuthorPortrait readOnly={true} />
              <ProfileFacets readOnly={true} />
              <ContactDoors readOnly={true} />
            </div>
          </CollapsibleSection>
        )}

        {/* DI-6: выводы видны всем, у кого включён флаг; с сохранёнными выводами
            раздел остаётся и при выключенном — их можно удалить. */}
        <DialogueInsights section={content => (
          <CollapsibleSection title={t('profile_sec_dialogue_insights')} storageKey="profile_sec_dialogue_insights_v1" defaultOpen={false}>
            {content}
          </CollapsibleSection>
        )} />

        <CollapsibleSection title={t('profile_sec_life_story')} storageKey="profile_sec_life_story_v3" defaultOpen={false}>
          <LifeStoryTimeline />
        </CollapsibleSection>
      </div>
    </div>
      )}
    </LoadStateView>
  );
}
