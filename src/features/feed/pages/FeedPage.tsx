import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Globe } from 'lucide-react';
import { Session } from '../../../types';
import { SessionCard } from '../../writing/components/SessionCard';
import { SessionService } from '../../writing/services/SessionService';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { parseFirestoreDate, cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { useUI } from '../../../contexts/UIContext';

export function FeedPage() {
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsubscribe = SessionService.subscribeToPublicSessions(
      (docs) => {
        // Sort client-side
        docs.sort((a, b) => {
          const dateA = parseFirestoreDate(a.createdAt).getTime();
          const dateB = parseFirestoreDate(b.createdAt).getTime();
          return dateB - dateA;
        });
        setSessions(docs.slice(0, 50)); // Keep only top 50 after sorting
        setLoading(false);
      },
      (err) => {
        console.error('Feed load error:', err);
        setError(t('community_load_error'));
        setLoading(false);
        try {
          handleFirestoreError(err, OperationType.LIST, 'sessions');
        } catch (e) {
          // Logged to console
        }
      }
    );

    return unsubscribe;
  }, [t]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-3xl mx-auto space-y-8 pb-10"
    >
      <div className="flex items-center justify-between">
        <h2 className={cn("text-3xl font-bold flex items-center gap-3", isV2 ? "text-white" : "dark:text-stone-100")}>
          <Globe className={isV2 ? "text-emerald-400" : "text-emerald-500"} /> {t('nav_community')}
        </h2>
        <span className={cn("text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400 dark:text-stone-500")}>{t('community_subtitle')}</span>
      </div>

      <div className="space-y-8">
        {loading ? (
          <div className={cn("italic text-center py-12", isV2 ? "text-white/50" : "text-stone-400")}>{t('community_loading')}</div>
        ) : error ? (
          <div className={cn("p-12 text-center rounded-3xl border", isV2 ? "bg-red-500/10 border-red-500/30" : "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30")}>
            <p className={cn(isV2 ? "text-red-400" : "text-red-600 dark:text-red-400")}>{error}</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className={cn("p-12 text-center rounded-3xl border", isV2 ? "bg-white/5 border-white/10" : "bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800")}>
            <p className={cn(isV2 ? "text-white/50" : "text-stone-400")}>{t('community_empty')}</p>
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
