import { useEffect, type RefObject } from 'react';

export function useFocusTrap(ref: RefObject<HTMLElement | null>, isActive: boolean) {
  useEffect(() => {
    if (!isActive || !ref.current) return;
    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    const observer = new MutationObserver(() => {
      if (!document.activeElement || !container.contains(document.activeElement)) {
        getFocusable()[0]?.focus();
      }
    });

    getFocusable()[0]?.focus();
    document.addEventListener('keydown', handleKeyDown);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      observer.disconnect();
      previouslyFocused?.focus();
    };
  }, [isActive, ref]);
}
