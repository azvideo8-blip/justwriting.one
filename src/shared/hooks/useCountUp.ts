import { useState, useEffect, useRef } from 'react';

export function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const startValueRef = useRef(0);

  useEffect(() => {
    const start = performance.now();
    let rafId: number;
    const tick = (now: number) => {
      const pct = Math.min((now - start) / duration, 1);
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
