import { useState, useEffect } from 'react';

export function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let rafId: number;
    const tick = (now: number) => {
      const pct = Math.min((now - start) / duration, 1);
      setValue(Math.round(pct * target));
      if (pct < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration]);
  return value;
}
