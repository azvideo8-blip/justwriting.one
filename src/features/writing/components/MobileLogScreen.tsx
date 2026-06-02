import { useState, useMemo } from 'react';
import { useLifeLog } from '../hooks/useLifeLog';
import { useLanguage } from '../../../core/i18n';
import { Session, Label } from '../../../types';
import { parseFirestoreDate as _parseFirestoreDate } from '../../../core/utils/utils';
import { StreakDots } from '../../../shared/components/StreakDots';
import { SessionCard } from './SessionCard';
import { DocumentPreview } from '../../archive/components/DocumentPreview';
import { updateArchiveField } from '../../archive/services/archiveCrud';
import { auth } from '../../../core/firebase/auth';
import { AnimatePresence } from 'motion/react';
import { MobilePageHeader } from '../../../shared/components/MobilePageHeader';
import { Settings } from 'lucide-react';
import { useSettings } from '../../../core/settings/SettingsContext';
import { LoadingSkeleton } from '../../../shared/components/LoadingSkeleton';
import { IconButton } from '../../../shared/components/IconButton';
import { logger } from '../../../core/errors/logger';

interface MobileLogScreenProps {
  userId: string;
  isGuest: boolean;
  onContinue: (session: Session) => void;
  labels?: Label[];
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatDuration(minutes: number, t: (key: string) => string): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}${t('unit_hour')} ${pad(m)}${t('unit_min')}` : `${pad(m)}${t('unit_min')}`;
}

export function MobileLogScreen({ userId, isGuest, onContinue, labels }: MobileLogScreenProps) {
  const { t } = useLanguage();
  const { openSettings } = useSettings();
  const { sessionGroups, loading, refresh } = useLifeLog(userId, isGuest);
  const [query, setQuery] = useState('');
  const [previewSession, setPreviewSession] = useState<Session | null>(null);

  const handleLabelChange = async (s: Session, labelId: string | undefined) => {
    try {
      await updateArchiveField(s, 'labelId', labelId, auth.currentUser, userId);
      if (previewSession && previewSession.id === s.id) {
        setPreviewSession(prev => prev ? { ...prev, labelId } : null);
      }
      await refresh();
    } catch (e) {
      logger.error('mobileLogScreen', 'Failed to update labelId', { error: String(e) });
    }
  };

  const filteredGroups = useMemo(() => {
    if (!query.trim()) return sessionGroups;
    const needle = query.toLowerCase();
    return sessionGroups
      .map(g => ({
        ...g,
        sessions: g.sessions.filter(s =>
          (s.title || '').toLowerCase().includes(needle) ||
          (s.content || '').toLowerCase().includes(needle)
        ),
      }))
      .filter(g => g.sessions.length > 0);
  }, [sessionGroups, query]);

  const weekSummary = useMemo(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    let words = 0, minutes = 0;
    sessionGroups.forEach(g => {
      if (new Date(g.date) >= weekAgo) {
        g.sessions.forEach(s => {
          words += s.wordCount || 0;
          minutes += (s.duration || 0) / 60;
        });
      }
    });
    return { words, minutes };
  }, [sessionGroups]);

  return (
    <div className="fixed inset-0 bg-[var(--color-surface-base,#0b0d0c)] z-30 flex flex-col pt-0">

      <MobilePageHeader
        title={t('lifelog_tab_log')}
        titleFont="serif"
        right={
          <IconButton
            icon={<Settings size={20} />}
            label={t('nav_settings')}
            onClick={() => openSettings()}
            className="p-2 text-text-muted"
          />
        }
      />

      <div className="px-5 pt-4">

        <div className="mb-4">
          <StreakDots sessionGroups={sessionGroups} variant="mobile" />
        </div>

        <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-3.5 px-4 mb-3">
          <div className="text-[10px] text-[var(--color-text-subtle,var(--text-subtle))] uppercase tracking-[0.08em] font-mono mb-2">
            {t('log_week_summary')}
          </div>
          <div className="flex gap-4">
            <div>
              <div className="text-[22px] font-medium text-[var(--color-text-main,var(--text-main))] leading-none">
                {weekSummary.words.toLocaleString()}
              </div>
              <div className="text-[10px] text-[var(--color-text-muted,var(--text-muted))] mt-0.5">
                {t('home_words_short')}
              </div>
            </div>
            <div>
              <div className="text-[22px] font-medium text-[var(--color-text-main,var(--text-main))] leading-none">
                {formatDuration(weekSummary.minutes, t)}
              </div>
              <div className="text-[10px] text-[var(--color-text-muted,var(--text-muted))] mt-0.5">
                {t('home_today_flow')}
              </div>
            </div>
          </div>
        </div>

        <div className="relative mb-3">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle,var(--text-subtle))]"
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7"/>
            <path d="m20 20-3.5-3.5"/>
          </svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('lifelog_search_placeholder')}
            inputMode="search"
            enterKeyHint="search"
            className="w-full py-2 px-3 pl-8 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-[var(--color-text-main,var(--text-main))] outline-none font-sans"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto touch-pan-y pb-[calc(env(safe-area-inset-bottom,0px)+80px)]">
        {loading ? (
          <div className="space-y-4 px-5 pt-4">
            <LoadingSkeleton />
            <div className="skeleton-pulse bg-surface-card border border-border-subtle rounded-3xl h-24 w-full" />
            <div className="skeleton-pulse bg-surface-card border border-border-subtle rounded-3xl h-24 w-full" />
            <div className="skeleton-pulse bg-surface-card border border-border-subtle rounded-3xl h-24 w-full" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="flex flex-col items-center py-12 px-6 gap-2">
            <div className="text-2xl mb-1">✦</div>
            <div className="text-sm text-[var(--color-text-muted,var(--text-muted))] text-center">
              {query ? t('log_no_results') : t('log_empty')}
            </div>
          </div>
        ) : (
          filteredGroups.map(group => (
            <div key={group.date.toISOString()}>
              <div className="pt-3.5 px-5 pb-1.5 text-[10px] text-[var(--color-text-subtle,var(--text-subtle))] uppercase tracking-[0.08em] font-mono">
                {group.label}
              </div>

              <div className="px-5 flex flex-col gap-3">
                {group.sessions.map(session => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onContinue={() => onContinue(session)}
                    labels={labels}
                    userId={userId}
                    onDeleteSuccess={() => {
                      void refresh();
                    }}
                    onPreview={() => setPreviewSession(session)}
                    onLabelChange={(s, labelId) => void handleLabelChange(s, labelId)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <AnimatePresence>
        {previewSession && (
          <DocumentPreview
            session={previewSession}
            onClose={() => setPreviewSession(null)}
            onContinue={onContinue}
            onLabelChange={(s, labelId) => void handleLabelChange(s, labelId)}
            onTagsChange={(s, tags) => {
              void (async () => {
                try {
                  await updateArchiveField(s, 'tags', tags, auth.currentUser, userId);
                  setPreviewSession(prev => prev ? { ...prev, tags } : null);
                  await refresh();
                } catch (e) {
                  logger.error('mobileLogScreen', 'Failed to update tags', { error: String(e) });
                }
              })();
            }}
            labels={labels}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
