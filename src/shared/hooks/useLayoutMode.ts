import { useLocalStorage } from './useLocalStorage';
import { z } from 'zod';

type LayoutMode = 'desktop' | 'mobile';

function getDefaultLayoutMode(): LayoutMode {
  if (typeof window === 'undefined') return 'desktop';
  const isMobile =
    window.innerWidth < 768 ||
    (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024);
  return isMobile ? 'mobile' : 'desktop';
}

// Auto-detects 'mobile' on narrow screens / touch devices by default,
// while preserving explicit manual toggles in localStorage ('layout-mode-v4').
export function useLayoutMode() {
  const [layoutMode, setLayoutMode] = useLocalStorage<LayoutMode>(
    'layout-mode-v4',
    getDefaultLayoutMode(),
    z.enum(['desktop', 'mobile'])
  );

  return { layoutMode, setLayoutMode };
}
