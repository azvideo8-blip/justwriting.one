import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  collection, query, where, orderBy, onSnapshot, limit 
} from 'firebase/firestore';
import { Globe } from 'lucide-react';
import { db } from '../lib/firebase';
import { Session } from '../types';
import { SessionCard } from '../components/SessionCard';

export function FeedView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'sessions'),
      where('isPublic', '==', true),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      setSessions(docs);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-3xl mx-auto space-y-8 pb-20"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold dark:text-stone-100 flex items-center gap-3">
          <Globe className="text-emerald-500" /> Лента
        </h2>
        <span className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">Публичные сессии</span>
      </div>

      <div className="space-y-8">
        {loading ? (
          <div className="text-stone-400 italic text-center py-12">Загрузка ленты...</div>
        ) : sessions.length === 0 ? (
          <div className="p-12 text-center bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800">
            <p className="text-stone-400">Лента пока пуста. Будьте первым, кто поделится своей сессией!</p>
          </div>
        ) : (
          sessions.map(session => (
            <SessionCard key={session.id} session={session} />
          ))
        )}
      </div>
    </motion.div>
  );
}
