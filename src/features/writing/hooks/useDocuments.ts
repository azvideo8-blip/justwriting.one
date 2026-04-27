import { useState, useEffect, useCallback } from 'react';
import { DocumentService } from '../services/DocumentService';
import { Document } from '../../../types';

export function useDocuments(userId: string) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    DocumentService.getUserDocuments(userId)
      .then(setDocuments)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const docs = await DocumentService.getUserDocuments(userId);
      setDocuments(docs);
    } catch {
      // handled by useServiceAction at call site
    } finally {
      setLoading(false);
    }
  }, [userId]);

  return { documents, loading, refresh };
}
