import { useState, useEffect, useCallback } from 'react';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { Document } from '../../../types';
import { reportError } from '../../../shared/errors/reportError';
import { useLanguage } from '../../../shared/i18n';

function localDocToDocument(doc: { id: string; title: string; currentVersion: number; totalWords: number; totalDuration: number; sessionsCount: number; firstSessionAt: number; lastSessionAt: number; tags: string[]; linkedCloudId?: string | undefined }): Document {
  const firstMs = doc.firstSessionAt || doc.lastSessionAt || Date.now();
  const lastMs = doc.lastSessionAt || doc.firstSessionAt || Date.now();
  return {
    id: doc.id,
    userId: '',
    title: doc.title,
    currentVersion: doc.currentVersion,
    totalWords: doc.totalWords,
    totalDuration: doc.totalDuration,
    sessionsCount: doc.sessionsCount,
    firstSessionAt: new Date(firstMs),
    lastSessionAt: new Date(lastMs),
    tags: doc.tags,
  };
}

export function useDocuments(userId: string, isGuest?: boolean) {
  const { t } = useLanguage();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!userId) {
        if (!cancelled) { setLoading(false); setDocuments([]); }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (isGuest) {
          const localDocs = await LocalDocumentService.getGuestDocuments(userId);
          if (!cancelled) setDocuments(localDocs.map(localDocToDocument));
        } else {
          const [cloudDocs, localDocs] = await Promise.all([
            DocumentService.getUserDocuments(userId).catch((err) => {
              reportError(err, { action: 'fetchDocuments_cloud_partial', userId }, 'warning');
              return [] as Document[];
            }),
            LocalDocumentService.getGuestDocuments(userId),
          ]);
          if (!cancelled) {
            const localMapped = localDocs.map(localDocToDocument);
            const seenIds = new Set(localMapped.map(d => d.id));
            const dedupedCloud = cloudDocs.filter(d => !seenIds.has(d.id));
            setDocuments([...localMapped, ...dedupedCloud]);
          }
        }
      } catch (err) {
        if (!cancelled) {
          reportError(err, { action: 'fetchDocuments', userId });
          setError(t('archive_load_error') || 'Error loading documents');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, isGuest, t]);

  const refresh = useCallback(async () => {
    if (!userId) { setLoading(false); setDocuments([]); return; }
    setLoading(true);
    setError(null);
    try {
      if (isGuest) {
        const localDocs = await LocalDocumentService.getGuestDocuments(userId);
        setDocuments(localDocs.map(localDocToDocument));
      } else {
        const [cloudDocs, localDocs] = await Promise.all([
          DocumentService.getUserDocuments(userId).catch((err) => {
            reportError(err, { action: 'fetchDocuments_cloud_partial', userId }, 'warning');
            return [] as Document[];
          }),
          LocalDocumentService.getGuestDocuments(userId),
        ]);
        const localMapped = localDocs.map(localDocToDocument);
        const seenIds = new Set(localMapped.map(d => d.id));
        const dedupedCloud = cloudDocs.filter(d => !seenIds.has(d.id));
        setDocuments([...localMapped, ...dedupedCloud]);
      }
    } catch (err) {
      reportError(err, { action: 'fetchDocuments', userId });
      setError(t('archive_load_error') || 'Error loading documents');
    } finally {
      setLoading(false);
    }
  }, [userId, isGuest, t]);

  return { documents, loading, refresh, error };
}
