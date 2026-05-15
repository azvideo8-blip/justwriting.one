import { useCallback } from 'react';
import { Session } from '../../../types';
import { useWritingStore } from '../store/useWritingStore';
import { SetupMode } from '../WritingSetup';
import { LocalVersionService } from '../services/LocalVersionService';
import { LocalDocumentService } from '../services/LocalDocumentService';

interface UseSessionContinueParams {
  setSetupMode: (mode: SetupMode) => void;
  setTags: (tags: string[]) => void;
  loadLocalSession: (id: string) => Promise<Record<string, unknown> | null>;
  userId: string;
}

export function useSessionContinue({
  setSetupMode,
  setTags,
  loadLocalSession,
  userId,
}: UseSessionContinueParams) {
  const continueSession = useCallback(async (session: Session) => {
    const isLocal = session._isLocal;
    if (isLocal) {
      const loaded = await loadLocalSession(session.id);

      if (!loaded) {
        const content = await LocalVersionService.getLatestContent(session.id);
        useWritingStore.setState({
          content,
          title: session.title || '',
          initialWordCount: session.wordCount || 0,
          seconds: 0,
          wordCount: session.wordCount || 0,
          accumulatedDuration: session.duration || 0,
          savedDocumentId: session.id,
        });
        setTags(session.tags || []);
        setSetupMode('selection');
        return;
      }

      useWritingStore.setState({
        content: (loaded.content as string) || '',
        title: (loaded.title as string) || '',
        initialWordCount: (loaded.wordCount as number) || 0,
        seconds: 0,
        wordCount: (loaded.wordCount as number) || 0,
        accumulatedDuration: (loaded.duration as number) || 0,
        savedDocumentId: session.id,
      });
      setTags((loaded.tags as string[]) || []);
      setSetupMode('selection');
      return;
    }

    // Cloud session: try to find existing local document via _linkedCloudId
    let savedDocumentId: string | null = null;
    const linkedCloudId = (session as Session & { _linkedCloudId?: string })._linkedCloudId;
    if (linkedCloudId) {
      try {
        const localDocs = await LocalDocumentService.getGuestDocuments(userId);
        const existing = localDocs.find(d => d.linkedCloudId === linkedCloudId);
        if (existing) savedDocumentId = existing.id;
      } catch { /* ignore */ }
    }

    useWritingStore.setState({
      content: session.content,
      title: session.title || '',
      initialWordCount: session.wordCount || 0,
      seconds: 0,
      wordCount: session.wordCount || 0,
      accumulatedDuration: session.duration || 0,
      savedDocumentId,
    });
    setTags(session.tags || []);
    setSetupMode('selection');
  }, [setSetupMode, setTags, loadLocalSession, userId]);

  return { continueSession };
}
