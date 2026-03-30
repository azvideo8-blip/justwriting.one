import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { format, isSameDay } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { History, Search, LayoutGrid, LayoutList } from 'lucide-react';
import { Session } from '../../../types';
import { SessionCard } from '../../writing/components/SessionCard';
import { Calendar } from '../../calendar/components/Calendar';
import { parseFirestoreDate, cn } from '../../../core/utils/utils';
import { SessionService } from '../../writing/services/SessionService';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { TagCloud } from '../../writing/components/TagCloud';
import { useLanguage } from '../../../core/i18n';
import { useArchiveFilters } from '../hooks/useArchiveFilters';
import { useArchiveSearch } from '../hooks/useArchiveSearch';
import { useUI } from '../../../contexts/UIContext';

interface ArchiveViewProps {
  user: User;
  profile: any;
  onContinueSession: (session: Session) => void;
}

export function ArchivePage({ user, profile, onContinueSession }: ArchiveViewProps) {
  const { t, language } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';
  const [sessions, setSessions] = useState<Session[]>([]);
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
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => (localStorage.getItem('archive_viewMode') as any) || 'list');
  
  useEffect(() => {
    localStorage.setItem('archive_viewMode', viewMode);
  }, [viewMode]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    
    const unsubscribe = SessionService.subscribeToSessions(
      user.uid,
      (docs) => {
        docs.sort((a, b) => {
          const dateA = parseFirestoreDate(a.createdAt).getTime();
          const dateB = parseFirestoreDate(b.createdAt).getTime();
          return dateB - dateA;
        });
        setSessions(docs);
        setLoading(false);
      },
      (err) => {
        console.error('Archive load error:', err);
        setError(t('archive_load_error'));
        setLoading(false);
        try {
          handleFirestoreError(err, OperationType.LIST, 'sessions');
        } catch (e) {
          // Error already logged to console by handleFirestoreError
        }
      }
    );

    return unsubscribe;
  }, [user.uid, t]);

  const allTags = useMemo(() => Array.from(new Set(sessions.flatMap(s => s.tags || []))), [sessions]);
  
  const groupedSessions = useMemo(() => {
    return filteredSessions.reduce((acc, session) => {
      const date = parseFirestoreDate(session.createdAt);
      const dateKey = format(date, 'yyyy-MM-dd');
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(session);
      return acc;
    }, {} as Record<string, Session[]>);
  }, [filteredSessions]);

  const sortedDates = useMemo(() => Object.keys(groupedSessions).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()), [groupedSessions]);

  const dateLocale = language === 'ru' ? ru : enUS;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-12 pb-10"
    >
      <div className="flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1 space-y-8">
          <div className="flex items-center justify-between gap-4">
            <h3 className={cn("text-2xl font-bold flex items-center gap-2", isV2 ? "text-white" : "dark:text-stone-100")}>
              <History size={24} />
              {t('nav_notes')}
            </h3>

            <div className={cn("flex p-1 rounded-xl", isV2 ? "bg-white/5 border border-white/10" : "bg-stone-100 dark:bg-stone-800")}>
              <button 
                onClick={() => setViewMode('list')}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  viewMode === 'list' 
                    ? (isV2 ? "bg-white/20 text-white shadow-sm" : "bg-white dark:bg-stone-900 shadow-sm text-stone-900 dark:text-white") 
                    : (isV2 ? "text-white/50 hover:text-white" : "text-stone-400")
                )}
                title={t('archive_list')}
              >
                <LayoutList size={18} />
              </button>
              <button 
                onClick={() => setViewMode('grid')}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  viewMode === 'grid' 
                    ? (isV2 ? "bg-white/20 text-white shadow-sm" : "bg-white dark:bg-stone-900 shadow-sm text-stone-900 dark:text-white") 
                    : (isV2 ? "text-white/50 hover:text-white" : "text-stone-400")
                )}
                title={t('archive_grid')}
              >
                <LayoutGrid size={18} />
              </button>
            </div>
          </div>
            
            <div className="space-y-6">
              {loading ? (
                <div className={cn("italic text-center py-12", isV2 ? "text-white/50" : "text-stone-400")}>{t('archive_loading')}</div>
              ) : error ? (
                <div className={cn("p-12 text-center rounded-3xl border", isV2 ? "bg-red-500/10 border-red-500/30" : "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30")}>
                  <p className={cn(isV2 ? "text-red-400" : "text-red-600 dark:text-red-400")}>{error}</p>
                </div>
              ) : sortedDates.length === 0 ? (
                <div className={cn("p-12 text-center rounded-3xl border-2 border-dashed", isV2 ? "bg-white/5 border-white/10" : "bg-stone-50 dark:bg-stone-900/50 border-stone-200 dark:border-stone-800")}>
                  <p className={cn(isV2 ? "text-white/50" : "text-stone-400")}>{t('archive_empty')}</p>
                </div>
              ) : (
                sortedDates.map(dateKey => (
                  <div key={dateKey} className="space-y-4">
                    <h4 className={cn("text-lg font-bold", isV2 ? "text-white/70" : "text-stone-500")}>{format(new Date(dateKey), 'd MMMM yyyy', { locale: dateLocale })}</h4>
                    <div className={cn(
                      "gap-4",
                      viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2" : "flex flex-col"
                    )}>
                      {groupedSessions[dateKey].map(session => (
                        <SessionCard 
                          key={session.id} 
                          session={session} 
                          labels={profile?.labels || []}
                          onContinue={() => onContinueSession(session)}
                          searchQuery={searchQuery}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        {/* Sidebar */}
        <div className="w-full md:w-80 shrink-0 space-y-8">
          <Calendar 
            sessions={sessions} 
            selectedDate={selectedDate || new Date()} 
            onSelectDate={(d) => { setSelectedDate(d); setSelectedMonth(null); }} 
            onSelectMonth={(m) => { setSelectedMonth(m); setSelectedDate(null); }}
          />
          
          <div className={cn(
            "p-6 rounded-3xl space-y-4 transition-all",
            isV2 
              ? "bg-white/5 backdrop-blur-xl border border-white/10 text-[#E5E5E0]" 
              : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800"
          )}>
            <div className={cn("flex items-center gap-2 border-b pb-2", isV2 ? "border-white/10" : "border-stone-200 dark:border-stone-800")}>
              <Search size={18} className={isV2 ? "text-white/50" : "text-stone-400"} />
              <input 
                type="text" 
                value={searchQuery} 
                onChange={e => setSearchQuery(e.target.value)} 
                placeholder={t('archive_search_placeholder')} 
                className={cn("w-full bg-transparent outline-none text-sm", isV2 ? "text-white placeholder:text-white/30" : "placeholder:text-stone-400")}
              />
            </div>
          </div>

          <TagCloud 
            tags={allTags} 
            selectedTags={selectedTags} 
            onToggleTag={(tag) => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])} 
          />

          {/* 
          <ArchiveLabels 
            user={user} 
            profile={profile} 
            selectedLabelId={selectedLabelId} 
            onSelectLabel={setSelectedLabelId} 
          />
          */}
        </div>
      </div>
    </motion.div>
  );
}
