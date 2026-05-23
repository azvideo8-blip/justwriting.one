import { useLocalStorage } from './useLocalStorage';
import { z } from 'zod';

type LayoutMode = 'desktop' | 'mobile';

// [U-02] начальное значение определяется по реальному viewport, а не хардкодом 'desktop'
function getInitialLayoutMode(): LayoutMode {
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) {
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

  return { layoutMode, setLayoutMode };
}
