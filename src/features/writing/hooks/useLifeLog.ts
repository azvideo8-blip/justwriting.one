import { useState, useEffect, useCallback, useMemo } from 'react';
import { Session, Document } from '../../../types';
import { SessionService } from '../services/SessionService';
import { UnifiedSessionService, UnifiedDocument } from '../services/UnifiedSessionService';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { LocalDocument } from '../../../shared/lib/localDb';
import { parseFirestoreDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { useSessionSource, SessionSource } from './useSessionSource';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';

export interface DailySummary {
  totalWords: number;
  totalMinutes: number;
}

export interface SessionGroup {
  label: string;
  date: Date;
  sessions: Session[];
}

interface UseLifeLogReturn {
  sessionGroups: SessionGroup[];
  documents: Document[];
  unifiedDocuments: UnifiedDocument[];
  summary: DailySummary;
  loading: boolean;
  refresh: () => Promise<void>;
}

function localDocToSession(doc: LocalDocument): Session & { _isLocal?: boolean } {
  return {
    id: doc.id,
    userId: doc.guestId,
    authorName: '',
    authorPhoto: '',
    content: '',
    duration: doc.totalDuration,
    wordCount: doc.totalWords,
    charCount: 0,
    wpm: 0,
    isPublic: false,
    title: doc.title,
    tags: doc.tags,
    createdAt: new Date(doc.lastSessionAt),
    _isLocal: true,
  } as Session & { _isLocal?: boolean };
}

export function useLifeLog(userId: string, isGuest?: boolean): UseLifeLogReturn {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [unifiedDocuments, setUnifiedDocuments] = useState<UnifiedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const { t, language } = useLanguage();
  const source = useSessionSource();
  const { isGuest: authIsGuest } = useAuthStatus();
  const effectiveGuest = isGuest ?? authIsGuest;

  const startOfToday = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      if (effectiveGuest) {
        const localDocs = await LocalDocumentService.getGuestDocuments(userId);
        setSessions(localDocs.map(localDocToSession));
        setDocuments([]);
        setUnifiedDocuments(localDocs.map(d => ({
          id: d.id,
          title: d.title,
          currentVersion: d.currentVersion,
          totalWords: d.totalWords,
          totalDuration: d.totalDuration,
          sessionsCount: d.sessionsCount,
          lastSessionAt: d.lastSessionAt,
          isPublic: false,
          tags: d.tags,
          _isLocal: true,
          _source: 'local' as SessionSource,
        })));
      } else {
        const [sessionResult, { all, cloud }] = await Promise.all([
          SessionService.getAllSessions(userId, 100),
          UnifiedSessionService.getAllDocuments(userId, source),
        ]);
        setSessions(sessionResult.sessions);
        setDocuments(cloud);
        setUnifiedDocuments(all);
      }
    } catch (e) {
      if (import.meta.env.DEV) console.error('useLifeLog fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [userId, effectiveGuest, source]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const todaySessions = sessions.filter(s => {
    const date = parseFirestoreDate(s.createdAt);
    return date && date >= startOfToday;
  });

  const summary: DailySummary = {
    totalWords: todaySessions.reduce((sum, s) => sum + (s.wordCount || 0), 0),
    totalMinutes: Math.round(todaySessions.reduce((sum, s) => sum + (s.duration || 0), 0) / 60),
  };

  const sessionGroups = useMemo(() => {
    const groups = new Map<string, SessionGroup>();
    const yesterday = new Date(startOfToday);
    yesterday.setDate(yesterday.getDate() - 1);

    sessions.forEach(session => {
      const date = parseFirestoreDate(session.createdAt);
      if (!date) return;

      const sessionDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const key = sessionDay.toISOString();

      if (!groups.has(key)) {
        let label: string;
        if (sessionDay.getTime() === startOfToday.getTime()) {
          label = t('lifelog_group_today');
        } else if (sessionDay.getTime() === yesterday.getTime()) {
          label = t('lifelog_group_yesterday');
        } else {
          label = date.toLocaleDateString(language, {
            day: 'numeric',
            month: 'long',
          });
        }
        groups.set(key, { label, date: sessionDay, sessions: [] });
      }

      const existing = groups.get(key);
      if (existing) {
        existing.sessions.push(session);
      }
    });

    return Array.from(groups.values())
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [sessions, startOfToday, t, language]);

  return {
    sessionGroups,
    documents,
    unifiedDocuments,
    summary,
    loading,
    refresh: fetchSessions,
  };
}
