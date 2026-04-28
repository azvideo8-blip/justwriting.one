import { useState } from 'react';
import { Session } from '../../../types';
import { useWritingStore } from '../store/useWritingStore';
import { SetupMode } from '../WritingSetup';
import { LocalVersionService } from '../services/LocalVersionService';

interface UseSessionContinueParams {
  setSetupMode: (mode: SetupMode) => void;
  setIsLocalOnly: (v: boolean) => void;
  setActiveSessionId: (id: string | null) => void;
  setTags: (tags: string[]) => void;
  setIsPublic: (v: boolean) => void;
  setIsAnonymous: (v: boolean) => void;
  loadLocalSession: (id: string) => Promise<Record<string, unknown> | null>;
  decryptSession: (session: Record<string, unknown>, password: string) => Promise<Record<string, unknown>>;
}

interface UseSessionContinueReturn {
  continueSession: (session: Session) => Promise<void>;
  passwordPrompt: { session: Session; resolve: (p: string) => void; reject: () => void } | null;
  handlePromptSubmit: (password: string) => void;
  handlePromptCancel: () => void;
}

export function useSessionContinue({
  setSetupMode,
  setIsLocalOnly,
  setActiveSessionId,
  setTags,
  setIsPublic,
  setIsAnonymous,
  loadLocalSession,
  decryptSession,
}: UseSessionContinueParams): UseSessionContinueReturn {
  const [passwordPrompt, setPasswordPrompt] = useState<{
    session: Session;
    resolve: (p: string) => void;
    reject: () => void;
  } | null>(null);

  const continueSession = async (session: Session) => {
    const isLocal = (session as Session & { _isLocal?: boolean; isLocal?: boolean })._isLocal
      || (session as Session & { isLocal?: boolean }).isLocal;
    if (isLocal) {
      let loaded = await loadLocalSession(session.id);

      if (!loaded) {
        const content = await LocalVersionService.getLatestContent(session.id);
        setActiveSessionId(null);
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
        setIsLocalOnly(true);
        setSetupMode('selection');
        return;
      }

      if (loaded.isEncrypted) {
        try {
          const password = await new Promise<string>((resolve, reject) => {
            setPasswordPrompt({ session, resolve, reject });
          });
          loaded = await decryptSession(loaded, password);
        } catch {
          console.error('Decryption failed or cancelled');
          return;
        }
      }

      setActiveSessionId(null);
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
      setIsLocalOnly(true);
      setSetupMode('selection');
      return;
    }

    setActiveSessionId(session.id);
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
    setIsLocalOnly(false);
    setSetupMode('selection');
  };

  const handlePromptSubmit = (password: string) => {
    if (passwordPrompt) {
      passwordPrompt.resolve(password);
      setPasswordPrompt(null);
    }
  };

  const handlePromptCancel = () => {
    if (passwordPrompt) {
      passwordPrompt.reject();
      setPasswordPrompt(null);
    }
  };

  return { continueSession, passwordPrompt, handlePromptSubmit, handlePromptCancel };
}
