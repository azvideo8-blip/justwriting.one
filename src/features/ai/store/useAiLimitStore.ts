import { create } from 'zustand';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';

const STORAGE_KEY = 'ai_daily_usage';
const DEFAULT_LIMIT = 50;

function getUtcDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getMidnightUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function readLocalUsage(): { count: number; date: string } {
  const today = getUtcDateStr();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { count: number; date: string };
      if (parsed.date === today) return parsed;
    } catch { /* ignore */ }
  }
  return { count: 0, date: today };
}

interface AiLimitState {
  remaining: number;
  limit: number;
  used: number;
  resetsAt: Date;
  loaded: boolean;
  loadLimit: () => void;
  loadLimitFromServer: () => Promise<void>;
  useRequest: () => void;
}

export const useAiLimitStore = create<AiLimitState>((set, get) => ({
  remaining: DEFAULT_LIMIT,
  limit: DEFAULT_LIMIT,
  used: 0,
  resetsAt: getMidnightUtc(),
  loaded: false,

  loadLimit() {
    const { count } = readLocalUsage();
    const limit = get().limit;
    set({ used: count, remaining: Math.max(0, limit - count), resetsAt: getMidnightUtc(), loaded: true });
  },

  async loadLimitFromServer() {
    const user = getAuth().currentUser;
    if (!user) {
      get().loadLimit();
      return;
    }
    try {
      const fn = httpsCallable<unknown, { used: number; limit: number; date: string }>(
        getFunctions(), 'getAILimit'
      );
      const { data } = await fn({});
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: data.used, date: data.date }));
      set({ used: data.used, limit: data.limit, remaining: Math.max(0, data.limit - data.used), resetsAt: getMidnightUtc(), loaded: true });
    } catch {
      get().loadLimit();
    }
  },

  useRequest() {
    const today = getUtcDateStr();
    const { count: localCount, date: localDate } = readLocalUsage();
    const count = localDate === today ? localCount : 0;
    const newCount = count + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: newCount, date: today }));
    const limit = get().limit;
    set({ used: newCount, remaining: Math.max(0, limit - newCount) });
  },
}));
