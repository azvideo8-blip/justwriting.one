import { useEffect } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { z } from 'zod';

type LayoutMode = 'desktop' | 'mobile';

// [U-02] начальное значение определяется по реальному viewport, а не хардкодом 'desktop'
function getInitialLayoutMode(): LayoutMode {
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches) {
    return 'mobile';
  }
  return 'desktop';
}

export function useLayoutMode() {
  const [layoutMode, setLayoutMode] = useLocalStorage<LayoutMode>(
    'layout-mode',
    getInitialLayoutMode(),
    z.enum(['desktop', 'mobile'])
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 480px)');
    
    let timeoutId: ReturnType<typeof setTimeout>;
    
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setLayoutMode(e.matches ? 'mobile' : 'desktop');
      }, 150);
    };

    // Modern browsers support addEventListener, older use addListener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => {
        clearTimeout(timeoutId);
        mediaQuery.removeEventListener('change', handleChange);
      };
    } else {
      mediaQuery.addListener(handleChange);
      return () => {
        clearTimeout(timeoutId);
        mediaQuery.removeListener(handleChange);
      };
    }
  }, [setLayoutMode]);

  return { layoutMode, setLayoutMode };
}

