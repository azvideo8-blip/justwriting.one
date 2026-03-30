import { useState, useCallback } from 'react';

export function useSessionState() {
  const [sessionType, setSessionType] = useState<'stopwatch' | 'timer' | 'words' | 'finish-by'>('stopwatch');
  const [timerDuration, setTimerDuration] = useState(15 * 60);
  const [wordGoal, setWordGoal] = useState(500);
  const [targetTime, setTargetTime] = useState<string | null>(null);
  
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [initialWordCount, setInitialWordCount] = useState(0);
  const [initialDuration, setInitialDuration] = useState(0);
  
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [pinnedThoughts, setPinnedThoughts] = useState<string[]>([]);
  
  const [isPublic, setIsPublic] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [labelId, setLabelId] = useState<string | undefined>(undefined);
  
  const [hasDraft, setHasDraft] = useState(false);
  const [encryptionPassword, setEncryptionPassword] = useState('');

  const resetSessionMetadata = useCallback(() => {
    setInitialWordCount(0);
    setInitialDuration(0);
    setActiveSessionId(null);
    setTags([]);
    setIsPublic(false);
    setIsAnonymous(false);
    setHasDraft(false);
    setLabelId(undefined);
    setEncryptionPassword('');
  }, []);

  const resetSessionState = useCallback(() => {
    setContent('');
    setTitle('');
    setPinnedThoughts([]);
    resetSessionMetadata();
  }, [resetSessionMetadata]);

  return {
    sessionType, setSessionType,
    timerDuration, setTimerDuration,
    wordGoal, setWordGoal,
    targetTime, setTargetTime,
    activeSessionId, setActiveSessionId,
    initialWordCount, setInitialWordCount,
    initialDuration, setInitialDuration,
    content, setContent,
    title, setTitle,
    pinnedThoughts, setPinnedThoughts,
    isPublic, setIsPublic,
    isAnonymous, setIsAnonymous,
    tags, setTags,
    labelId, setLabelId,
    hasDraft, setHasDraft,
    encryptionPassword, setEncryptionPassword,
    resetSessionState,
    resetSessionMetadata
  };
}
