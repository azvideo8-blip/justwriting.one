import { create } from 'zustand';
import { getAuth } from 'firebase/auth';

const STORAGE_KEY = 'ai_daily_usage';
const DEFAULT_LIMIT = 10;
// LX-2a: Admins get effectively unlimited — set a very high limit so the
// client-side pre-check (remaining <= 0) never blocks them.
const ADMIN_LIMIT = 100_000;

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
  used: 0,
  resetsAt: getMidnightUtc(),
  loaded: false,
  isAdmin: false,

  loadLimit() {
    const { count } = readLocalUsage();
    const limit = get().isAdmin ? ADMIN_LIMIT : get().limit;
    set({ used: count, remaining: Math.max(0, limit - count), resetsAt: getMidnightUtc(), loaded: true });
  },

  async loadLimitFromServer() {
    const user = getAuth().currentUser;
    if (!user) {
      get().loadLimit();
      return;
    }
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const { getDb } = await import('../../../core/firebase/firestore');
      const db = await getDb();
      const date = getUtcDateStr();
      const snap = await getDoc(doc(db, 'aiDailyLimit', user.uid));
      const data = snap.data();
      const used = (data?.date === date) ? (data?.count ?? 0) : 0;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: used, date }));
      const limit = get().isAdmin ? ADMIN_LIMIT : get().limit;
      set({ used, limit, remaining: Math.max(0, limit - used), resetsAt: getMidnightUtc(), loaded: true });
    } catch {
      get().loadLimit();
    }
  },

  useRequest() {
    // LX-2a: Admins don't track client-side usage
    if (get().isAdmin) return;
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
      return { limit, remaining };
    });
  },

  setAdmin(admin: boolean) {
    set(state => {
      const limit = admin ? ADMIN_LIMIT : DEFAULT_LIMIT;
      const remaining = Math.max(0, limit - state.used);
      return { isAdmin: admin, limit, remaining };
    });
  },
}));
