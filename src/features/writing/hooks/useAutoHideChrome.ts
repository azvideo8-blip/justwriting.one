import { useState, useEffect, useRef } from 'react';
import { useWritingStore } from '../store/useWritingStore';
import { useWritingSettings } from '../contexts/WritingSettingsContext';

const IDLE_DELAY = 2500;

export function useAutoHideChrome() {
  const status = useWritingStore(s => s.status);
  const content = useWritingStore(s => s.content);
  const { autoHideChrome, betaRedesign } = useWritingSettings();
  const [idle, setIdle] = useState(false);
  const lastMouseRef = useRef(Date.now());

  const isWriting = status === 'writing';
  const enabled = betaRedesign && autoHideChrome;

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }

    const onMouse = () => {
      lastMouseRef.current = Date.now();
      setIdle(false);
    };

    window.addEventListener('mousemove', onMouse);

    const check = setInterval(() => {
      if (!isWriting || content.length === 0) {
        setIdle(false);
        return;
      }
      const elapsed = Date.now() - lastMouseRef.current;
      if (elapsed > IDLE_DELAY) {
        setIdle(true);
      }
    }, 500);

    return () => {
      window.removeEventListener('mousemove', onMouse);
      clearInterval(check);
    };
  }, [enabled, isWriting, content.length]);

  useEffect(() => {
    if (!isWriting) setIdle(false);
  }, [isWriting]);

  return idle;
}
