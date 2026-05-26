import { create } from 'zustand';

const STORAGE_KEY = 'ai_daily_usage';
const DEFAULT_LIMIT = 50;

function getUtcDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getMidnightUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

interface AiLimitState {
  remaining: number;
  limit: number;
  used: number;
  resetsAt: Date;
  loadLimit: () => void;
  useRequest: () => void;
}

export const useAiLimitStore = create<AiLimitState>((set, get) => ({
  remaining: DEFAULT_LIMIT,
  limit: DEFAULT_LIMIT,
  used: 0,
  resetsAt: getMidnightUtc(),

  loadLimit() {
    const today = getUtcDateStr();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { count: number; date: string };
        if (parsed.date === today) {
          const used = parsed.count;
          const limit = get().limit;
          set({ used, remaining: Math.max(0, limit - used), resetsAt: getMidnightUtc() });
          return;
        }
      } catch { /* ignore */ }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: 0, date: today }));
    set({ used: 0, remaining: get().limit, resetsAt: getMidnightUtc() });
  },

  useRequest() {
    const today = getUtcDateStr();
    const raw = localStorage.getItem(STORAGE_KEY);
    let count = 0;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { count: number; date: string };
        if (parsed.date === today) count = parsed.count;
      } catch { /* ignore */ }
    }
    const newCount = count + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: newCount, date: today }));
    const limit = get().limit;
    set({ used: newCount, remaining: Math.max(0, limit - newCount) });
  },
}));
