import { type ReactNode } from 'react';
import { differenceInCalendarDays, format } from 'date-fns';
import { useLanguage } from '../../shared/i18n';
import { UserProfile } from '../../types';
import type { AppUser } from '../../core/auth/types';
import { Settings, ChevronRight } from 'lucide-react';
import { useUserId } from '../../shared/hooks/useUserId';
import { IconButton } from '../../shared/components/IconButton';
import { ProfileHero } from '../../features/profile/components/ProfileHero';
import { KPIStrip } from '../../features/profile/components/KPIStrip';
import { StreakRibbon } from '../../features/profile/components/StreakRibbon';
import { Heatmap } from '../../features/profile/components/Heatmap';
import { HourRhythm } from '../../features/profile/components/HourRhythm';
import { Achievements } from '../../features/profile/components/Achievements';
import { MoodTrend } from '../../features/profile/components/MoodTrend';
import { useNavigate } from 'react-router-dom';
import { MobilePageHeader } from '../../shared/components/MobilePageHeader';
import { MeAccountSection } from './MeAccountSection';
import { useLoginModal } from '../useLoginModal';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { useProfileStats } from '../../features/profile/hooks/useProfileStats';
import { useSyncStatus } from '../../core/sync/useSyncStatus';
import { useActivityLogStore } from '../../shared/activity/useActivityLogStore';
import { useEncryptionStore } from '../../core/crypto/useEncryptionStore';
import { useAdminStatus } from '../../features/auth/hooks/useAdminStatus';
import { getDateLocale } from '../../core/utils/dateUtils';

interface MobileMeScreenProps {
  user: AppUser | null;
  profile: UserProfile | null;
}

/**
 * MR-4: статус вместо плавающих чипов. Раньше «Активность» и «Синхронизация» висели
 * над нижней панелью и перекрывали контент; теперь это строки в «Профиле»,
 * а на вкладке горит точка, когда есть на что посмотреть.
 */
function MobileStatusCard({ uid }: { uid: string | null }) {
  const { t, tp: rawTp } = useLanguage();
  const tp = typeof rawTp === 'function' ? rawTp : ((k: string, count: number) => t(k, { count: String(count) }));
  const navigate = useNavigate();
  const syncStatus = useSyncStatus(uid);
  const entries = useActivityLogStore(st => st.entries);
  const setPanelOpen = useActivityLogStore(st => st.setPanelOpen);
  const unlocked = useEncryptionStore(st => st.isVaultUnlocked);
  const { isAdmin } = useAdminStatus();

  const errorCount = entries.filter(e => e.level === 'error').length;
  const warnCount = entries.filter(e => e.level === 'warning').length;
  const activityText = errorCount > 0 ? tp('activity_errors', errorCount)
    : warnCount > 0 ? tp('activity_warnings', warnCount)
    : t('me_status_quiet');

  const syncText = t(
    syncStatus.status === 'synced' ? 'synced_compact'
      : syncStatus.status === 'sync_off' ? 'me_status_sync_off'
      : syncStatus.status === 'offline' ? 'sync_paused_no_network'
      : syncStatus.status === 'cloud_unavailable' ? 'sync_paused_cloud_unavailable'
      : syncStatus.status === 'ai_store_unsynced' ? 'sync_ai_store_pending'
      : 'sync_paused_pending',
    syncStatus.status === 'pending' ? { count: String(syncStatus.pendingCount) }
      : syncStatus.status === 'ai_store_unsynced' ? { count: String(syncStatus.aiStorePendingCount + syncStatus.aiStoreDeadCount) }
      : undefined
  );

  const rows: { label: string; value: string; dot?: boolean; onTap: () => void; href?: never }[] = [
    { label: t('sync_indicator_label'), value: syncText, dot: syncStatus.status !== 'synced' && syncStatus.status !== 'sync_off', onTap: () => void navigate('/settings#sync') },
    { label: t('activity_log_aria'), value: activityText, dot: errorCount + warnCount > 0, onTap: () => setPanelOpen(true) },
    { label: t('me_status_vault'), value: t(unlocked ? 'me_status_vault_open' : 'me_status_vault_locked'), dot: !unlocked, onTap: () => void navigate('/settings#security') },
  ];
  if (isAdmin) rows.push({ label: t('admin_tab_diagnostics'), value: '', dot: false, onTap: () => void navigate('/diagnostics') });

  return (
    <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
      {rows.map(r => (
        <button
          key={r.label}
          type="button"
          onClick={r.onTap}
          className="w-full h-12 flex items-center gap-3 px-4 text-left border-b border-white/[0.04] last:border-b-0"
        >
          <span className="flex-1 min-w-0 text-sm text-text-main truncate">{r.label}</span>
          <span className="text-[11px] text-text-muted truncate max-w-[45%]">{r.value}</span>
          {r.dot && <span aria-hidden="true" className="w-2 h-2 rounded-full bg-accent-warning shrink-0" />}
          <ChevronRight size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** MC-7: группа профиля — 13 px подпись и строки под ней. Рамки нет: карточка
 *  в карточке на узком экране превращает список в набор плашек. */
function MeGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="text-[13px] font-semibold text-[var(--text-muted)]">{title}</h2>
      {children}
    </section>
  );
}

export function MobileMeScreen({ user, profile }: MobileMeScreenProps) {
  const { t, tp, language } = useLanguage();
  const navigate = useNavigate();
  const userId = useUserId(user);
  const { openLoginModal } = useLoginModal();
  const isGuest = !user;

  const { sessions, kpiStats, loading: loadingSessions, refresh: _refresh } = useProfileStats(userId, user);

  const createdDate = user?.metadata?.creationTime ? new Date(user.metadata.creationTime) : null;
  const practiceDays = createdDate ? Math.max(0, differenceInCalendarDays(new Date(), createdDate)) : 0;
  const streakDays = profile?.streakDays ?? 0;


  return (
    <>
      {/* not-a-modal: fullscreen mobile screen */}
      <div className="fixed inset-0 bg-[var(--color-surface-base,#0b0d0c)] z-30 flex flex-col pt-0">
      {/* Top Header with title and Settings gear icon */}
      <MobilePageHeader
        title={t('nav_profile_short')}
        titleFont="sans"
        right={
          <IconButton
            icon={<Settings size={20} />}
            label={t('nav_settings')}
            onClick={() => void navigate('/settings')}
            className="w-11 h-11 p-0 text-text-muted hover:text-text-main"
          />
        }
      />

      {/* Section Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-20">
        {(
          loadingSessions ? (
            <div className="space-y-4">
              <LoadingSkeleton lines={3} className="p-4 bg-white/[0.02] border border-white/[0.04] rounded-2xl" />
              <LoadingSkeleton lines={4} className="p-4 bg-white/[0.02] border border-white/[0.04] rounded-2xl" />
              <LoadingSkeleton lines={4} className="p-4 bg-white/[0.02] border border-white/[0.04] rounded-2xl" />
            </div>
          ) : (
            <div className="space-y-5">
              {/* MC-7: шапка без рамки — карточка в карточке съедала ширину и
                  делала экран «набором плашек». */}
              <ProfileHero
                user={user}
                profile={profile}
                isGuest={isGuest}
                onStartSession={() => void navigate('/')}
              />

              {/* MC-7: группы по 13 px вместо mono-uppercase ярлыков. */}
              <MeGroup title={t('me_group_practice')}>
                <div className="flex items-center justify-between gap-3 px-1 py-2.5 text-sm">
                  {practiceDays > 0 && createdDate ? (
                    <>
                      <span className="shrink-0 text-text-main/70">{t('profile_member_since')}</span>
                      <span className="min-w-0 truncate text-right text-[var(--text-muted)]">
                        {format(createdDate, 'd MMMM', { locale: getDateLocale(language) })} · {practiceDays} {tp('home_streak_days', practiceDays)}
                      </span>
                    </>
                  ) : (
                    <span className="text-text-main/70">{t('me_first_entry_today')}</span>
                  )}
                </div>
                {streakDays > 0 && (
                  <div className="flex items-center justify-between gap-3 px-1 py-2.5 text-sm border-t border-white/[0.04]">
                    <span className="shrink-0 text-text-main/70">{t('me_streak_row')}</span>
                    <span className="min-w-0 truncate text-right text-[var(--text-muted)]">
                      {streakDays} {tp('home_streak_days', streakDays)}
                    </span>
                  </div>
                )}
              </MeGroup>

              <MeGroup title={t('me_group_state')}>
                {/* MR-4/MR-5: статусы — строки группы, а не отдельная карточка. */}
                <MobileStatusCard uid={user?.uid ?? null} />
              </MeGroup>

              {/* MR-5: переключателя «Статистика / Аккаунт» нет — карточка аккаунта
              идёт сразу за статусами; язык и выход при этом доступны и в
              /settings#account. */}
              <MeAccountSection user={user} onSignOut={() => void navigate('/settings#account')} onSignIn={openLoginModal} />

              {/* 2. KPI Strip (Metrics row) */}
              <KPIStrip stats={kpiStats} />

              {/* 3. Streak Ribbon */}
              <StreakRibbon sessions={sessions} />

              {/* 4. Heatmap Activity */}
              <MeGroup title={t('profile_act_map')}>
                <Heatmap sessions={sessions} />
              </MeGroup>

              {/* 5. Hour Rhythm */}
              <MeGroup title={t('profile_rhythm')}>
                <HourRhythm sessions={sessions} />
              </MeGroup>

              {/* 6. Mood Trend */}
              <MoodTrend userId={userId} className="py-4" />

              {/* 7. Achievements — сброс достижений живёт в настройках (MC-7):
                  в профиле он был единственной разрушительной кнопкой. */}
              <MeGroup title={t('profile_achievements_title')}>
                <Achievements
                  stats={kpiStats}
                  sessions={sessions}
                />
              </MeGroup>
            </div>
          )
        )}
      </div>
    </div>
    </>
  );
}
