import { useState, useEffect } from 'react';

export function useStartOfToday(): Date {
  const [startOfToday, setStartOfToday] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  useEffect(() => {
    const scheduleNextMidnight = () => {
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const msUntilMidnight = tomorrow.getTime() - now.getTime();
      return setTimeout(() => {
        const n = new Date();
        setStartOfToday(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
        timerId = scheduleNextMidnight();
      }, msUntilMidnight);
    };
    let timerId = scheduleNextMidnight();
    return () => clearTimeout(timerId);
  }, []);

  return startOfToday;
}
