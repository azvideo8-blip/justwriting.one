import { useState, useEffect, useCallback } from 'react';
import { DocumentService } from '../services/DocumentService';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { Document } from '../../../types';

function localDocToDocument(doc: { id: string; title: string; currentVersion: number; totalWords: number; totalDuration: number; sessionsCount: number; firstSessionAt: number; lastSessionAt: number; tags: string[]; linkedCloudId?: string }): Document {
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
    firstSessionAt: new Date(firstMs) as unknown as Document['firstSessionAt'],
    lastSessionAt: new Date(lastMs) as unknown as Document['lastSessionAt'],
    tags: doc.tags,
  };
}

export function useDocuments(userId: string, isGuest?: boolean) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDocs = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      if (isGuest) {
        const localDocs = await LocalDocumentService.getGuestDocuments(userId);
        setDocuments(localDocs.map(localDocToDocument));
      } else {
        const [cloudDocs, localDocs] = await Promise.all([
          DocumentService.getUserDocuments(userId).catch(() => [] as Document[]),
          LocalDocumentService.getGuestDocuments(userId),
        ]);
        const localMapped = localDocs.map(localDocToDocument);
        const seenIds = new Set(localMapped.map(d => d.id));
        const dedupedCloud = cloudDocs.filter(d => !seenIds.has(d.id));
        setDocuments([...localMapped, ...dedupedCloud]);
      }
    } catch { /* ignore */ }
    finally {
      setLoading(false);
    }
  }, [userId, isGuest]);

  useEffect(() => {
    fetchDocs();
  }, [userId, fetchDocs]);

  const refresh = useCallback(async () => {
    await fetchDocs();
  }, [fetchDocs]);

  return { documents, loading, refresh };
}
