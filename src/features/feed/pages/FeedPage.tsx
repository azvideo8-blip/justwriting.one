import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Globe } from 'lucide-react';
import { Session } from '../../../types';
import { SessionCard } from '../../writing/components/SessionCard';
import { SessionService } from '../../writing/services/SessionService';
import { useLanguage } from '../../../core/i18n';

export function FeedPage() {
  const { t } = useLanguage();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-3xl mx-auto space-y-8 pb-10"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold flex items-center gap-3 text-text-main">
          <Globe className="text-emerald-500" /> {t('nav_community')}
        </h2>
        <span className="text-xs font-bold uppercase tracking-widest text-text-main/50">{t('community_subtitle')}</span>
      </div>

      <div className="space-y-8">
        {loading ? (
          <div className="italic text-center py-12 text-text-main/70">{t('community_loading')}</div>
        ) : error ? (
          <div className="p-12 text-center rounded-3xl border bg-red-500/10 border-red-500/30">
            <p className="text-red-400">{error}</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-12 text-center rounded-3xl border bg-surface-card border-border-subtle">
            <p className="text-text-main/70">{t('community_empty')}</p>
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
                  className="px-8 py-3 rounded-2xl font-bold transition-all disabled:opacity-50 bg-text-main text-surface-base shadow-lg"
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
