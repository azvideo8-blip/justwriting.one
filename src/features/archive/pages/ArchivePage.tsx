import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { format } from 'date-fns';
import { Search, LayoutGrid, LayoutList, BookOpen, Trash2, ExternalLink } from 'lucide-react';
import { UserProfile } from '../../../types';
import { GridNoteCard } from '../components/GridNoteCard';
import { getSessionDate, cn, calculateStreak } from '../../../core/utils/utils';
import { toDate, getDateLocale } from '../../../core/utils/dateUtils';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { StorageService } from '../../writing/services/StorageService';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { DocumentService } from '../../writing/services/DocumentService';
import { loadAllSessions } from '../../writing/services/UnifiedSessionLoader';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { z } from 'zod';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';
import { Calendar } from '../../calendar/components/Calendar';
import { useLanguage } from '../../../core/i18n';
import { useArchiveFilters } from '../hooks/useArchiveFilters';
import { useArchiveSearch } from '../hooks/useArchiveSearch';
import { useNavigate } from 'react-router-dom';
import { useUserId } from '../../../shared/hooks/useUserId';
import { EmptyState } from '../../../shared/components/EmptyState';
import { DocumentPreview } from '../components/DocumentPreview';
import { ArchiveStats } from '../components/ArchiveStats';
import { InlineTags } from '../components/InlineTags';
import { StorageIcons } from '../../writing/components/StorageIcons';
import { ArchiveSession } from '../types';

interface ArchiveViewProps {
  user: User | null;
  profile: UserProfile | null;
}

function NoteRow({ session, onOpen, t, language, onDelete, onTagsChange, onStorageChange, onTitleChange, onDateChange, userId }: {
  session: ArchiveSession;
  onOpen: () => void;
  t: (key: string) => string;
  language: string;
  onDelete?: (session: ArchiveSession) => void;
  onTagsChange?: (session: ArchiveSession, tags: string[]) => void;
  onStorageChange?: () => void;
  onTitleChange?: (session: ArchiveSession, title: string) => void;
  onDateChange?: (session: ArchiveSession, date: Date) => void;
  userId: string;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.title || '');
  const [editingDateTime, setEditingDateTime] = useState(false);
  const [dateDraft, setDateDraft] = useState('');
  const [timeDraft, setTimeDraft] = useState('');
  const dtRef = React.useRef<HTMLDivElement>(null);

  const date = getSessionDate(session);
  const dateLabel = date
    ? format(date, 'd MMM yy', { locale: getDateLocale(language) })
    : '—';

  const timeStr = (() => {
    const d = toDate(session.sessionStartTime) ?? toDate(session.createdAt);
    return d ? d.toLocaleTimeString(language === 'ru' ? 'ru' : 'en', { hour: '2-digit', minute: '2-digit' }) : '00:00';
  })();

  React.useEffect(() => {
    if (!editingDateTime) return;
    const handleClick = (e: MouseEvent) => {
      if (dtRef.current && !dtRef.current.contains(e.target as Node)) {
        setEditingDateTime(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [editingDateTime]);

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed !== (session.title || '') && trimmed) {
      onTitleChange?.(session, trimmed);
    } else {
      setTitleDraft(session.title || '');
    }
  };

  const openDateTimeEditor = () => {
    const ms = session.sessionStartTime
      ?? (session.createdAt instanceof Date ? session.createdAt.getTime() : Date.now());
    const d = new Date(ms);
    setDateDraft(format(d, 'yyyy-MM-dd'));
    setTimeDraft(format(d, 'HH:mm'));
    setEditingDateTime(true);
  };

  const commitDateTime = () => {
    setEditingDateTime(false);
    if (!dateDraft || !timeDraft) return;
    const [y, mo, d] = dateDraft.split('-').map(Number);
    const [h, min] = timeDraft.split(':').map(Number);
    const newDate = new Date(y, mo - 1, d, h, min, 0, 0);
    if (isNaN(newDate.getTime())) return;
    const originalMs = session.sessionStartTime
      ?? (session.createdAt instanceof Date ? session.createdAt.getTime() : Date.now());
    if (newDate.getTime() !== originalMs) {
      onDateChange?.(session, newDate);
    }
  };

  return (
    <div
      className="grid items-start gap-3 px-3 py-4 rounded-xl hover:bg-text-main/[0.025] transition-colors group border border-transparent hover:border-border-subtle"
      style={{ gridTemplateColumns: '72px 1fr auto' }}
    >
      <div className="shrink-0 relative">
        <div
          className="cursor-pointer"
          onClick={openDateTimeEditor}
          title={t('archive_edit_date')}
        >
          <div className="font-mono text-[11px] text-text-main/50 uppercase tracking-wide leading-tight hover:text-text-main/70">
            {dateLabel}
          </div>
          <div className="font-mono text-[11px] text-text-main/30 mt-0.5 hover:text-text-main/50">
            {timeStr}
          </div>
        </div>
        {editingDateTime && (
          <div
            ref={dtRef}
            className="absolute top-full left-0 z-50 mt-1 border border-border-subtle rounded-xl p-3 shadow-xl w-[200px]"
            style={{ background: 'color-mix(in srgb, var(--bg-base) 95%, var(--brand-primary) 5%)' }}
          >
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-mono text-text-main/40 uppercase tracking-wide">
                  {t('archive_edit_date')}
                </label>
                <input
                  type="date"
                  value={dateDraft}
                  onChange={e => setDateDraft(e.target.value)}
                  className="w-full text-[12px] font-mono bg-text-main/5 border border-border-subtle rounded px-2 py-1 outline-none mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-text-main/40 uppercase tracking-wide">
                  {t('archive_edit_time')}
                </label>
                <input
                  type="time"
                  value={timeDraft}
                  onChange={e => setTimeDraft(e.target.value)}
                  className="w-full text-[12px] font-mono bg-text-main/5 border border-border-subtle rounded px-2 py-1 outline-none mt-0.5"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={commitDateTime}
                  className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-lg bg-brand-soft/15 text-brand-soft hover:bg-brand-soft/25 transition-colors"
                >
                  {t('common_save')}
                </button>
                <button
                  onClick={() => setEditingDateTime(false)}
                  className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-lg border border-border-subtle text-text-main/40 hover:text-text-main/60 transition-colors"
                >
                  {t('common_cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="min-w-0">
        {editingTitle ? (
          <input
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            autoFocus
            onClick={e => e.stopPropagation()}
            className="text-[15px] font-medium text-text-main bg-text-main/5 border border-border-subtle rounded px-2 py-0.5 outline-none w-full"
          />
        ) : (
          <div
            className="text-[15px] font-medium text-text-main leading-snug truncate hover:text-brand-soft transition-colors"
            onClick={e => e.stopPropagation()}
            onDoubleClick={e => { e.stopPropagation(); setTitleDraft(session.title || ''); setEditingTitle(true); }}
            title={t('archive_edit_title_hint')}
          >
            {session.title || t('session_untitled')}
          </div>
        )}
        {session.content && (
          <p className="text-sm text-text-main/55 leading-relaxed line-clamp-1 sm:line-clamp-2 mb-2 cursor-pointer" onClick={onOpen}>
            {session.content.slice(0, 200)}
          </p>
        )}
        <InlineTags
          tags={session.tags || []}
          onChange={(newTags) => onTagsChange?.(session, newTags)}
        />
      </div>

      <div className="flex items-center gap-0.5 shrink-0 pt-1" onClick={e => e.stopPropagation()}>
        <button onClick={e => { e.stopPropagation(); onOpen(); }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-text-main/20 hover:text-text-main/60 hover:bg-text-main/5 transition-all opacity-0 group-hover:opacity-100"
          title={t('archive_preview')}>
          <ExternalLink size={13} />
        </button>
        <StorageIcons
          doc={{
            localId: session._isLocal ? session.id : undefined,
            cloudId: session._linkedCloudId,
            hasLocal: !!session._isLocal,
            hasCloud: !!session._hasCloudCopy,
          }}
          userId={userId}
          onStorageChange={() => onStorageChange?.()}
        />
        <button onClick={e => { e.stopPropagation(); onDelete?.(session); }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-text-main/15 hover:text-red-400 hover:bg-red-400/5 transition-all opacity-0 group-hover:opacity-100"
          title={t('archive_delete')}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export function ArchivePage({ user }: ArchiveViewProps) {
  const { t, language } = useLanguage();
  const [sessions, setSessions] = useState<ArchiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudLoadFailed, setCloudLoadFailed] = useState(false);
  const navigate = useNavigate();
  const [previewSession, setPreviewSession] = useState<ArchiveSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ArchiveSession | null>(null);
  const mountedRef = useRef(true);

  const userId = useUserId(user);

  const sessionsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    sessions.forEach(s => {
      const d = getSessionDate(s);
      if (!d) return;
      const key = format(d, 'yyyy-MM-dd');
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [sessions]);

  const fetchSessions = async (_isRefresh = false) => {
    setLoading(true);
    setError(null);

    try {
      const result = await loadAllSessions(userId, user);
      if (!mountedRef.current) return;
      setSessions(result.sessions as ArchiveSession[]);
      setCloudLoadFailed(result.cloudLoadFailed);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('Archive load error:', err);
      setError(t('archive_load_error'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleDeleteSession = async (s: ArchiveSession) => {
    try {
        await StorageService.deleteDocument(
          userId,
        s._isLocal ? s.id : undefined,
        s._hasCloudCopy ? (s._linkedCloudId || s.id) : undefined
      );
      setSessions(prev => prev.filter(x => x.id !== s.id));
      if (previewSession?.id === s.id) setPreviewSession(null);
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  const handleTagsChange = async (session: ArchiveSession, newTags: string[]) => {
    try {
      if (session._isLocal) {
        await LocalDocumentService.updateTags(session.id, newTags);
      } else if (user) {
        await DocumentService.updateTags(user.uid, session.id, newTags);
      }
      setSessions(prev => prev.map(s =>
        s.id === session.id ? { ...s, tags: newTags } : s
      ));
      if (previewSession?.id === session.id) {
        setPreviewSession(prev => prev ? { ...prev, tags: newTags } : null);
      }
    } catch (e) {
      console.error('Failed to update tags:', e);
    }
  };

  const handleTitleChange = async (session: ArchiveSession, newTitle: string) => {
    try {
      if (session._isLocal) {
        await LocalDocumentService.updateTitle(session.id, newTitle);
        if (session._linkedCloudId && user) {
          await DocumentService.updateTitle(user.uid, session._linkedCloudId, newTitle).catch(() => {});
        }
      } else if (user) {
        await DocumentService.updateTitle(user.uid, session.id, newTitle);
      }
      setSessions(prev => prev.map(s =>
        s.id === session.id ? { ...s, title: newTitle } : s
      ));
      if (previewSession?.id === session.id) {
        setPreviewSession(prev => prev ? { ...prev, title: newTitle } : null);
      }
    } catch (e) {
      console.error('Failed to update title:', e);
    }
  };

  const handleDateChange = async (session: ArchiveSession, newDate: Date) => {
    try {
      const ts = newDate.getTime();
      if (session._isLocal) {
        await LocalDocumentService.updateDate(session.id, ts, ts);
        if (session._linkedCloudId && user) {
          await DocumentService.updateDate(user.uid, session._linkedCloudId, newDate, newDate).catch(() => {});
        }
      } else if (user) {
        await DocumentService.updateDate(user.uid, session.id, newDate, newDate);
      }
      setSessions(prev => prev.map(s =>
        s.id === session.id ? { ...s, createdAt: newDate, sessionStartTime: ts } : s
      ));
    } catch (e) {
      console.error('Failed to update date:', e);
    }
  };

  const { 
    selectedDate, setSelectedDate, 
    selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags,
    filteredSessions: filteredByFilters
  } = useArchiveFilters(sessions);
  const { 
    searchQuery, setSearchQuery, 
    searchedSessions: filteredSessions 
  } = useArchiveSearch(filteredByFilters);
  const [viewMode, setViewMode] = useLocalStorage<'list' | 'grid'>(
    'archive_viewMode',
    'list',
    z.enum(['list', 'grid'])
  );

  const allTags = useMemo(() => Array.from(new Set(sessions.flatMap(s => s.tags || []))), [sessions]);

  const filteredStreakDays = useMemo(() => calculateStreak(filteredByFilters), [filteredByFilters]);

  const statsTitle = useMemo(() => {
    if (selectedTags.length > 0) {
      return t('archive_stats_by_tag') + ' ' + selectedTags.map(t => '#' + t).join(', ');
    }
    if (selectedMonth) {
      return t('archive_stats_by_month') + ' ' + format(selectedMonth, 'LLLL yyyy', { locale: getDateLocale(language) });
    }
    return t('archive_stats_title');
  }, [selectedTags, selectedMonth, t, language]);

  const hasActiveFilter = selectedTags.length > 0 || !!selectedMonth;

  const resetStatsFilter = () => {
    setSelectedTags([]);
    setSelectedMonth(null);
  };

  const groupedSessions = useMemo(() => {
    return filteredSessions.reduce((acc, session) => {
      const d = getSessionDate(session);
      if (!d) return acc;
      const dateKey = format(d, 'yyyy-MM-dd');
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(session);
      return acc;
    }, {} as Record<string, ArchiveSession[]>);
  }, [filteredSessions]);

  const sortedDates = useMemo(() => Object.keys(groupedSessions).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()), [groupedSessions]);

  const dateLocale = getDateLocale(language);

  const entriesLabel = (n: number) =>
    n === 1 ? t('archive_entry_1') :
    n >= 2 && n <= 4 ? t('archive_entry_2') :
    t('archive_entry_5');

  const wordCloudSessions = useMemo(
    () => sessions.slice(0, 50),
    [sessions]
  );

  const wordCloud = useMemo(() => {
    const stopWords = new Set(['и','в','на','с','по','что','это','как','из','он','она','они','мы','вы','я','не','но','а','то','же','бы','за','от','до','так','все','при','уже','или','об','для','его','её','их','мне','мой','моя','мои','нет','да','там','тут','где','когда','если','чтобы','который','которая','которые','которых','был','была','были','есть','быть','было']);

    const freq: Record<string, number> = {};
    wordCloudSessions.forEach(s => {
      const snippet = (s.content || '').slice(0, 500).toLowerCase()
        .replace(/[^а-яёa-z\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));
      snippet.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    });

    return Object.entries(freq)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 30)
      .map(([word, count]) => ({ word, count }));
  }, [wordCloudSessions]);

  const maxCount = Math.max(...wordCloud.map(w => w.count), 1);

  return (
    <AdaptiveContainer>
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="pb-10"
      >
        <div className="flex gap-0 h-full min-w-[320px]">
          {/* List */}
          <div className="flex-1 min-w-0 pr-0 lg:pr-8 overflow-y-auto">
            {/* Header */}
            <div style={{ padding: '24px 0 18px', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <div className="flex items-baseline gap-3 mb-1">
                    <h1 className="text-3xl font-medium tracking-tight text-text-main">
                  {t('nav_notes')}
                </h1>
                <span className="font-mono text-[11px] text-text-main/30 uppercase tracking-widest">
                  {filteredSessions.length} {t('archive_count')}
                </span>
              </div>
              <p className="text-sm text-text-main/40 mb-5">
                {t('archive_subtitle')}
              </p>

              {/* Search + view toggle */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-[440px]">
                  <Search size={14} className="absolute left-3 top-2.5 text-text-main/30" />
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t('archive_search_placeholder')}
                    className="w-full pl-8 pr-10 py-2 bg-text-main/[0.03] border border-border-subtle rounded-lg text-sm text-text-main placeholder:text-text-main/25 outline-none focus:border-border-subtle/60 transition-colors"
                  />
                  <kbd className="absolute right-3 top-2 text-[10px] text-text-main/25 font-mono border border-border-subtle rounded px-1.5 py-0.5">&#8984;K</kbd>
                </div>

                <div className="flex bg-text-main/[0.03] border border-border-subtle rounded-lg p-0.5">
                  {(['list', 'grid'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setViewMode(v)}
                      className={cn(
                        "w-8 h-7 rounded-md flex items-center justify-center transition-all",
                        viewMode === v ? "bg-text-main/10 text-text-main" : "text-text-main/30 hover:text-text-main/60"
                      )}
                      title={v === 'list' ? t('archive_list') : t('archive_grid')}
                      aria-label={v === 'list' ? t('archive_list') : t('archive_grid')}
                    >
                      {v === 'list' ? <LayoutList size={14} /> : <LayoutGrid size={14} />}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Tag bar */}
            {allTags.length > 0 && (
              <div className="flex items-center gap-2 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                <span className="font-mono text-[10px] text-text-main/25 uppercase tracking-widest mr-1">
                  {t('archive_tags_label')}
                </span>
                {allTags.map(tag => {
                  const active = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => setSelectedTags(prev =>
                        prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                      )}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-[11px] font-mono transition-all border",
                        active
                          ? "bg-text-main/10 border-text-main/30 text-text-main"
                          : "bg-transparent border-border-subtle text-text-main/40 hover:text-text-main/60"
                      )}
                    >
                      #{tag}
                    </button>
                  );
                })}
                {selectedTags.length > 0 && (
                  <button
                    onClick={() => setSelectedTags([])}
                    className="px-2.5 py-1 rounded-full text-[11px] font-mono border border-dashed border-border-subtle text-text-main/30 hover:text-text-main/50 transition-all"
                  >
                    {t('archive_tags_reset')} &#10005;
                  </button>
                )}
              </div>
            )}

            {/* Cloud load error */}
            {cloudLoadFailed && (
              <div className="px-4 py-3 rounded-2xl text-sm bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-between mt-4">
                <span>{t('archive_cloud_load_error')}</span>
                <button
                  onClick={() => fetchSessions(true)}
                  className="underline text-red-400/70 hover:text-red-400"
                >
                  {t('retry')}
                </button>
              </div>
            )}

            {/* Sessions */}
            <div className="mt-4 space-y-1">
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-6 py-16">
                  <motion.div
                    animate={{ opacity: [0.7, 1, 0.7] }}
                    transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                    style={{ filter: "drop-shadow(0 0 24px color-mix(in srgb, var(--brand-soft) 40%, transparent))" }}
                  >
                    <JustWritingLogo size={120} variant="dark" showRailway={true} showRoman={true} showCrown={true} />
                  </motion.div>
                  <p className="text-sm text-text-main/35 tracking-widest uppercase font-sans">
                    {t('archive_loading')}
                  </p>
                </div>
              ) : error ? (
                <div className="p-12 text-center rounded-3xl border bg-red-500/10 border-red-500/30">
                  <p className="text-red-400">{error}</p>
                </div>
              ) : filteredSessions.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title={t('archive_empty_title')}
                  description={t('archive_empty_subtitle')}
                />
              ) : (
                sortedDates.map(dateKey => (
                  <div key={dateKey}>
                    {viewMode !== 'grid' && (
                    <div className="flex items-center gap-4 py-4">
                      <h4 className="text-[15px] font-medium text-text-main whitespace-nowrap">
                        {format(new Date(dateKey), 'd MMMM yyyy', { locale: dateLocale })}
                      </h4>
                      <div className="flex-1 h-px bg-border-subtle" />
                      <span className="font-mono text-[11px] text-text-main/35 whitespace-nowrap">
                        {groupedSessions[dateKey].length} {entriesLabel(groupedSessions[dateKey].length)} · {' '}
                        {groupedSessions[dateKey]
                          .reduce((sum, s) => sum + (s.wordCount || 0), 0)
                          .toLocaleString()} {t('home_words_short')}
                      </span>
                    </div>
                    )}
                    {viewMode === 'list' ? (
                      <div className="flex flex-col">
                        {groupedSessions[dateKey].map(session => (
                          <NoteRow
                            key={session.id}
                            session={session}
                            onOpen={() => setPreviewSession(session)}
                            t={t}
                            language={language}
                            onDelete={(s) => setDeleteConfirm(s)}
                            onTagsChange={handleTagsChange}
                            onStorageChange={() => fetchSessions()}
                            onTitleChange={handleTitleChange}
                            onDateChange={handleDateChange}
                            userId={userId}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                        {groupedSessions[dateKey].map(session => (
                          <GridNoteCard 
                            key={session.id} 
                            session={session} 
                            onClick={() => setPreviewSession(session)}
                            searchQuery={searchQuery}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right bar */}
          <div className="hidden lg:flex w-64 shrink-0 border-l border-border-subtle pl-6 flex-col gap-6">
            <div>
              <ArchiveStats
                sessions={filteredByFilters}
                streakDays={filteredStreakDays}
                title={statsTitle}
                onReset={hasActiveFilter ? resetStatsFilter : undefined}
              />
            </div>

            <div className="h-px bg-border-subtle" />

            <div className="text-[11px] font-mono text-text-main/30 uppercase tracking-widest">
              {t('archive_calendar_title')}
            </div>

            <Calendar
              sessions={sessions}
              sessionsByDate={sessionsByDate}
              selectedDate={selectedDate ?? new Date()}
              onSelectDate={setSelectedDate}
              onSelectMonth={setSelectedMonth}
            />

            {wordCloud.length > 0 && (
              <div>
                <div className="font-mono text-[11px] text-text-main/30 uppercase tracking-widest mb-3">
                  {t('archive_wordcloud_title')}
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-1.5">
                  {wordCloud.map(({ word, count }) => {
                    const size = 10 + Math.round((count / maxCount) * 8);
                    const opacity = 0.3 + (count / maxCount) * 0.7;
                    return (
                      <button
                        key={word}
                        onClick={() => setSearchQuery(word)}
                        style={{ fontSize: size, opacity }}
                        className="text-text-main hover:opacity-100 hover:text-text-main transition-all leading-tight"
                      >
                        {word}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Backdrop */}
          {previewSession && (
            <div
              className="fixed inset-0 z-40 bg-black/20"
              onClick={() => setPreviewSession(null)}
            />
          )}

          {/* Preview overlay */}
          <AnimatePresence>
            {previewSession && (
              <DocumentPreview
                session={previewSession}
                onClose={() => setPreviewSession(null)}
                onContinue={(s) => navigate('/', { state: { sessionToContinue: s } })}
                onTagsChange={handleTagsChange}
              />
            )}
          </AnimatePresence>

          {/* Delete confirm dialog */}
          {deleteConfirm && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="bg-surface-card border border-border-subtle rounded-2xl p-6 w-80 shadow-lg">
                <h3 className="text-base font-medium text-text-main mb-2">{t('archive_delete_confirm')}</h3>
                <p className="text-sm text-text-main/40 mb-5">
                  «{deleteConfirm.title || t('session_untitled')}»
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await handleDeleteSession(deleteConfirm);
                      setDeleteConfirm(null);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20"
                  >
                    {t('storage_delete_confirm')}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="flex-1 py-2.5 rounded-xl border border-border-subtle text-text-main/40 text-sm hover:text-text-main"
                  >
                    {t('common_cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AdaptiveContainer>
  );
}
