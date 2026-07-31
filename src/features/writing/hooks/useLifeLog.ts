import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
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
      let localDocs: Awaited<ReturnType<typeof LocalDocumentService.getGuestDocuments>> = [];
      let didFail = false;
      try {
        localDocs = await LocalDocumentService.getGuestDocuments(userId);
      } catch (e) {
        reportError(e, { action: 'lifeLog/fetchLocalDocs' });
        didFail = true;
      }

      if (isGuest) {
        if (!mountedRef.current) return;
        setCloudUnknown(didFail);
        setDocuments([]);
        setUnifiedDocuments(localDocs.map(d => localDocToLifeLog(d, false)));
      } else {
        let cloudDocs: Document[] = [];
        try {
          cloudDocs = await DocumentService.getUserDocuments(userId);
        } catch (e) {
          reportError(e, { action: 'lifeLog/fetchCloudDocs' });
          didFail = true;
        }

        if (!mountedRef.current) return;
        setCloudUnknown(didFail);
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
    void fetchSessions();
  }, [fetchSessions]);

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
