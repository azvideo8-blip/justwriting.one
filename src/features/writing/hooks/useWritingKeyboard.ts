import { useEffect, RefObject } from 'react';
import { useTimerStore } from '../store/useTimerStore';
import { isAccountReloadPending } from '../../../core/auth/accountReload';

interface UseWritingKeyboardParams {
  sessionStatus: string;
  handlePlayRef: RefObject<(() => void) | null>;
  handlePauseRef: RefObject<(() => void) | null>;
  handleFinishRef: RefObject<(() => void) | null>;
  toggleShortcutsRef: RefObject<(() => void) | null>;
}

export function useWritingKeyboard({ sessionStatus, handlePlayRef, handlePauseRef, handleFinishRef, toggleShortcutsRef }: UseWritingKeyboardParams) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyP' || e.key.toLowerCase() === 'p')) {
        if (sessionStatus === 'writing' || sessionStatus === 'paused') {
          e.preventDefault();
          if (sessionStatus === 'writing') {
            handlePauseRef.current?.();
          } else if (sessionStatus === 'paused') {
            handlePlayRef.current?.();
          }
        }
      }
      if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        // D-9: «Сохранить» из «Горячих клавиш». Раньше здесь был только
        // preventDefault вне редактора, а в редакторе — браузерное «Сохранить
        // страницу». Кнопка «Сохранить» в шапке делает onFinishClick: пауза
        // сессии и окно завершения; клавиша — ровно то же самое.
        e.preventDefault();
        handleFinishRef.current?.();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (sessionStatus === 'writing' || sessionStatus === 'paused') {
          e.preventDefault();
          handleFinishRef.current?.();
        }
      }
      if ((e.metaKey || e.ctrlKey) && (e.code === 'Slash' || e.key === '/')) {
        e.preventDefault();
        toggleShortcutsRef.current?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionStatus, handlePlayRef, handlePauseRef, handleFinishRef, toggleShortcutsRef]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Вето здесь при смене аккаунта недопустимо: отмена перезагрузки оставляет
      // интерфейс старого аккаунта поверх новой сессии (подмена аккаунта во вкладке).
      if (isAccountReloadPending()) return;
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
      if (!e.key || e.key.length !== 1) return;
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
