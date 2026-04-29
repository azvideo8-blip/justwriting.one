import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { History, Search, LayoutGrid, LayoutList, BookOpen } from 'lucide-react';
import { Session, UserProfile, Document } from '../../../types';
import { SessionCard } from '../../writing/components/SessionCard';
import { getSessionDate, cn } from '../../../core/utils/utils';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { LocalVersionService } from '../../writing/services/LocalVersionService';
import { DocumentService } from '../../writing/services/DocumentService';
import { VersionService } from '../../writing/services/VersionService';
import { StorageService } from '../../writing/services/StorageService';
import { SessionService } from '../../writing/services/SessionService';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';
import { TagCloud } from '../../writing/components/TagCloud';
import { Calendar } from '../../calendar/components/Calendar';
import { useLanguage } from '../../../core/i18n';
import { useArchiveFilters } from '../hooks/useArchiveFilters';
import { useArchiveSearch } from '../hooks/useArchiveSearch';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../../../shared/components/EmptyState';

interface ArchiveViewProps {
  user: User | null;
  profile: UserProfile | null;
}

export function ArchivePage({ user, profile }: ArchiveViewProps) {
  const { t, language } = useLanguage();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudLoadFailed, setCloudLoadFailed] = useState(false);
  const navigate = useNavigate();

  const userId = user?.uid ?? getOrCreateGuestId();

  const fetchSessions = async (isRefresh = false) => {
    setLoading(true);
    setError(null);
    setCloudLoadFailed(false);
    const controller = new AbortController();

    try {
      const allSessions: Session[] = [];
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
            isPublic: false,
            title: doc.title,
            tags: doc.tags,
            createdAt: new Date(doc.lastSessionAt),
            _isLocal: true,
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

            let localId: string | undefined;
            try {
              localId = await StorageService.addLocalCopy(uid, cloudDoc.id);
            } catch (e) {
              console.error(`Failed to import cloud doc ${cloudDoc.id}:`, e);
            }

            const content = localId
              ? await LocalVersionService.getLatestContent(localId)
              : '';

            const sid = localId || cloudDoc.id;
            if (seenIds.has(sid) && sid !== cloudDoc.id) continue;
            seenIds.add(sid);

            allSessions.push({
              id: sid,
              userId: user.uid,
              authorName: '',
              authorPhoto: '',
              content,
              duration: cloudDoc.totalDuration,
              wordCount: cloudDoc.totalWords,
              charCount: 0,
              wpm: 0,
              isPublic: cloudDoc.isPublic,
              title: cloudDoc.title,
              tags: cloudDoc.tags,
              createdAt: (cloudDoc.lastSessionAt as { toDate?: () => Date })?.toDate?.() ?? new Date(),
              _isLocal: !!localId,
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
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => (localStorage.getItem('archive_viewMode') as 'list' | 'grid') || 'list');
  
  useEffect(() => {
    localStorage.setItem('archive_viewMode', viewMode);
  }, [viewMode]);

  const allTags = useMemo(() => Array.from(new Set(sessions.flatMap(s => s.tags || []))), [sessions]);
  
  const groupedSessions = useMemo(() => {
    return filteredSessions.reduce((acc, session) => {
      const date = getSessionDate(session);
      const dateKey = format(date, 'yyyy-MM-dd');
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(session);
      return acc;
    }, {} as Record<string, Session[]>);
  }, [filteredSessions]);

  const sortedDates = useMemo(() => Object.keys(groupedSessions).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()), [groupedSessions]);

  const dateLocale = language === 'ru' ? ru : enUS;

  return (
    <AdaptiveContainer>
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-12 pb-10"
      >
        <div className="flex flex-col md:flex-row gap-8 items-start">
          {/* Sidebar — appears first on mobile via order-first, second on desktop */}
          <div className="w-full md:w-80 shrink-0 space-y-8 order-first md:order-last">
            <Calendar
              sessions={sessions}
              selectedDate={selectedDate ?? new Date()}
              onSelectDate={setSelectedDate}
              onSelectMonth={setSelectedMonth}
            />

            <div className="p-6 rounded-3xl space-y-4 transition-all bg-surface-card backdrop-blur-xl border border-border-subtle">
              <div className="flex items-center gap-2 border-b pb-2 border-border-subtle">
                <Search size={18} className="text-text-main/50" />
                <input 
                  type="text" 
                  value={searchQuery} 
                  onChange={e => setSearchQuery(e.target.value)} 
                  placeholder={t('archive_search_placeholder')} 
                  className="w-full bg-transparent outline-none text-sm text-text-main placeholder:text-text-main/40"
                />
              </div>
            </div>

            <TagCloud 
              tags={allTags} 
              selectedTags={selectedTags} 
              onToggleTag={(tag) => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])} 
            />
          </div>

          {/* Sessions list — appears second on mobile, first on desktop */}
          <div className="flex-1 space-y-8 order-last md:order-first">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-2xl font-bold flex items-center gap-2 text-text-main">
                <History size={24} />
                {t('nav_notes')}
              </h3>

              <div className="flex p-1 rounded-2xl bg-surface-base/10 border border-border-subtle">
                <button 
                  onClick={() => setViewMode('list')}
                  className={cn(
                    "p-2 rounded-lg transition-all",
                    viewMode === 'list' 
                      ? "bg-surface-base/20 text-text-main shadow-sm" 
                      : "text-text-main/50 hover:text-text-main"
                  )}
                  title={t('archive_list')}
                  aria-label={t('archive_list')}
                >
                  <LayoutList size={18} />
                </button>
                <button 
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    "p-2 rounded-lg transition-all",
                    viewMode === 'grid' 
                      ? "bg-surface-base/20 text-text-main shadow-sm" 
                      : "text-text-main/50 hover:text-text-main"
                  )}
                  title={t('archive_grid')}
                  aria-label={t('archive_grid')}
                >
                  <LayoutGrid size={18} />
                </button>
              </div>
            </div>

              {cloudLoadFailed && (
                <div className="px-4 py-3 rounded-2xl text-sm bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-between">
                  <span>{t('archive_cloud_load_error')}</span>
                  <button
                    onClick={() => fetchSessions(true)}
                    className="underline text-red-400/70 hover:text-red-400"
                  >
                    {t('retry')}
                  </button>
                </div>
              )}

              <div className="space-y-6">
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
                    <div key={dateKey} className="space-y-4">
                      <h4 className="text-lg font-bold text-text-main/70">{format(new Date(dateKey), 'd MMMM yyyy', { locale: dateLocale })}</h4>
                      <div className={cn(
                        "gap-6",
                        viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2" : "flex flex-col"
                      )}>
                        {groupedSessions[dateKey].map(session => (
                          <SessionCard 
                            key={session.id} 
                            session={session} 
                            labels={profile?.labels || []}
                            onContinue={() => navigate('/', { state: { sessionToContinue: session } })}
                            searchQuery={searchQuery}
                            onDeleteSuccess={(id) => setSessions(prev => prev.filter(s => s.id !== id))}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                 )}
               </div>
            </div>
        </div>
      </motion.div>
    </AdaptiveContainer>
  );
}
