import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { Session, Document } from '../../../types';
import { SessionService } from '../../../core/services/SessionService';
import { useLanguage } from '../../../core/i18n';
import { useStartOfToday } from '../../../shared/hooks/useStartOfToday';
import {
  localDocToSession,
  getLatestContentForDoc,
  localDocToLifeLog,
  mergeUnifiedDocuments,
  groupSessionsByDate,
  computeDailySummary,
} from '../utils/lifeLogUtils';
import { LifeLogDocument, DailySummary, SessionGroup } from '../types/lifeLog';
import { reportError } from '../../../core/errors/reportError';

interface UseLifeLogReturn {
  sessionGroups: SessionGroup[];
  documents: Document[];
  unifiedDocuments: LifeLogDocument[];
  summary: DailySummary;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useLifeLog(userId: string, isGuest: boolean): UseLifeLogReturn {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [unifiedDocuments, setUnifiedDocuments] = useState<LifeLogDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const { t, language } = useLanguage();
  const mountedRef = useRef(true);
  const startOfToday = useStartOfToday();

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      if (isGuest) {
        const localDocs = await LocalDocumentService.getGuestDocuments(userId);
        const sessionResults = await Promise.allSettled(
          localDocs.map(async d => {
            const content = await getLatestContentForDoc(d.id);
            return localDocToSession(d, content);
          })
        );
        const sessionsWithContent = sessionResults
          .filter((r): r is PromiseFulfilledResult<Session> => r.status === 'fulfilled')
          .map(r => r.value);
        if (!mountedRef.current) return;
        setSessions(sessionsWithContent);
        setDocuments([]);
        setUnifiedDocuments(localDocs.map(d => localDocToLifeLog(d, false)));
      } else {
        const [sessionResult, cloudDocs, localDocs] = await Promise.all([
          SessionService.getAllSessions(userId, 100),
          DocumentService.getUserDocuments(userId).catch(e => { reportError(e, { action: 'lifeLog/fetchCloudDocs' }); return [] as Document[]; }),
          LocalDocumentService.getGuestDocuments(userId).catch(e => { reportError(e, { action: 'lifeLog/fetchLocalDocs' }); return []; }),
        ]);

        if (!mountedRef.current) return;
        setSessions(sessionResult.sessions);
        setDocuments(cloudDocs);
        setUnifiedDocuments(mergeUnifiedDocuments(localDocs, cloudDocs));
      }
    } catch (e) {
      reportError(e, { action: 'lifeLog/fetchSessions' });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId, isGuest]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const summary = useMemo(
    () => computeDailySummary(unifiedDocuments, startOfToday),
    [unifiedDocuments, startOfToday]
  );

  const sessionGroups = useMemo(
    () => groupSessionsByDate(sessions, unifiedDocuments, startOfToday, t, language),
    [sessions, unifiedDocuments, startOfToday, t, language]
  );

  return {
    sessionGroups,
    documents,
    unifiedDocuments,
    summary,
    loading,
    refresh: fetchSessions,
  };
}
