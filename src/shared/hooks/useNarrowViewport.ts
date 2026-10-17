import { useEffect, useState } from 'react';

// SA-20 (N-1): телефонная граница в один ряд с `max-md:` в Tailwind (48rem):
// структурные решения оболочки (прятать рейку или нет) и CSS-переопределения
// экрана обязаны переключаться на одной ширине, иначе на 700 px колонка
// исчезнет, а вёрстка останется десктопной.
const NARROW_QUERY = '(max-width: 767px)';

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return narrow;
}
