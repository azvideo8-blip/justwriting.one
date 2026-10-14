import { useEffect, useState } from 'react';

/**
 * Высота клавиатуры в WebView: visualViewport сжимается, window.innerHeight
 * остаётся. Возвращает отступ снизу; `idle` — значение, когда клавиатуры нет
 * (экран письма исторически держит там 120 px под тулбар, композеру нужно 0).
 */
export function useKeyboardHeight(idle = 120): number {
  const [keyboardHeight, setKeyboardHeight] = useState(idle);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const handleResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const offset = window.innerHeight - vv.height;
      const padBottom = offset > 0 ? Math.max(16, offset + 16) : idle;
      setKeyboardHeight(padBottom);
    };
    window.visualViewport.addEventListener('resize', handleResize);
    return () => window.visualViewport?.removeEventListener('resize', handleResize);
  }, [idle]);

  return keyboardHeight;
}
