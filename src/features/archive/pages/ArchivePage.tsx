import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { History, Search, LayoutGrid, LayoutList } from 'lucide-react';
import { Session, UserProfile } from '../../../types';
import { SessionCard } from '../../writing/components/SessionCard';
import { Calendar } from '../../calendar/components/Calendar';
import { getSessionDate, cn } from '../../../core/utils/utils';
import { SessionService } from '../../writing/services/SessionService';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';
import { TagCloud } from '../../writing/components/TagCloud';
import { useLanguage } from '../../../core/i18n';
import { useArchiveFilters } from '../hooks/useArchiveFilters';
import { useArchiveSearch } from '../hooks/useArchiveSearch';

interface ArchiveViewProps {
  user: User;
  profile: UserProfile | null;
  onContinueSession: (session: Session) => void;
}

export function ArchivePage({ user, profile, onContinueSession }: ArchiveViewProps) {
  const { t, language } = useLanguage();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [lastDoc, setLastDoc] = useState<unknown>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = async (isInitial = false) => {
    if (isInitial) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const result = await SessionService.getAllSessions(user.uid, 20, isInitial ? undefined : lastDoc);
      
      if (isInitial) {
        setSessions(result.sessions);
      } else {
        setSessions(prev => [...prev, ...result.sessions]);
      }
      
      setLastDoc(result.lastDoc);
      setHasMore(result.sessions.length === 20);
    } catch (err) {
      console.error('Archive load error:', err);
      setError(t('archive_load_error'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchSessions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

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
    <AdaptiveContainer size="WIDE">
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
              selectedDate={selectedDate || new Date()} 
              onSelectDate={(d) => { setSelectedDate(d); setSelectedMonth(null); }} 
              onSelectMonth={(m) => { setSelectedMonth(m); setSelectedDate(null); }}
            />
            
            <div className="p-6 rounded-3xl space-y-4 transition-all bg-surface-card backdrop-blur-xl border border-border-subtle">
              <div className="flex items-center gap-2 border-b pb-2 border-border-subtle">
                <Search size={18} className="text-text-main/50" />
                <input 
                  type="text" 
                  value={searchQuery} 
                  onChange={e => setSearchQuery(e.target.value)} 
                  placeholder={t('archive_search_placeholder')} 
                  className="w-full bg-transparent outline-none text-sm text-text-main placeholder:text-text-main/30"
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

              <div className="flex p-1 rounded-xl bg-surface-base/10 border border-border-subtle">
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
              
              <div className="space-y-6">
                {loading ? (
                  <div className="italic text-center py-12 text-text-main/70">{t('archive_loading')}</div>
                ) : error ? (
                  <div className="p-12 text-center rounded-3xl border bg-red-500/10 border-red-500/30">
                    <p className="text-red-400">{error}</p>
                  </div>
                ) : sessions.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center justify-center py-24 gap-4 text-center"
                  >
                    <div className="text-5xl mb-2">📖</div>
                    <p className="text-xl font-bold text-text-main">
                      {t('archive_empty_title')}
                    </p>
                    <p className="text-text-main/40 text-sm max-w-xs">
                      {t('archive_empty_subtitle')}
                    </p>
                  </motion.div>
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
                            onContinue={() => onContinueSession(session)}
                            searchQuery={searchQuery}
                            onDeleteSuccess={(id) => setSessions(prev => prev.filter(s => s.id !== id))}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                )}

                {hasMore && !loading && !error && (
                  <div className="flex justify-center pt-8">
                    <button
                      onClick={() => fetchSessions(false)}
                      disabled={loadingMore}
                      className="px-8 py-3 rounded-2xl font-bold transition-all disabled:opacity-50 bg-text-main text-surface-base shadow-lg"
                    >
                      {loadingMore ? t('archive_loading_more') : t('archive_load_more')}
                    </button>
                  </div>
                )}
              </div>
            </div>
        </div>
      </motion.div>
    </AdaptiveContainer>
  );
}
