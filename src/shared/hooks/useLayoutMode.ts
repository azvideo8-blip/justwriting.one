import { useLocalStorage } from './useLocalStorage';
import { z } from 'zod';

type LayoutMode = 'desktop' | 'mobile';

export function useLayoutMode() {
  const [layoutMode, setLayoutMode] = useLocalStorage<LayoutMode>(
    'layout-mode',
    'desktop',
    z.enum(['desktop', 'mobile'])
  );

  return { layoutMode, setLayoutMode };
}
