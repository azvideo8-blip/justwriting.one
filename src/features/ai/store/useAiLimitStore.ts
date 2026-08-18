import { create } from 'zustand';

const STORAGE_KEY = 'ai_daily_usage';
// Должно совпадать с DAILY_LIMIT в api/ai/pure.ts: это лишь заглушка до ответа
// сервера, но расхождение показывало бы человеку неверную цену обновления.
const DEFAULT_LIMIT = 30;
// Admin daily cap for the experiment. Must match the server env
// AI_ADMIN_DAILY_LIMIT (chat + editWithAI) — this constant only drives the
// client-side countdown; the server is authoritative.
const ADMIN_LIMIT = 20;

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
  baseLimit: number;
  used: number;
  resetsAt: Date;
  loaded: boolean;
  isAdmin: boolean;
  loadLimit: () => void;
  loadLimitFromServer: () => Promise<void>;
  useRequest: () => void;
  setLimit: (newLimit: number) => void;
  setAdmin: (admin: boolean) => void;
}

export const useAiLimitStore = create<AiLimitState>((set, get) => ({
  remaining: DEFAULT_LIMIT,
  limit: DEFAULT_LIMIT,
  baseLimit: DEFAULT_LIMIT,
  used: 0,
  resetsAt: getMidnightUtc(),
  loaded: false,
  isAdmin: false,

  // Schedule a reset at midnight UTC so an open tab doesn't carry stale quota
  _midnightTimer: typeof window !== 'undefined'
    ? setTimeout(() => { get().loadLimit(); }, (() => {
        const ms = getMidnightUtc().getTime() - Date.now();
        return ms > 0 ? ms : 86_400_000;
      })()) as ReturnType<typeof setTimeout> | null
    : null,

  loadLimit() {
    const { count } = readLocalUsage();
    const limit = get().isAdmin ? ADMIN_LIMIT : get().limit;
    set({ used: count, remaining: Math.max(0, limit - count), resetsAt: getMidnightUtc(), loaded: true });
  },

  async loadLimitFromServer() {
    get().loadLimit();
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

  setLimit(newLimit: number) {
    set(state => {
      const limit = state.isAdmin ? ADMIN_LIMIT : newLimit;
      const remaining = Math.max(0, limit - state.used);
      return { limit, remaining, baseLimit: newLimit };
    });
  },

  setAdmin(admin: boolean) {
    set(state => {
      const limit = admin ? ADMIN_LIMIT : state.baseLimit;
      const remaining = Math.max(0, limit - state.used);
      return { isAdmin: admin, limit, remaining };
    });
  },
}));
