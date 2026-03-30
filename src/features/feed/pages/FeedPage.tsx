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
  const [lastDoc, setLastDoc] = useState<any>(null);
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
      const result = await SessionService.getPublicSessions(20, isInitial ? undefined : lastDoc);
      
      if (isInitial) {
        setSessions(result.sessions);
      } else {
        setSessions(prev => [...prev, ...result.sessions]);
      }
      
      setLastDoc(result.lastDoc);
      setHasMore(result.sessions.length === 20);
    } catch (err) {
      console.error('Feed load error:', err);
      setError(t('community_load_error'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchSessions(true);
  }, []);

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
          <div className={cn("italic text-center py-12", isV2 ? "text-white/70" : "text-stone-400")}>{t('community_loading')}</div>
        ) : error ? (
          <div className={cn("p-12 text-center rounded-3xl border", isV2 ? "bg-red-500/10 border-red-500/30" : "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30")}>
            <p className={cn(isV2 ? "text-red-400" : "text-red-600 dark:text-red-400")}>{error}</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className={cn("p-12 text-center rounded-3xl border", isV2 ? "bg-white/5 border-white/10" : "bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800")}>
            <p className={cn(isV2 ? "text-white/70" : "text-stone-400")}>{t('community_empty')}</p>
          </div>
        ) : (
          <>
            {sessions.map(session => (
              <SessionCard key={session.id} session={session} />
            ))}
            
            {hasMore && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => fetchSessions(false)}
                  disabled={loadingMore}
                  className={cn(
                    "px-8 py-3 rounded-2xl font-bold transition-all disabled:opacity-50",
                    isV2 
                      ? "bg-white/10 text-white hover:bg-white/20 border border-white/10" 
                      : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-lg"
                  )}
                >
                  {loadingMore ? t('archive_loading_more') : t('archive_load_more')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
