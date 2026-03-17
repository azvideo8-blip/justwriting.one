import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { format, isSameDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { History } from 'lucide-react';
import { db } from '../lib/firebase';
import { Session } from '../types';
import { SessionCard } from '../components/SessionCard';
import { Calendar } from '../components/Calendar';
import { parseFirestoreDate } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

interface ArchiveViewProps {
  user: User;
}

export function ArchiveView({ user }: ArchiveViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'sessions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      setSessions(docs);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'sessions');
    });

    return unsubscribe;
  }, [user.uid]);

  const allTags = Array.from(new Set(sessions.flatMap(s => s.tags || [])));
  const sessionsOnSelectedDate = sessions.filter(s => {
    const sDate = parseFirestoreDate(s.createdAt);
    return isSameDay(sDate, selectedDate);
  });

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-12 pb-20"
    >
      <div className="flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1 space-y-8">
          <div className="space-y-6">
            <h3 className="text-2xl font-bold dark:text-stone-100 flex items-center gap-2">
              <History size={24} />
              Сессии за {format(selectedDate, 'd MMMM', { locale: ru })}
            </h3>
            
            <div className="space-y-6">
              {loading ? (
                <div className="text-stone-400 italic text-center py-12">Загрузка архива...</div>
              ) : sessionsOnSelectedDate.length === 0 ? (
                <div className="p-12 text-center bg-stone-50 dark:bg-stone-900/50 rounded-3xl border-2 border-dashed border-stone-200 dark:border-stone-800">
                  <p className="text-stone-400">В этот день вы не писали</p>
                </div>
              ) : (
                sessionsOnSelectedDate.map(session => (
                  <SessionCard key={session.id} session={session} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full md:w-80 shrink-0 space-y-8">
          <Calendar sessions={sessions} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          
          <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
            <h3 className="font-bold dark:text-stone-100">Облако тегов</h3>
            <div className="flex flex-wrap gap-2">
              {allTags.length === 0 ? (
                <span className="text-stone-400 text-sm italic">Тегов пока нет</span>
              ) : (
                allTags.map(tag => (
                  <span key={tag} className="px-3 py-1 bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-400 rounded-full text-xs font-medium border border-stone-100 dark:border-stone-700">
                    #{tag}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
