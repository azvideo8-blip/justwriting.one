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
    const saved = localStorage.getItem('layout-mode');
    if (!saved) {
      setLayoutMode(window.innerWidth < 1024 ? 'mobile' : 'desktop');
    }
  }, [setLayoutMode]);

  return { layoutMode, setLayoutMode };
}
