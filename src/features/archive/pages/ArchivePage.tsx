import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { Search, LayoutGrid, LayoutList, BookOpen, HardDrive, Cloud, Trash2, ExternalLink } from 'lucide-react';
import { Session, UserProfile, Document } from '../../../types';
import { SessionCard } from '../../writing/components/SessionCard';
import { getSessionDate, cn } from '../../../core/utils/utils';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { LocalVersionService } from '../../writing/services/LocalVersionService';
import { DocumentService } from '../../writing/services/DocumentService';
import { VersionService } from '../../writing/services/VersionService';
import { SessionService } from '../../writing/services/SessionService';
import { StorageService } from '../../writing/services/StorageService';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { z } from 'zod';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';
import { Calendar } from '../../calendar/components/Calendar';
import { useLanguage } from '../../../core/i18n';
import { useArchiveFilters } from '../hooks/useArchiveFilters';
import { useArchiveSearch } from '../hooks/useArchiveSearch';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../../../shared/components/EmptyState';
import { DocumentPreview } from '../components/DocumentPreview';
import { ArchiveStats, calculateStreak } from '../components/ArchiveStats';
import { InlineTags } from '../components/InlineTags';

interface ArchiveSession extends Session {
  _linkedCloudId?: string;
  _hasCloudCopy?: boolean;
}

interface ArchiveViewProps {
  user: User | null;
  profile: UserProfile | null;
}

function NoteRow({ session, onOpen, t, onToggleLocal, onToggleCloud, onDelete, onTagsChange }: {
  session: ArchiveSession;
  onOpen: () => void;
  t: (key: string) => string;
  onToggleLocal?: (session: ArchiveSession) => void;
  onToggleCloud?: (session: ArchiveSession) => void;
  onDelete?: (session: ArchiveSession) => void;
  onTagsChange?: (session: ArchiveSession, tags: string[]) => void;
}) {
  const date = getSessionDate(session);
  const dateLabel = date
    ? `${date.getDate()} ${['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'][date.getMonth()]} ${String(date.getFullYear()).slice(2)}`
    : '—';

  const timeStr = (() => {
    if (session.sessionStartTime) return new Date(session.sessionStartTime).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    const d = session.createdAt;
    if (d instanceof Date) return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    if (typeof d === 'object' && d !== null && typeof (d as { toDate?: () => Date }).toDate === 'function') {
      return (d as { toDate: () => Date }).toDate().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    }
    return '00:00';
  })();

  return (
    <div
      className="grid items-start gap-3 px-3 py-4 rounded-xl hover:bg-text-main/[0.025] transition-colors group border border-transparent hover:border-border-subtle"
      style={{ gridTemplateColumns: '72px 1fr auto' }}
    >
      <div className="shrink-0">
        <div className="font-mono text-[11px] text-text-main/50 uppercase tracking-wide leading-tight">
          {dateLabel}
        </div>
        <div className="font-mono text-[11px] text-text-main/30 mt-0.5">
          {timeStr}
        </div>
      </div>

      <div className="min-w-0 cursor-pointer" onClick={onOpen}>
        <div className="text-[15px] font-medium text-text-main leading-snug truncate">
          {session.title || t('session_untitled')}
        </div>
        {session.content && (
          <p className="text-sm text-text-main/55 leading-relaxed line-clamp-1 sm:line-clamp-2 mb-2">
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
        <button onClick={e => { e.stopPropagation(); if (session._hasCloudCopy) onToggleCloud?.(session); }}
          className={cn("w-7 h-7 flex items-center justify-center rounded-lg transition-all",
            session._hasCloudCopy
              ? "text-blue-400/60 hover:text-red-400 hover:bg-red-400/5"
              : "text-text-main/15 cursor-default")}
          title={session._hasCloudCopy ? t('storage_remove_cloud') : t('storage_no_cloud')}>
          <Cloud size={13} />
        </button>
        <button onClick={e => { e.stopPropagation(); onToggleLocal?.(session); }}
          className={cn("w-7 h-7 flex items-center justify-center rounded-lg transition-all",
            session._isLocal
              ? "text-text-main/40 hover:text-red-400 hover:bg-red-400/5"
              : "text-text-main/15 cursor-default")}
          title={session._isLocal ? t('storage_remove_local') : t('storage_no_local')}>
          <HardDrive size={13} />
        </button>
        <button onClick={e => { e.stopPropagation(); onDelete?.(session); }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-text-main/15 hover:text-red-400 hover:bg-red-400/5 transition-all opacity-0 group-hover:opacity-100"
          title={t('archive_delete')}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export type { ArchiveSession };

export function ArchivePage({ user, profile }: ArchiveViewProps) {
  const { t, language } = useLanguage();
  const [sessions, setSessions] = useState<ArchiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudLoadFailed, setCloudLoadFailed] = useState(false);
  const navigate = useNavigate();
  const [previewSession, setPreviewSession] = useState<ArchiveSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ArchiveSession | null>(null);

  const userId = user?.uid ?? getOrCreateGuestId();

  const streakDays = useMemo(() => calculateStreak(sessions), [sessions]);

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
    setCloudLoadFailed(false);
    const controller = new AbortController();

    try {
      const allSessions: ArchiveSession[] = [];
      const seenIds = new Set<string>();

      const guestId = getOrCreateGuestId();
      const idsToQuery = user ? [user.uid, guestId] : [guestId];

      for (const uid of idsToQuery) {
        const localDocs = await LocalDocumentService.getGuestDocuments(uid);
        const localByCloudId = new Set(localDocs.filter(d => d.linkedCloudId).map(d => d.linkedCloudId!));

        for (const doc of localDocs) {
          if (seenIds.has(doc.id)) continue;
          seenIds.add(doc.id);
          const content = await LocalVersionService.getLatestContent(doc.id);
          const versions = await LocalVersionService.getVersions(doc.id);
          const firstVersion = versions[0];
          const createdAt = firstVersion
            ? new Date(firstVersion.sessionStartedAt)
            : new Date(doc.firstSessionAt);
          allSessions.push({
            id: doc.id,
            userId: doc.guestId,
            authorName: '',
            authorPhoto: '',
            content,
            duration: doc.totalDuration,
            wordCount: doc.totalWords,
            charCount: 0,
            wpm: 0,
            title: doc.title,
            tags: doc.tags,
            createdAt,
            sessionStartTime: firstVersion ? firstVersion.sessionStartedAt : doc.firstSessionAt,
            _isLocal: true,
            _linkedCloudId: doc.linkedCloudId || undefined,
            _hasCloudCopy: !!doc.linkedCloudId,
          });
        }

        if (user && uid === user.uid) {
          let cloudDocs: Document[] = [];
          try {
            cloudDocs = await DocumentService.getUserDocuments(uid);
          } catch (e) {
            setCloudLoadFailed(true);
            console.error(`Failed to fetch cloud docs for uid=${uid}:`, e);
          }

          for (const cloudDoc of cloudDocs) {
            if (localByCloudId.has(cloudDoc.id) || seenIds.has(cloudDoc.id)) continue;
            seenIds.add(cloudDoc.id);

            const created = (cloudDoc.firstSessionAt as { toDate?: () => Date })?.toDate?.() ?? new Date();
            let cloudContent = '';
            try {
              cloudContent = await VersionService.getLatestContent(user.uid, cloudDoc.id);
            } catch { /* ignore */ }
            allSessions.push({
              id: cloudDoc.id,
              userId: user.uid,
              authorName: '',
              authorPhoto: '',
              content: cloudContent,
              duration: cloudDoc.totalDuration,
              wordCount: cloudDoc.totalWords,
              charCount: 0,
              wpm: 0,
              title: cloudDoc.title,
              tags: cloudDoc.tags,
              createdAt: created,
              sessionStartTime: created.getTime(),
              _isLocal: false,
              _linkedCloudId: cloudDoc.id,
              _hasCloudCopy: true,
            });
          }
        }
      }

      if (user) {
        try {
          const { sessions: legacySessions } = await SessionService.getAllSessions(user.uid, 500);
          for (const s of legacySessions) {
            if (seenIds.has(s.id)) continue;
            seenIds.add(s.id);
            allSessions.push({ ...s, _isLocal: false });
          }
        } catch (e) {
          console.error('Failed to fetch legacy sessions:', e);
        }
      }

      allSessions.sort((a, b) => {
        const toMs = (d: Date | { toDate?: () => Date } | undefined): number => {
          if (d instanceof Date) return d.getTime();
          if (d && typeof d === 'object' && 'toDate' in d) return (d as { toDate: () => Date }).toDate().getTime();
          return 0;
        };
        return toMs(b.createdAt) - toMs(a.createdAt);
      });

      setSessions(allSessions);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Archive load error:', err);
      setError(t('archive_load_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleToggleLocal = async (s: ArchiveSession) => {
    if (!s._isLocal) return;
    try {
      await StorageService.removeLocalCopy(s.id);
      setSessions(prev => prev.filter(x => x.id !== s.id));
      if (previewSession?.id === s.id) setPreviewSession(null);
    } catch (e) {
      console.error('Failed to remove local copy:', e);
    }
  };

  const handleToggleCloud = async (s: ArchiveSession) => {
    if (!s._hasCloudCopy || !user) return;
    try {
      const cloudId = s._linkedCloudId || s.id;
      await StorageService.removeCloudCopy(user.uid, cloudId, s._isLocal ? s.id : undefined);
      setSessions(prev => prev.map(x => x.id === s.id ? { ...x, _hasCloudCopy: false, _linkedCloudId: undefined } : x));
    } catch (e) {
      console.error('Failed to remove cloud copy:', e);
    }
  };

  const handleDeleteSession = async (s: ArchiveSession) => {
    try {
      await StorageService.deleteDocument(
        user?.uid ?? getOrCreateGuestId(),
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

  const { 
    selectedDate, setSelectedDate, 
    setSelectedMonth, 
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

  const dateLocale = language === 'ru' ? ru : enUS;

  const entriesLabel = (n: number) =>
    n === 1 ? t('archive_entry_1') :
    n >= 2 && n <= 4 ? t('archive_entry_2') :
    t('archive_entry_5');

  const wordCloud = useMemo(() => {
    const stopWords = new Set(['и','в','на','с','по','что','это','как','из','он','она','они','мы','вы','я','не','но','а','то','же','бы','за','от','до','так','все','при','уже','или','об','для','его','её','их','мне','мой','моя','мои','нет','да','там','тут','где','когда','если','чтобы','который','которая','которые','которых','был','была','были','есть','быть','было']);

    const freq: Record<string, number> = {};
    sessions.forEach(s => {
      const words = (s.content || '').toLowerCase()
        .replace(/[^а-яёa-z\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));
      words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    });

    return Object.entries(freq)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 30)
      .map(([word, count]) => ({ word, count }));
  }, [sessions]);

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
                  <kbd className="absolute right-3 top-2 text-[10px] text-text-main/25 font-mono border border-border-subtle rounded px-1">&#8984;K</kbd>
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
                <div className="italic text-center py-12 text-text-main/70">{t('archive_loading')}</div>
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

                    {viewMode === 'list' ? (
                      <div className="flex flex-col">
                        {groupedSessions[dateKey].map(session => (
                          <NoteRow
                            key={session.id}
                            session={session}
                            onOpen={() => setPreviewSession(session)}
                            t={t}
                            onToggleLocal={(s) => handleToggleLocal(s)}
                            onToggleCloud={(s) => handleToggleCloud(s)}
                            onDelete={(s) => setDeleteConfirm(s)}
                            onTagsChange={handleTagsChange}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                        {groupedSessions[dateKey].map(session => (
                          <SessionCard 
                            key={session.id} 
                            session={session} 
                            labels={profile?.labels || []}
                            onContinue={() => navigate('/', { state: { sessionToContinue: session } })}
                            searchQuery={searchQuery}
                            onDeleteSuccess={(id) => {
                              setSessions(prev => prev.filter(s => s.id !== id));
                              if (previewSession?.id === id) setPreviewSession(null);
                            }}
                            userId={user?.uid}
                            linkedCloudId={session._linkedCloudId}
                            hasCloudCopy={session._hasCloudCopy}
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
            <div className="text-[11px] font-mono text-text-main/30 uppercase tracking-widest pt-1">
              {t('archive_sidebar_title')}
            </div>

            <div>
              <ArchiveStats sessions={sessions} streakDays={streakDays} />
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
