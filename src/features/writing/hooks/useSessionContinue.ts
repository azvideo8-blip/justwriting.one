import { useCallback } from 'react';
import { Session } from '../../../types';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { SetupMode } from '../components/WritingSetup';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { StorageService } from '../../../core/services/StorageService';
import { countWords } from '../../../shared/utils/countWords';
import { reportError } from '../../../shared/errors/reportError';

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

    const s = session as Session & {
      _isLocal?: boolean;
      _linkedCloudId?: string;
      _contentNotLoaded?: boolean;
    };
    const isLocal = !!s._isLocal && !s._contentNotLoaded;

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
          loadedContent: content || '',
          loadedTitle: session.title || '',
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
        loadedContent: content || '',
        loadedTitle: doc.title || '',
      });
      setTags(doc.tags);
      setSetupMode('selection');
      return;
    }

    // Cloud-only session or session with _contentNotLoaded
    const cloudId = s._linkedCloudId || (!isLocal ? session.id : undefined);
    let savedDocumentId: string | null = null;
    let sessionContent = '';

    if (cloudId) {
      try {
        const localDocs = await LocalDocumentService.getDocumentsByOwner(userId);
        const existing = localDocs.find(d => d.linkedCloudId === cloudId);
        if (existing) {
          savedDocumentId = existing.id;
          sessionContent = (await LocalVersionService.getLatestContent(existing.id)) || '';
        }
      } catch (e) {
        reportError(e, { action: 'sessionContinue/lookupLinkedDoc' });
      }

      if (!savedDocumentId || (!sessionContent && (session.wordCount || 0) > 0)) {
        try {
          savedDocumentId = await StorageService.addLocalCopy(userId, cloudId);
          sessionContent = (await LocalVersionService.getLatestContent(savedDocumentId)) || '';
        } catch (e) {
          reportError(e, { action: 'sessionContinue/importCloudDoc', cloudId });
          if (String(e).includes('LOCKED')) {
            window.dispatchEvent(new CustomEvent('open-vault-unlock'));
          }
          return; // Crucial: Do NOT open blank editor on failure!
        }
      }
    }

    if (!sessionContent && (session.wordCount || 0) > 0 && cloudId) {
      reportError(new Error('Refusing to open empty editor for non-empty note'), { action: 'sessionContinue/emptyContent', id: session.id });
      return;
    }

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
      loadedContent: sessionContent,
      loadedTitle: session.title || '',
    });
    setTags(session.tags || []);
    setSetupMode('selection');
  }, [setSetupMode, setTags, userId]);

  return { continueSession };
}
