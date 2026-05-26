import { useEffect } from 'react';
import { useAiLimitStore } from '../store/useAiLimitStore';

interface DailyLimitState {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: Date;
}

export function useDailyLimit(): DailyLimitState {
  const { used, limit, remaining, resetsAt, loadLimit } = useAiLimitStore();

  useEffect(() => {
    loadLimit();
  }, [loadLimit]);

  useEffect(() => {
    const interval = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== new Date(resetsAt).toISOString().slice(0, 10)) {
        loadLimit();
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [resetsAt, loadLimit]);

  return { used, limit, remaining, resetsAt };
}

export function incrementDailyUsage(): void {
  useAiLimitStore.getState().useRequest();
}

export function setDailyLimitExhausted(): void {
  const limit = useAiLimitStore.getState().limit;
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem('ai_daily_usage', JSON.stringify({ count: limit, date: today }));
  useAiLimitStore.setState({ used: limit, remaining: 0 });
}
