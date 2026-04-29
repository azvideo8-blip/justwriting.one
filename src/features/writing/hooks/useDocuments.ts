import { useState, useEffect, useCallback } from 'react';
import { DocumentService } from '../services/DocumentService';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { Document } from '../../../types';

function localDocToDocument(doc: { id: string; title: string; currentVersion: number; totalWords: number; totalDuration: number; sessionsCount: number; firstSessionAt: number; lastSessionAt: number; tags: string[]; linkedCloudId?: string }): Document {
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
        const cloudDocs = await DocumentService.getUserDocuments(userId);
        setDocuments(cloudDocs);
      }
    } catch {
    } finally {
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
