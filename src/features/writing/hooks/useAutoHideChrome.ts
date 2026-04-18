import { useState, useEffect, useRef } from 'react';
import { useWritingStore } from '../store/useWritingStore';
import { useWritingSettings } from '../contexts/WritingSettingsContext';

const IDLE_DELAY = 2500;

export function useAutoHideChrome() {
  const status = useWritingStore(s => s.status);
  const content = useWritingStore(s => s.content);
  const { autoHideChrome, betaRedesign } = useWritingSettings();
  const [idle, setIdle] = useState(false);
  const lastActivityRef = useRef(Date.now());

  const isWriting = status === 'writing';
  const enabled = betaRedesign && autoHideChrome;

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }

    const updateActivity = () => {
      lastActivityRef.current = Date.now();
      setIdle(false);
    };

    window.addEventListener('keydown', updateActivity);
    window.addEventListener('mousemove', updateActivity);

    const check = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (isWriting && content.length > 0 && elapsed > IDLE_DELAY) {
        setIdle(true);
      }
    }, 500);

    return () => {
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('mousemove', updateActivity);
      clearInterval(check);
    };
  }, [enabled, isWriting, content.length]);

  useEffect(() => {
    if (!isWriting) setIdle(false);
  }, [isWriting]);

  return idle;
}
