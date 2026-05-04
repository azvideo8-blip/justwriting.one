import { useEffect } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { z } from 'zod';

export type LayoutMode = 'desktop' | 'mobile';

export function useLayoutMode() {
  const [layoutMode, setLayoutMode] = useLocalStorage<LayoutMode>(
    'layout-mode',
    // Auto-detect on first load
    typeof window !== 'undefined' && window.innerWidth < 1024 ? 'mobile' : 'desktop',
    z.enum(['desktop', 'mobile'])
  );

  // On first launch (no saved preference), detect and save
  useEffect(() => {
    let resizeTimer: ReturnType<typeof setTimeout>;

    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const newMode = window.innerWidth < 1024 ? 'mobile' : 'desktop';
        setLayoutMode(prev => prev === newMode ? prev : newMode);
      }, 300);
    };

    window.addEventListener('resize', handleResize, { passive: true });
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimer);
    };
  }, [setLayoutMode]);

  return { layoutMode, setLayoutMode };
}
