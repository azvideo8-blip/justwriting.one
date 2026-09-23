import { useLocalStorage } from './useLocalStorage';
import { z } from 'zod';

type LayoutMode = 'desktop' | 'mobile';

// Temporarily disabled by request (2026-09-22 / D-15): mobile layout isn't
// beta-ready, testers are being pointed at desktop only. To re-enable mobile layout,
// set MOBILE_LAYOUT_ENABLED to true.
export const MOBILE_LAYOUT_ENABLED = false;

function getDefaultLayoutMode(): LayoutMode {
  return 'desktop';
  // eslint-disable-next-line no-unreachable -- dead by design, see comment above
  if (typeof window === 'undefined') return 'desktop';
  const isMobile =
    window.innerWidth < 768 ||
    (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024);
  return isMobile ? 'mobile' : 'desktop';
}

// Auto-detects 'mobile' on narrow screens / touch devices by default,
// while preserving explicit manual toggles in localStorage ('layout-mode-v4').
export function useLayoutMode() {
  const [storedMode, setLayoutMode] = useLocalStorage<LayoutMode>(
    'layout-mode-v4',
    getDefaultLayoutMode(),
    z.enum(['desktop', 'mobile'])
  );

  // D-15: While mobile layout is disabled, always enforce 'desktop',
  // ignoring any stored preference without deleting it from localStorage.
  const layoutMode: LayoutMode = MOBILE_LAYOUT_ENABLED ? storedMode : 'desktop';

  return { layoutMode, setLayoutMode };
}
