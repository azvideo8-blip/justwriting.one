import { useEffect, useRef } from 'react';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';

// Cmd+M (Mac) / Ctrl+M (Win/Linux) toggles desktop ↔ mobile layout.
// Note: Cmd+M on macOS minimises the window by default; the app needs to be
// in focus (not the OS window chrome) for this to fire — which is always the
// case when interacting with the editor. e.preventDefault() stops the browser
// from also acting on the key.
export function useLayoutKeyboardShortcut() {
  const { layoutMode, setLayoutMode } = useLayoutMode();
  const layoutModeRef = useRef(layoutMode);
  useEffect(() => { layoutModeRef.current = layoutMode; }, [layoutMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyM') {
        e.preventDefault();
        setLayoutMode(layoutModeRef.current === 'desktop' ? 'mobile' : 'desktop');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setLayoutMode]);
}
