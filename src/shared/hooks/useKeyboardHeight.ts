import { useKeyboardState } from './useKeyboardState';

/**
 * Высота клавиатуры в WebView: visualViewport сжимается, window.innerHeight
 * остаётся. Возвращает отступ снизу; `idle` — значение, когда клавиатуры нет
 * (экран письма исторически держит там 120 px под тулбар, композеру нужно 0).
 *
 * Считается поверх `useKeyboardState`: подписка на viewport одна.
 */
export function useKeyboardHeight(idle = 120): number {
  const { overlay } = useKeyboardState();
  return overlay > 0 ? Math.max(16, overlay + 16) : idle;
}
