import { useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { WritingDraftService } from '../services/WritingDraftService';
import { saveToLocal, saveToFirestore, Draft } from '../../../lib/db';

interface WritingStoreSyncProps {
  user: User | null;
}

export function WritingStoreSync({ user }: WritingStoreSyncProps) {
  const store = useWritingStore();
  const draftLoadedRef = useRef(false);

  // Load draft on mount
  useEffect(() => {
    if (!user || draftLoadedRef.current) return;

    const loadDraft = async () => {
      const draftToLoad = await WritingDraftService.loadDraft(user.uid);
      if (draftToLoad) {
        store.setHasDraft(true);
        // Only auto-load if current content is empty to prevent overwriting active work
        if (!store.content) {
          store.setContent(draftToLoad.content || '');
          store.setTitle(draftToLoad.title || '');
          store.setPinnedThoughts(draftToLoad.pinnedThoughts || []);
          if (draftToLoad.activeSessionId) store.setActiveSessionId(draftToLoad.activeSessionId);
          if (draftToLoad.initialWordCount !== undefined) store.setInitialWordCount(draftToLoad.initialWordCount);
          if (draftToLoad.initialDuration !== undefined) store.setInitialDuration(draftToLoad.initialDuration);
          if (draftToLoad.seconds !== undefined) store.setSeconds(draftToLoad.seconds);
          if (draftToLoad.status !== undefined) store.setStatus(draftToLoad.status);
        }
      }
      draftLoadedRef.current = true;
    };

    loadDraft();
  }, [user, store]);

  // Autosave logic
  useEffect(() => {
    if (!user || (store.status !== 'writing' && store.status !== 'paused')) return;

    const timeout = setTimeout(async () => {
      const draft: Draft = {
        userId: user.uid,
        title: store.title,
        content: store.content,
        pinnedThoughts: store.pinnedThoughts,
        seconds: store.seconds,
        wpm: store.wpm,
        wordCount: store.wordCount,
        initialWordCount: store.initialWordCount,
        sessionStartTime: store.sessionStartTime || undefined,
        activeSessionId: store.activeSessionId,
        status: store.status,
        updatedAt: Date.now()
      };
      
      try {
        await saveToLocal(draft);
      } catch (err) {
        console.error("Local autosave error:", err);
      }
    }, 1000); // Save 1s after last change

    return () => clearTimeout(timeout);
  }, [user, store.title, store.content, store.pinnedThoughts, store.seconds, store.status]);

  // Force save on exit
  const forceSaveEverything = useCallback(async () => {
    if (!user) return;
    const draft: Draft = {
      userId: user.uid,
      title: store.title,
      content: store.content,
      pinnedThoughts: store.pinnedThoughts,
      seconds: store.seconds,
      wpm: store.wpm,
      wordCount: store.wordCount,
      initialWordCount: store.initialWordCount,
      sessionStartTime: store.sessionStartTime || undefined,
      activeSessionId: store.activeSessionId,
      status: store.status,
      updatedAt: Date.now()
    };
    try {
      await Promise.all([saveToLocal(draft), saveToFirestore(draft)]);
    } catch (err) {
      console.error("Force save error:", err);
    }
  }, [user, store]);

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

  // Global timer tick
  useEffect(() => {
    let interval: any;
    if (store.status === 'writing') {
      interval = setInterval(() => {
        store.tick();
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [store.status, store.tick]);

  return null;
}
