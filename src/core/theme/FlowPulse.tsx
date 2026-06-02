import { useEffect, useState, useRef } from 'react';

interface FlowPulseProps {
  isActive: boolean;
}

export function FlowPulse({ isActive }: FlowPulseProps) {
  const [spike, setSpike] = useState(false);
  const decayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const barStyle = {
    transform: spike ? 'translateX(40%)' : 'translateX(-40%)',
    opacity: isActive ? (spike ? 0.85 : 0.3) : 0,
  };

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
    <div className="fixed left-0 right-0 bottom-0 h-[2px] pointer-events-none z-[100] overflow-hidden">
      <div
        className="h-full w-[60%] blur-[1px] bg-[linear-gradient(90deg,transparent,var(--flow-pulse-color)_50%,transparent)] transition-[opacity,transform] duration-[0.6s,1.2s] ease-[ease,cubic-bezier(.25,.1,.25,1)]"
        style={barStyle}
      />
    </div>
  );
}
