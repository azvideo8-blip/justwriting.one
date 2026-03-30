import { useState, useEffect, useRef } from 'react';

export function useZenMode(status: 'idle' | 'writing' | 'paused' | 'finished', zenModeEnabled: boolean) {
  const [isZenActive, setIsZenActive] = useState<boolean>(false);
  const zenTimerRef = useRef<any>(null);

  useEffect(() => {
    if (status !== 'writing' || !zenModeEnabled) {
      setIsZenActive(false);
      return;
    }

    const resetZenTimer = () => {
      setIsZenActive(false);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
      zenTimerRef.current = setTimeout(() => {
        setIsZenActive(true);
      }, 3000);
    };

    window.addEventListener('mousemove', resetZenTimer);
    window.addEventListener('keydown', resetZenTimer);

    resetZenTimer();

    return () => {
      window.removeEventListener('mousemove', resetZenTimer);
      window.removeEventListener('keydown', resetZenTimer);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
    };
  }, [status, zenModeEnabled]);

  return { isZenActive };
}
