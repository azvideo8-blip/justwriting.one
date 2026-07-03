import { useEffect, RefObject } from 'react';

const HIDDEN_CLASS = 'cursor-hidden-typing';

export function useAutoHideCursor(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const showCursor = () => {
      container.classList.remove(HIDDEN_CLASS);
    };

    const hideCursor = () => {
      container.classList.add(HIDDEN_CLASS);
    };

    container.addEventListener('mousemove', showCursor);
    container.addEventListener('keydown', hideCursor);

    showCursor();

    return () => {
      container.removeEventListener('mousemove', showCursor);
      container.removeEventListener('keydown', hideCursor);
      showCursor();
    };
  }, [containerRef, enabled]);
}
