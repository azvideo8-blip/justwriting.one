import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { saveDraft } from '../lib/db';

export function useDraftAutosave(
  user: User | null,
  draftData: {
    title: string;
    content: string;
    pinnedThoughts: string[];
    seconds: number;
    wpm: number;
    wordCount: number;
    activeSessionId: string | null;
    status: 'idle' | 'writing' | 'paused' | 'finished';
  }
) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if ((draftData.status === 'writing' || draftData.status === 'paused') && user) {
      const timeout = setTimeout(() => {
        setSaveStatus('saving');
        saveDraft({
          userId: user.uid,
          ...draftData,
          updatedAt: Date.now()
        }).then(() => {
          setSaveStatus('saved');
          setLastSavedAt(Date.now());
          setTimeout(() => setSaveStatus('idle'), 3000);
        }).catch((err) => {
          console.error("Autosave error:", err);
          setSaveStatus('error');
        });
      }, 3000); // Save 3s after last change
      
      return () => clearTimeout(timeout);
    }
  }, [draftData, user]);

  return { saveStatus, lastSavedAt };
}
