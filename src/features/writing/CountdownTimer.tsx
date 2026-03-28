import React, { useState, useEffect } from 'react';

interface CountdownTimerProps {
  targetTime: string;
}

export function CountdownTimer({ targetTime }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      const [hours, minutes] = targetTime.split(':').map(Number);
      const now = new Date();
      const target = new Date();
      target.setHours(hours, minutes, 0, 0);
      
      const diff = target.getTime() - now.getTime();
      
      if (diff <= 0) {
        setTimeLeft('00:00:00');
        clearInterval(interval);
        return;
      }
      
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      
      setTimeLeft(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [targetTime]);

  return <span>{timeLeft}</span>;
}
