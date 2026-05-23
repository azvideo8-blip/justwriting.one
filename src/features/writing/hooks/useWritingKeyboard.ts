import { useEffect, RefObject } from 'react';
import { useTimerStore } from '../store/useTimerStore';

interface UseWritingKeyboardParams {
  sessionStatus: string;
  handlePlayRef: RefObject<(() => void) | null>;
  handlePauseRef: RefObject<(() => void) | null>;
}

export function useWritingKeyboard({ sessionStatus, handlePlayRef, handlePauseRef }: UseWritingKeyboardParams) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inEditor = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT';

      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        if (sessionStatus === 'writing' || sessionStatus === 'paused') {
          e.preventDefault();
          if (sessionStatus === 'writing') {
            handlePauseRef.current?.();
          } else if (sessionStatus === 'paused') {
            handlePlayRef.current?.();
          }
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (!inEditor) {
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionStatus, handlePlayRef, handlePauseRef]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useTimerStore.getState();
      if (state.status === 'writing' || state.status === 'paused') {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    const handleAutoStartKey = (e: KeyboardEvent) => {
      if (sessionStatus !== 'idle') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (target.closest('[data-modal]')) return;
      if (target.isContentEditable && target.closest('[data-modal]')) return;
      handlePlayRef.current?.();
    };
    window.addEventListener('keydown', handleAutoStartKey);
    return () => window.removeEventListener('keydown', handleAutoStartKey);
  }, [sessionStatus, handlePlayRef]);
}
