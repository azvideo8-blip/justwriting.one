import { useState, useEffect, useCallback } from 'react';
import { DocumentService } from '../services/DocumentService';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { Document } from '../../../types';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';

function localDocToDocument(doc: { id: string; title: string; currentVersion: number; totalWords: number; totalDuration: number; sessionsCount: number; firstSessionAt: number; lastSessionAt: number; isPublic: false; tags: string[] }): Document {
  return {
    id: doc.id,
    userId: '',
    title: doc.title,
    currentVersion: doc.currentVersion,
    totalWords: doc.totalWords,
    totalDuration: doc.totalDuration,
    sessionsCount: doc.sessionsCount,
    firstSessionAt: { seconds: Math.floor(doc.firstSessionAt / 1000), nanoseconds: 0 } as any,
    lastSessionAt: { seconds: Math.floor(doc.lastSessionAt / 1000), nanoseconds: 0 } as any,
    isPublic: doc.isPublic,
    tags: doc.tags,
  };
}

export function useDocuments(userId: string, isGuest?: boolean) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      if (isGuest) {
        const localDocs = await LocalDocumentService.getGuestDocuments(userId);
        setDocuments(localDocs.map(localDocToDocument));
      } else {
        const [cloudDocs, localDocs] = await Promise.all([
          DocumentService.getUserDocuments(userId).catch(() => [] as Document[]),
          LocalDocumentService.getGuestDocuments(getOrCreateGuestId()).catch(() => []),
        ]);
        const cloudIds = new Set(cloudDocs.map(d => d.id));
        const localAsDocs = localDocs
          .filter(d => !cloudIds.has(d.id))
          .map(localDocToDocument);
        setDocuments([...cloudDocs, ...localAsDocs]);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [userId, isGuest]);

  useEffect(() => {
    if (!userId) return;
    fetchDocs();
  }, [userId, fetchDocs]);

  const refresh = useCallback(async () => {
    await fetchDocs();
  }, [fetchDocs]);

  return { documents, loading, refresh };
}
