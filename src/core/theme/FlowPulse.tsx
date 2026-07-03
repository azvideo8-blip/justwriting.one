import { useEffect, useState, useRef } from 'react';

interface FlowPulseProps {
  isActive: boolean;
}

export function FlowPulse({ isActive }: FlowPulseProps) {
  const [spike, setSpike] = useState(false);
  const decayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isActive || prefersReducedMotion) return;
    const handleKey = () => {
      setSpike(true);
      if (decayTimerRef.current) clearTimeout(decayTimerRef.current);
      decayTimerRef.current = setTimeout(() => setSpike(false), 800);
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      if (decayTimerRef.current) clearTimeout(decayTimerRef.current);
    };
  }, [isActive, prefersReducedMotion]);

  return (
    <div style={{
      position: 'fixed',
      left: 0, right: 0, bottom: 0,
      height: 3,
      pointerEvents: 'none',
      zIndex: 100,
      overflow: 'hidden',
    }}>
      <div style={{
        height: '100%',
        background: 'linear-gradient(90deg, transparent, var(--flow-pulse-color) 50%, transparent)',
        width: '60%',
        transform: prefersReducedMotion ? 'translateX(0)' : (spike ? 'translateX(40%)' : 'translateX(-40%)'),
        opacity: isActive ? (prefersReducedMotion ? 0.35 : (spike ? 0.9 : 0.35)) : 0,
        transition: prefersReducedMotion ? 'none' : 'opacity 0.6s ease, transform 1.2s cubic-bezier(.25,.1,.25,1)',
        filter: 'blur(1px)',
      }} />
    </div>
  );
}
