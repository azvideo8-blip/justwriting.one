import { useLocalStorage } from './useLocalStorage';
import { z } from 'zod';

type LayoutMode = 'desktop' | 'mobile';

// Layout mode is MANUAL-ONLY — no auto-detection from viewport width.
// This was intentionally reverted from auto-detect (5d3d69a "layoutMode manual-only").
// The v0.7.11 refactor accidentally re-introduced media query auto-switching;
// this restores the manual-only behaviour.
// Key bumped to 'layout-mode-v3' so any stuck 'mobile' value from the old key is ignored.
export function useLayoutMode() {
  const [layoutMode, setLayoutMode] = useLocalStorage<LayoutMode>(
    'layout-mode-v3',
    'desktop',
    z.enum(['desktop', 'mobile'])
  );

  return { layoutMode, setLayoutMode };
}
