import { useEffect } from 'react';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { getCurrentUser } from '../../../core/auth';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

interface DailyLimitState {
  used: number;
  limit: number;
  remaining: number;
  reasoningUsed: number;
  reasoningLimit: number;
  reasoningRemaining: number;
  resetsAt: Date;
  /** SA-2: сервер не смог прочитать лимит — показывать прошлое число нельзя. */
  limitUnknown: boolean;
}

export function useDailyLimit(): DailyLimitState {
  const {
    used,
    limit,
    remaining,
    reasoningUsed,
    reasoningLimit,
    reasoningRemaining,
    resetsAt,
    limitUnknown,
    loaded,
    loadLimitFromServer,
  } = useAiLimitStore();

  useEffect(() => {
    if (loaded) return;
    void loadLimitFromServer();
  }, [loaded, loadLimitFromServer]);

  useEffect(() => {
    const interval = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== new Date(resetsAt).toISOString().slice(0, 10)) {
        void loadLimitFromServer();
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [resetsAt, loadLimitFromServer]);

  return { used, limit, remaining, reasoningUsed, reasoningLimit, reasoningRemaining, resetsAt, limitUnknown };
}

export function incrementDailyUsage(reasoning?: boolean): void {
  useAiLimitStore.getState().useRequest(reasoning);
}

export function setDailyLimitExhausted(reasoning?: boolean): void {
  const state = useAiLimitStore.getState();
  const key = STORAGE_KEYS.AI_LIMIT(getCurrentUser()?.uid);
  const today = new Date().toISOString().slice(0, 10);
  // 429 — это сервер сам сказал «исчерпано»: отметка «данные недоступны» больше не нужна.
  if (reasoning) {
    const reasoningLimit = state.reasoningLimit;
    useAiLimitStore.setState({ reasoningUsed: reasoningLimit, reasoningRemaining: 0, limitUnknown: false });
    try {
      const raw = localStorage.getItem(key);
      const prev = raw ? JSON.parse(raw) : {};
      localStorage.setItem(key, JSON.stringify({ ...prev, reasoningCount: reasoningLimit, date: today }));
    } catch { /* ignore */ }
  } else {
    const limit = state.limit;
    useAiLimitStore.setState({ used: limit, remaining: 0, limitUnknown: false });
    try {
      const raw = localStorage.getItem(key);
      const prev = raw ? JSON.parse(raw) : {};
      localStorage.setItem(key, JSON.stringify({ ...prev, count: limit, date: today }));
    } catch { /* ignore */ }
  }
}
