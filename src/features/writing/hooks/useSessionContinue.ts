import { useState, useCallback, useRef, useEffect } from 'react';
import { Session } from '../../../types';
import { useWritingStore } from '../store/useWritingStore';
import { SetupMode } from '../WritingSetup';
import { LocalVersionService } from '../services/LocalVersionService';

interface UseSessionContinueParams {
  setSetupMode: (mode: SetupMode) => void;
  setTags: (tags: string[]) => void;
  setIsPublic: (v: boolean) => void;
  setIsAnonymous: (v: boolean) => void;
  loadLocalSession: (id: string) => Promise<Record<string, unknown> | null>;
}

export function useSessionContinue({
  setSetupMode,
  setTags,
  setIsPublic,
  setIsAnonymous,
  loadLocalSession,
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
        });
        setTags(session.tags || []);
        setIsPublic(false);
        setIsAnonymous(false);
        setSetupMode('selection');
        return;
      }

      useWritingStore.setState({
        content: (loaded.content as string) || '',
        title: (loaded.title as string) || '',
        initialWordCount: (loaded.wordCount as number) || 0,
        seconds: (loaded.duration as number) || 0,
        wordCount: (loaded.wordCount as number) || 0,
        accumulatedDuration: (loaded.duration as number) || 0,
      });
      setTags((loaded.tags as string[]) || []);
      setIsPublic((loaded.isPublic as boolean) || false);
      setIsAnonymous((loaded.isAnonymous as boolean) || false);
      setSetupMode('selection');
      return;
    }

    useWritingStore.setState({
      content: session.content,
      title: session.title || '',
      initialWordCount: session.wordCount || 0,
      seconds: session.duration || 0,
      wordCount: session.wordCount || 0,
      accumulatedDuration: session.duration || 0,
    });
    setTags(session.tags || []);
    setIsPublic(session.isPublic);
    setIsAnonymous(session.isAnonymous || false);
    setSetupMode('selection');
  }, [setSetupMode, setTags, setIsPublic, setIsAnonymous, loadLocalSession]);

  return { continueSession };
}
