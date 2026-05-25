import { useEffect, useState, useRef } from 'react';

interface FlowPulseProps {
  isActive: boolean;
}

export function FlowPulse({ isActive }: FlowPulseProps) {
  const [spike, setSpike] = useState(false);
  const decayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isActive) return;
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
  }, [isActive]);

  return (
    <div style={{
      position: 'fixed',
      left: 0, right: 0, bottom: 0,
      height: 2,
      pointerEvents: 'none',
      zIndex: 100,
      overflow: 'hidden',
    }}>
      <div style={{
        height: '100%',
        background: 'linear-gradient(90deg, transparent, var(--flow-pulse-color) 50%, transparent)',
        width: '60%',
        transform: spike ? 'translateX(40%)' : 'translateX(-40%)',
        opacity: isActive ? (spike ? 0.85 : 0.3) : 0,
        transition: 'opacity 0.6s ease, transform 1.2s cubic-bezier(.25,.1,.25,1)',
        filter: 'blur(1px)',
      }} />
    </div>
  );
}
