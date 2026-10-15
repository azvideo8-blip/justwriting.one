import { useState, useEffect, useRef } from 'react';

/** `initial` — с чего начинать на первом показе; без него счёт идёт с нуля. */
export function useCountUp(target: number, duration = 800, initial = 0) {
  const [value, setValue] = useState(initial);
  const startValueRef = useRef(initial);

  useEffect(() => {
    const start = performance.now();
    let rafId: number;
    const tick = (now: number) => {
      const pct = duration > 0 ? Math.min((now - start) / duration, 1) : 1;
      const current = Math.round(startValueRef.current + pct * (target - startValueRef.current));
      setValue(current);
      if (pct < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration]);

  useEffect(() => {
    startValueRef.current = value;
  }, [value]);

  return value;
}
