import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { format, isSameDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { History, Search, LayoutGrid, LayoutList } from 'lucide-react';
import { db } from '../lib/firebase';
import { Session } from '../types';
import { SessionCard } from '../components/SessionCard';
import { Calendar } from '../components/Calendar';
import { parseFirestoreDate, cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { TagCloud } from '../components/TagCloud';
import { ArchiveLabels } from '../components/archive/ArchiveLabels';

interface ArchiveViewProps {
  user: User;
  profile: any;
  onContinueSession: (session: Session) => void;
}

export function ArchiveView({ user, profile, onContinueSession }: ArchiveViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [selectedMonth, setSelectedMonth] = useState<Date | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => (localStorage.getItem('archive_viewMode') as any) || 'list');
  
  useEffect(() => {
    localStorage.setItem('archive_viewMode', viewMode);
  }, [viewMode]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    
    // Remove orderBy to avoid composite index requirement
    const q = query(
      collection(db, 'sessions'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      // Sort client-side
      docs.sort((a, b) => {
        const dateA = parseFirestoreDate(a.createdAt).getTime();
        const dateB = parseFirestoreDate(b.createdAt).getTime();
        return dateB - dateA;
      });
      setSessions(docs);
      setLoading(false);
    }, (err) => {
      console.error('Archive load error:', err);
      setError('Не удалось загрузить архив. Пожалуйста, проверьте соединение.');
      setLoading(false);
      try {
        handleFirestoreError(err, OperationType.LIST, 'sessions');
      } catch (e) {
        // Error already logged to console by handleFirestoreError
      }
    });

    return unsubscribe;
  }, [user.uid]);

  const allTags = Array.from(new Set(sessions.flatMap(s => s.tags || [])));
  
  const filteredSessions = sessions.filter(s => {
    const sDate = parseFirestoreDate(s.createdAt);
    const matchesDate = !selectedDate || isSameDay(sDate, selectedDate);
    const matchesMonth = !selectedMonth || (sDate.getMonth() === selectedMonth.getMonth() && sDate.getFullYear() === selectedMonth.getFullYear());
    const matchesTags = selectedTags.length === 0 || selectedTags.every(t => s.tags?.includes(t));
    const matchesLabel = !selectedLabelId || s.labelId === selectedLabelId;
    const matchesSearch = !searchQuery || s.content.toLowerCase().includes(searchQuery.toLowerCase()) || s.title?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDate && matchesMonth && matchesTags && matchesLabel && matchesSearch;
  });

  const groupedSessions = filteredSessions.reduce((acc, session) => {
    const date = parseFirestoreDate(session.createdAt);
    const dateKey = format(date, 'yyyy-MM-dd');
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(session);
    return acc;
  }, {} as Record<string, Session[]>);

  const sortedDates = Object.keys(groupedSessions).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-12 pb-10"
    >
      <div className="flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1 space-y-8">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-2xl font-bold dark:text-stone-100 flex items-center gap-2">
              <History size={24} />
              Архив
            </h3>

            <div className="flex bg-stone-100 dark:bg-stone-800 p-1 rounded-xl">
              <button 
                onClick={() => setViewMode('list')}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  viewMode === 'list' ? "bg-white dark:bg-stone-900 shadow-sm text-stone-900 dark:text-white" : "text-stone-400"
                )}
                title="Список"
              >
                <LayoutList size={18} />
              </button>
              <button 
                onClick={() => setViewMode('grid')}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  viewMode === 'grid' ? "bg-white dark:bg-stone-900 shadow-sm text-stone-900 dark:text-white" : "text-stone-400"
                )}
                title="Сетка"
              >
                <LayoutGrid size={18} />
              </button>
            </div>
          </div>
            
            <div className="space-y-6">
              {loading ? (
                <div className="text-stone-400 italic text-center py-12">Загрузка архива...</div>
              ) : error ? (
                <div className="p-12 text-center bg-red-50 dark:bg-red-900/10 rounded-3xl border border-red-100 dark:border-red-900/30">
                  <p className="text-red-600 dark:text-red-400">{error}</p>
                </div>
              ) : sortedDates.length === 0 ? (
                <div className="p-12 text-center bg-stone-50 dark:bg-stone-900/50 rounded-3xl border-2 border-dashed border-stone-200 dark:border-stone-800">
                  <p className="text-stone-400">Сессий не найдено</p>
                </div>
              ) : (
                sortedDates.map(dateKey => (
                  <div key={dateKey} className="space-y-4">
                    <h4 className="text-lg font-bold text-stone-500">{format(new Date(dateKey), 'd MMMM yyyy', { locale: ru })}</h4>
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
          
          <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800 space-y-4">
            <div className="flex items-center gap-2 border-b border-stone-200 dark:border-stone-800 pb-2">
              <Search size={18} className="text-stone-400" />
              <input 
                type="text" 
                value={searchQuery} 
                onChange={e => setSearchQuery(e.target.value)} 
                placeholder="Поиск по архиву..." 
                className="w-full bg-transparent outline-none text-sm"
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
