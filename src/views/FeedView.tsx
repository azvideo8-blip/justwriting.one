import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { onSnapshot, collection, query, where, orderBy, limit } from 'firebase/firestore';
import { Globe } from 'lucide-react';
import { db } from '../lib/firebase';
import { Session } from '../types';
import { SessionCard } from '../components/SessionCard';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { parseFirestoreDate } from '../lib/utils';

export function FeedView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    // Remove orderBy to avoid composite index requirement
    const q = query(
      collection(db, 'sessions'),
      where('isPublic', '==', true),
      limit(100) // Increased limit to allow client-side sorting
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      // Sort client-side
      docs.sort((a, b) => {
        const dateA = parseFirestoreDate(a.createdAt).getTime();
        const dateB = parseFirestoreDate(b.createdAt).getTime();
        return dateB - dateA;
      });
      setSessions(docs.slice(0, 50)); // Keep only top 50 after sorting
      setLoading(false);
    }, (err) => {
      console.error('Feed load error:', err);
      setError('Не удалось загрузить ленту. Пожалуйста, проверьте соединение.');
      setLoading(false);
      try {
        handleFirestoreError(err, OperationType.LIST, 'sessions');
      } catch (e) {
        // Logged to console
      }
    });

    return unsubscribe;
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-3xl mx-auto space-y-8 pb-10"
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
        ) : error ? (
          <div className="p-12 text-center bg-red-50 dark:bg-red-900/10 rounded-3xl border border-red-100 dark:border-red-900/30">
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
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
