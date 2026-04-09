import React from 'react';
import { useWritingStore } from './store/useWritingStore';

export function CountdownTimer({ targetTime }: { targetTime: string }) {
  // Подписываемся на seconds, чтобы компонент обновлялся каждую секунду
  const seconds = useWritingStore(s => s.seconds); 

  const [hours, minutes] = targetTime.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  
  const diff = target.getTime() - now.getTime();
  
  if (diff <= 0) return <span>00:00:00</span>;
  
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  
  return <span>{`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`}</span>;
}
