import { useEffect, useState } from 'react';
import { useWritingStore } from '../../features/writing/store/useWritingStore';

export function FlowPulse() {
  const status = useWritingStore(s => s.status);
  const [intensity, setIntensity] = useState(0);
  const active = status === 'writing';

  useEffect(() => {
    const handleKey = () => {
      if (status !== 'writing') return;
      setIntensity(i => Math.min(1, i + 0.15));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [status]);

  useEffect(() => {
    const t = setInterval(() => {
      setIntensity(i => Math.max(0, i - 0.04));
    }, 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!active) setIntensity(0);
  }, [active]);

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
        transform: `translateX(${intensity * 80 - 40}%)`,
        opacity: active ? 0.3 + intensity * 0.55 : 0,
        transition: 'opacity 0.6s, transform 0.6s cubic-bezier(.4,.2,.2,1)',
        filter: 'blur(1px)',
      }} />
    </div>
  );
}
