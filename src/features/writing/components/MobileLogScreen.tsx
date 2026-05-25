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
      refresh();
    } catch (e) {
      console.error('Failed to update labelId:', e);
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
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--color-surface-base, #0b0d0c)',
      zIndex: 30,
      display: 'flex',
      flexDirection: 'column',
      paddingTop: 0,
    }}>

      <MobilePageHeader
        title={t('lifelog_tab_log')}
        titleFont="serif"
        right={
          <button
            onClick={() => openSettings()}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 10,
              display: 'flex',
              alignItems: 'center',
            }}
            aria-label={t('nav_settings')}
          >
            <Settings size={20} />
          </button>
        }
      />

      <div style={{ padding: '16px 20px 0' }}>

        <div style={{ marginBottom: 16 }}>
          <StreakDots sessionGroups={sessionGroups} variant="mobile" />
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16,
          padding: '14px 16px',
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 10,
            color: 'var(--color-text-subtle, var(--text-subtle))',
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            fontFamily: 'JetBrains Mono, monospace',
            marginBottom: 8,
          }}>
            {t('log_week_summary')}
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <div>
              <div style={{
                fontSize: 22,
                fontWeight: 500,
                color: 'var(--color-text-main, var(--text-main))',
                lineHeight: 1,
              }}>
                {weekSummary.words.toLocaleString()}
              </div>
              <div style={{
                fontSize: 10,
                color: 'var(--color-text-muted, var(--text-muted))',
                marginTop: 2,
              }}>
                {t('home_words_short')}
              </div>
            </div>
            <div>
              <div style={{
                fontSize: 22,
                fontWeight: 500,
                color: 'var(--color-text-main, var(--text-main))',
                lineHeight: 1,
              }}>
                {formatDuration(weekSummary.minutes, t)}
              </div>
              <div style={{
                fontSize: 10,
                color: 'var(--color-text-muted, var(--text-muted))',
                marginTop: 2,
              }}>
                {t('home_today_flow')}
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: 12 }}>
          <svg
            style={{
              position: 'absolute', left: 10, top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-text-subtle, var(--text-subtle))',
            }}
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
            style={{
              width: '100%',
              padding: '9px 12px 9px 32px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10,
              fontSize: 14,
              color: 'var(--color-text-main, var(--text-main))',
              outline: 'none',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          />
        </div>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
      }}>
        {loading ? (
          <div className="space-y-4 px-5 pt-4">
            <LoadingSkeleton />
            <div className="skeleton-pulse bg-surface-card border border-border-subtle rounded-3xl h-24 w-full" />
            <div className="skeleton-pulse bg-surface-card border border-border-subtle rounded-3xl h-24 w-full" />
            <div className="skeleton-pulse bg-surface-card border border-border-subtle rounded-3xl h-24 w-full" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '48px 24px',
            gap: 8,
          }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>✦</div>
            <div style={{
              fontSize: 14,
              color: 'var(--color-text-muted, var(--text-muted))',
              textAlign: 'center',
            }}>
              {query ? t('log_no_results') : t('log_empty')}
            </div>
          </div>
        ) : (
          filteredGroups.map(group => (
            <div key={group.date.toISOString()}>
              <div style={{
                padding: '14px 20px 6px',
                fontSize: 10,
                color: 'var(--color-text-subtle, var(--text-subtle))',
                textTransform: 'uppercase',
                letterSpacing: '.08em',
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {group.label}
              </div>

              <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {group.sessions.map(session => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onContinue={() => onContinue(session)}
                    labels={labels}
                    userId={userId}
                    onDeleteSuccess={() => {
                      refresh();
                    }}
                    onPreview={() => setPreviewSession(session)}
                    onLabelChange={handleLabelChange}
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
            onLabelChange={handleLabelChange}
            onTagsChange={async (s, tags) => {
              try {
                await updateArchiveField(s, 'tags', tags, auth.currentUser, userId);
                setPreviewSession(prev => prev ? { ...prev, tags } : null);
                refresh();
              } catch (e) {
                console.error('Failed to update tags:', e);
              }
            }}
            labels={labels}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
