import { useLocalStorage } from './useLocalStorage';
import { useMobileLayoutAccess } from './useMobileLayoutAccess';
import { z } from 'zod';

type LayoutMode = 'desktop' | 'mobile';

// Мобильный макет открыт по аккаунту, а не всем сразу (MB-1, решение владельца
// 2026-10-12): его получают админ и служебные аккаунты — право отдаёт база
// (`public.mobile_layout_allowed()`, миграция 0041), клиент читает его одним
// RPC на вошедшего пользователя. `true` здесь открыл бы макет всем, включая
// гостей; до готовности так делать нельзя (D-15: «mobile layout isn't beta-ready»).
export const MOBILE_LAYOUT_ENABLED = false;

function getDefaultLayoutMode(): LayoutMode {
  if (typeof window === 'undefined') return 'desktop';
  const isMobile =
    window.innerWidth < 768 ||
    (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024);
  return isMobile ? 'mobile' : 'desktop';
}

// Auto-detects 'mobile' on narrow screens / touch devices by default,
// while preserving explicit manual toggles in localStorage ('layout-mode-v4').
// Явный выбор человека (в том числе desktop, сохранённый Ctrl/⌘+M) сильнее
// автоопределения; без права на мобильный макет он всё равно уступает десктопу.
export function useLayoutMode() {
  const allowed = useMobileLayoutAccess();
  const [storedMode, setLayoutMode] = useLocalStorage<LayoutMode>(
    'layout-mode-v4',
    getDefaultLayoutMode(),
    z.enum(['desktop', 'mobile'])
  );

  const layoutMode: LayoutMode = (MOBILE_LAYOUT_ENABLED || allowed) ? storedMode : 'desktop';

  // MC-6: чего человек хочет, ещё до ответа базы. Окно первого входа по этому
  // признаку понимает, что ему есть смысл подождать RPC, а не показывать
  // десктопный набор окон.
  return { layoutMode, setLayoutMode, mobilePreferred: storedMode === 'mobile' };
}
