import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { VersionService } from '../../../core/services/VersionService';
import { Document } from '../../../types';
import { useLanguage } from '../../../shared/i18n';
import { useStartOfToday } from '../../../shared/hooks/useStartOfToday';
import {
  localDocToLifeLog,
  mergeUnifiedDocuments,
  groupSessionsByDate,
  computeDailySummary,
} from '../utils/lifeLogUtils';
import { LifeLogDocument, DailySummary, SessionGroup } from '../types/lifeLog';
import { reportError } from '../../../shared/errors/reportError';
import { onDomainEvent } from '../../../core/events/domainEvents';

interface UseLifeLogReturn {
  sessionGroups: SessionGroup[];
  documents: Document[];
  unifiedDocuments: LifeLogDocument[];
  summary: DailySummary;
  loading: boolean;
  cloudUnknown: boolean;
  refresh: () => Promise<void>;
}

export function useLifeLog(userId: string, isGuest: boolean): UseLifeLogReturn {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [unifiedDocuments, setUnifiedDocuments] = useState<LifeLogDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [cloudUnknown, setCloudUnknown] = useState(false);
  const { t, language } = useLanguage();
  const mountedRef = useRef(true);
  const startOfToday = useStartOfToday();

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setCloudUnknown(false);
    try {
      let localDocs: Awaited<ReturnType<typeof LocalDocumentService.getDocumentsByOwner>> = [];
      let didFail = false;
      try {
        localDocs = await LocalDocumentService.getDocumentsByOwner(userId);
      } catch (e) {
        reportError(e, { action: 'lifeLog/fetchLocalDocs' });
        didFail = true;
      }

      let cloudDocs: Document[] = [];
      if (!isGuest) {
        try {
          cloudDocs = await DocumentService.getUserDocuments(userId);
        } catch (e) {
          reportError(e, { action: 'lifeLog/fetchCloudDocs' });
          didFail = true;
        }
      }

      if (!mountedRef.current) return;
      setCloudUnknown(didFail);
      setDocuments(cloudDocs);

      const rawUnified = isGuest
        ? localDocs.map(d => localDocToLifeLog(d, false))
        : mergeUnifiedDocuments(localDocs, cloudDocs);

      const startTs = startOfToday.getTime();
      const unifiedWithVersions = await Promise.all(
        rawUnified.map(async doc => {
          if (doc.lastSessionAt < startTs) return doc;
          try {
            if (doc.localId) {
              const vers = await LocalVersionService.getVersions(doc.localId);
              return {
                ...doc,
                versions: vers.map(v => ({
                  wordsAdded: v.wordsAdded ?? v.wordCount,
                  duration: v.duration,
                  savedAt: v.savedAt,
                })),
              };
            } else if (doc.cloudId && !isGuest) {
              const vers = await VersionService.getVersions(userId, doc.cloudId);
              return {
                ...doc,
                versions: vers.map(v => ({
                  wordsAdded: v.wordsAdded ?? v.wordCount,
                  duration: v.duration,
                  savedAt: v.savedAt ? new Date(v.savedAt).getTime() : 0,
                })),
              };
            }
          } catch {
            // fallback gracefully without versions
          }
          return doc;
        })
      );

      if (!mountedRef.current) return;
      setUnifiedDocuments(unifiedWithVersions);
    } catch (e) {
      reportError(e, { action: 'lifeLog/fetchSessions' });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId, isGuest, startOfToday]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch from local and cloud stores on mount/user change
    void fetchSessions();
  }, [fetchSessions]);

  // MC-4: `handleSave` обновляет лог жизни у СВОЕГО экземпляра хука, а шапка
  // письма читает другой — из-за этого счётчик серии жил до перезагрузки
  // страницы. Подписка на событие сохранения носит весть всем экземплярам.
  useEffect(() => onDomainEvent((e) => {
    if (e.type !== 'note.saved') return;
    if (e.userId !== undefined && e.userId !== userId) return;
    void fetchSessions();
  }), [fetchSessions, userId]);

  const summary = useMemo(
    () => computeDailySummary(unifiedDocuments, startOfToday),
    [unifiedDocuments, startOfToday]
  );

  const sessionGroups = useMemo(
    () => groupSessionsByDate(unifiedDocuments, startOfToday, t, language),
    [unifiedDocuments, startOfToday, t, language]
  );

  return {
    sessionGroups,
    documents,
    unifiedDocuments,
    summary,
    loading,
    cloudUnknown,
    refresh: fetchSessions,
  };
}
