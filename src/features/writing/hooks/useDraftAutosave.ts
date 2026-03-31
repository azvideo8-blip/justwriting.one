import { useState, useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { saveToLocal, saveToFirestore, Draft } from '../../../lib/db';

export function useDraftAutosave(
  user: User | null,
  draftData: {
    title: string;
    content: string;
    pinnedThoughts: string[];
    seconds: number;
    wpm: number;
    wordCount: number;
    initialWordCount?: number;
    activeSessionId: string | null;
    status: 'idle' | 'writing' | 'paused' | 'finished';
  }
) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const draftDataRef = useRef(draftData);

  useEffect(() => {
    draftDataRef.current = draftData;
  }, [draftData]);

  const forceSaveEverything = useCallback(async () => {
    if (!user) return;
    const draft: Draft = {
      userId: user.uid,
      ...draftDataRef.current,
      updatedAt: Date.now()
    };
    try {
      setSaveStatus('saving');
      await Promise.all([saveToLocal(draft), saveToFirestore(draft)]);
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      setTimeout(() => setSaveStatus('idle'), 1000);
    } catch (err) {
      console.error("Force save error:", err);
      setSaveStatus('error');
    }
  }, [user]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        forceSaveEverything();
      }
    };

    const handleBeforeUnload = () => {
      forceSaveEverything();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [forceSaveEverything]);

  useEffect(() => {
    if ((draftData.status === 'writing' || draftData.status === 'paused') && user) {
      const timeout = setTimeout(async () => {
        const draft: Draft = {
          userId: user.uid,
          ...draftData,
          updatedAt: Date.now()
        };
        try {
          await saveToLocal(draft);
          setSaveStatus('saved');
          setLastSavedAt(Date.now());
          setTimeout(() => setSaveStatus('idle'), 1000);
        } catch (err) {
          console.error("Local autosave error:", err);
          setSaveStatus('error');
        }
      }, 500); // Save 500ms after last change
      
      return () => clearTimeout(timeout);
    }
  }, [draftData, user]);

  return { saveStatus, lastSavedAt };
}
