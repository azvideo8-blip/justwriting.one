import { useState, useMemo } from 'react';
import { useLifeLog } from '../hooks/useLifeLog';
import { useLanguage } from '../../../core/i18n';
import { Session } from '../../../types';
import { parseFirestoreDate } from '../../../core/utils/utils';

interface MobileLogScreenProps {
  userId: string;
  onContinue: (session: Session) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}ч ${pad(m)}м` : `${pad(m)}м`;
}

function Sparkline({ groups }: { groups: { date: Date; sessions: Session[] }[] }) {
  const bars = useMemo(() => {
    const days: { words: number; date: Date }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const group = groups.find(g =>
        new Date(g.date).toDateString() === d.toDateString()
      );
      const words = group
        ? group.sessions.reduce((s, sess) => s + (sess.wordCount || 0), 0)
        : 0;
      days.push({ words, date: d });
    }
    const max = Math.max(...days.map(d => d.words), 1);
    return days.map(d => ({ ...d, pct: d.words / max }));
  }, [groups]);

  const today = new Date().toDateString();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: 4,
      height: 32,
    }}>
      {bars.map((bar, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: Math.max(3, bar.pct * 32),
            borderRadius: 3,
            background: bar.date.toDateString() === today
              ? 'oklch(0.72 0.13 155)'
              : bar.words > 0
                ? 'rgba(255,255,255,0.15)'
                : 'rgba(255,255,255,0.04)',
            transition: 'height 0.3s',
          }}
        />
      ))}
    </div>
  );
}

function StreakRow({ groups }: { groups: { date: Date; sessions: Session[] }[] }) {
  const { language } = useLanguage();
  const days = useMemo(() => {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const hasSession = groups.some(g =>
        new Date(g.date).toDateString() === d.toDateString()
      );
      result.push({
        date: d,
        hasSession,
        label: d.toLocaleDateString(language, { weekday: 'short' })
          .slice(0, 2).toUpperCase(),
        isToday: d.toDateString() === new Date().toDateString(),
      });
    }
    return result;
  }, [groups, language]);

  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
      {days.map((day, i) => (
        <div key={i} style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 5,
          flex: 1,
        }}>
          <div style={{
            width: '100%',
            aspectRatio: '1',
            borderRadius: 8,
            background: day.hasSession
              ? day.isToday
                ? 'oklch(0.72 0.13 155)'
                : 'rgba(255,255,255,0.10)'
              : 'rgba(255,255,255,0.03)',
            border: day.isToday && !day.hasSession
              ? '1px solid rgba(255,255,255,0.15)'
              : '1px solid transparent',
          }} />
          <span style={{
            fontSize: 9,
            color: day.isToday
              ? 'rgba(232,236,233,0.7)'
              : 'rgba(74,81,77,1)',
            fontFamily: 'JetBrains Mono, monospace',
            letterSpacing: '.04em',
          }}>
            {day.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MobileLogScreen({ userId, onContinue }: MobileLogScreenProps) {
  const { t, language } = useLanguage();
  const { sessionGroups, loading } = useLifeLog(userId);
  const [query, setQuery] = useState('');

  const filteredGroups = useMemo(() => {
    if (!query.trim()) return sessionGroups;
    const needle = query.toLowerCase();
    return sessionGroups
      .map(g => ({
        ...g,
        sessions: g.sessions.filter(s =>
          (s.title || '').toLowerCase().includes(needle) ||
          (s.content || '').toLowerCase().slice(0, 200).includes(needle)
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
      paddingTop: 'env(safe-area-inset-top, 0px)',
    }}>

      <div style={{ padding: '16px 20px 0' }}>
        <div style={{
          fontSize: 20,
          fontWeight: 500,
          color: 'rgba(232,236,233,0.95)',
          fontFamily: 'Lora, Georgia, serif',
          marginBottom: 16,
        }}>
          Life Log
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16,
          padding: '14px 16px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 10,
              color: 'rgba(74,81,77,1)',
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
                  color: 'rgba(232,236,233,0.95)',
                  lineHeight: 1,
                }}>
                  {weekSummary.words.toLocaleString()}
                </div>
                <div style={{
                  fontSize: 10,
                  color: 'rgba(138,145,141,1)',
                  marginTop: 2,
                }}>
                  {t('home_words_short')}
                </div>
              </div>
              <div>
                <div style={{
                  fontSize: 22,
                  fontWeight: 500,
                  color: 'rgba(232,236,233,0.95)',
                  lineHeight: 1,
                }}>
                  {formatDuration(weekSummary.minutes)}
                </div>
                <div style={{
                  fontSize: 10,
                  color: 'rgba(138,145,141,1)',
                  marginTop: 2,
                }}>
                  {t('home_today_flow')}
                </div>
              </div>
            </div>
          </div>

          <div style={{ width: 80, flexShrink: 0 }}>
            <Sparkline groups={sessionGroups} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <StreakRow groups={sessionGroups} />
        </div>

        <div style={{ position: 'relative', marginBottom: 12 }}>
          <svg
            style={{
              position: 'absolute', left: 10, top: '50%',
              transform: 'translateY(-50%)',
              color: 'rgba(74,81,77,1)',
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
            style={{
              width: '100%',
              padding: '9px 12px 9px 32px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10,
              fontSize: 14,
              color: 'rgba(232,236,233,0.9)',
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
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            padding: 40,
            color: 'rgba(74,81,77,1)',
            fontSize: 13,
          }}>
            {t('common_loading')}
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
              color: 'rgba(138,145,141,1)',
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
                color: 'rgba(74,81,77,1)',
                textTransform: 'uppercase',
                letterSpacing: '.08em',
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {group.label}
              </div>

              {group.sessions.map(session => (
                <button
                  key={session.id}
                  onClick={() => onContinue(session)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '12px 20px',
                    background: 'transparent',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 8,
                    marginBottom: 4,
                  }}>
                    <div style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: 'rgba(232,236,233,0.85)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}>
                      {session.title || t('common_untitled')}
                    </div>
                    <div style={{
                      fontSize: 11,
                      color: 'rgba(74,81,77,1)',
                      fontFamily: 'JetBrains Mono, monospace',
                      flexShrink: 0,
                    }}>
                      {parseFirestoreDate(session.createdAt)
                        .toLocaleTimeString(language, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 12,
                    color: 'rgba(74,81,77,1)',
                    fontFamily: 'JetBrains Mono, monospace',
                    display: 'flex',
                    gap: 8,
                  }}>
                    <span>{session.wordCount} {t('home_words_short')}</span>
                    <span>·</span>
                    <span>{formatDuration((session.duration || 0) / 60)}</span>
                    {session.isPublic && (
                      <>
                        <span>·</span>
                        <span style={{ color: 'oklch(0.72 0.13 155)' }}>
                          {t('lifelog_status_published')}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
