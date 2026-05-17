import { useState, useEffect } from 'react';

export function useStartOfToday(): Date {
  const [startOfToday, setStartOfToday] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setStartOfToday(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    };
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    const id = setTimeout(update, msUntilMidnight);
    return () => clearTimeout(id);
  }, []);

  return startOfToday;
}
