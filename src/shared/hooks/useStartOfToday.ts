import { useState, useEffect } from 'react';

export function useStartOfToday(): Date {
  const [startOfToday, setStartOfToday] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      setStartOfToday(prev => {
        if (prev.getTime() === today.getTime()) return prev;
        return today;
      });
    };
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, []);

  return startOfToday;
}
