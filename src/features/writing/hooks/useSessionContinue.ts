import { useCallback } from 'react';
import { Session } from '../../../types';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { SetupMode } from '../WritingSetup';
import { LocalVersionService } from '../services/LocalVersionService';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { countWords } from '../../../shared/utils/countWords';
import { reportError } from '../../../core/errors/reportError';

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
        const wc = countWords(content || '');
        useContentStore.setState({
          content,
          title: session.title || '',
          initialWordCount: wc,
          wordCount: wc,
        });
        useTimerStore.setState({
          seconds: 0,
          accumulatedDuration: session.duration || 0,
        });
        useSessionMetaStore.setState({
          savedDocumentId: session.id,
        });
        setTags(session.tags || []);
        setSetupMode('selection');
        return;
      }

      const loadedContent = (loaded.content as string) || '';
      const wc = countWords(loadedContent);
      useContentStore.setState({
        content: loadedContent,
        title: (loaded.title as string) || '',
        initialWordCount: wc,
        wordCount: wc,
      });
      useTimerStore.setState({
        seconds: 0,
        accumulatedDuration: (loaded.duration as number) || 0,
      });
      useSessionMetaStore.setState({
        savedDocumentId: session.id,
      });
      setTags((loaded.tags as string[]) || []);
      setSetupMode('selection');
      return;
    }

    let savedDocumentId: string | null = null;
    const linkedCloudId = (session as Session & { _linkedCloudId?: string })._linkedCloudId;
    if (linkedCloudId) {
      try {
        const localDocs = await LocalDocumentService.getGuestDocuments(userId);
        const existing = localDocs.find(d => d.linkedCloudId === linkedCloudId);
        if (existing) savedDocumentId = existing.id;
      } catch (e) { reportError(e, { action: 'sessionContinue/lookupLinkedDoc' }); }
    }

    const sessionContent = session.content || '';
    const wc = countWords(sessionContent);
    useContentStore.setState({
      content: sessionContent,
      title: session.title || '',
      initialWordCount: wc,
      wordCount: wc,
    });
    useTimerStore.setState({
      seconds: 0,
      accumulatedDuration: session.duration || 0,
    });
    useSessionMetaStore.setState({
      savedDocumentId,
    });
    setTags(session.tags || []);
    setSetupMode('selection');
  }, [setSetupMode, setTags, loadLocalSession, userId]);

  return { continueSession };
}
