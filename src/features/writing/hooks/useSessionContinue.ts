import { useCallback } from 'react';
import { Session } from '../../../types';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { SetupMode } from '../components/WritingSetup';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { countWords } from '../../../shared/utils/countWords';
import { reportError } from '../../../core/errors/reportError';

interface UseSessionContinueParams {
  setSetupMode: (mode: SetupMode) => void;
  setTags: (tags: string[]) => void;
  userId: string;
}

export function useSessionContinue({
  setSetupMode,
  setTags,
  userId,
}: UseSessionContinueParams) {
  const continueSession = useCallback(async (session: Session) => {
    if (!session.id) {
      reportError(new Error('Session has no id'), { action: 'sessionContinue/noId' });
      return;
    }

    const isLocal = session._isLocal;
    if (isLocal) {
      const doc = await LocalDocumentService.getDocument(session.id);
      const content = await LocalVersionService.getLatestContent(session.id);

      if (!doc) {
        const wc = countWords(content || '');
        useContentStore.setState({
          content: content || '',
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

      const wc = countWords(content || '');
      useContentStore.setState({
        content: content || '',
        title: doc.title || '',
        initialWordCount: wc,
        wordCount: wc,
      });
      useTimerStore.setState({
        seconds: 0,
        accumulatedDuration: doc.totalDuration || 0,
      });
      useSessionMetaStore.setState({
        savedDocumentId: session.id,
      });
      setTags(doc.tags || []);
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
  }, [setSetupMode, setTags, userId]);

  return { continueSession };
}
