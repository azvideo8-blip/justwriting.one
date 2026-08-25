import { create } from 'zustand';
import { callAi } from '../../../core/ai/callAi';

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

// AUDIT-M12: форма localStorage валидируется — повреждённая запись
// ({count: "999999"} и т.п.) не должна сбивать локальную квоту.
function isValidUsage(v: unknown): v is { count: number; date: string } {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as { count?: unknown }).count === 'number' &&
    Number.isInteger((v as { count: number }).count) &&
    (v as { count: number }).count >= 0 &&
    typeof (v as { date?: unknown }).date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test((v as { date: string }).date)
  );
}

function readLocalUsage(): { count: number; date: string } {
  const today = getUtcDateStr();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValidUsage(parsed) && parsed.date === today) return parsed;
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
  /** AUDIT-part3 3: false = число из локального счётчика, сервером не
   *  подтверждено. true только после ответа /api/getAiQuota. */
  reconciled: boolean;
  isAdmin: boolean;
  loadLimit: () => void;
  loadLimitFromServer: () => Promise<void>;
  useRequest: () => void;
  setLimit: (newLimit: number) => void;
  setAdmin: (admin: boolean) => void;
}

// AUDIT-M12/L14: таймер живёт вне store (не сериализуемый side effect в state),
// перевзводится рекурсивно и пересчитывается при возврате видимости вкладки —
// иначе после сна таба квота висит устаревшая до следующего запроса.
let midnightTimer: ReturnType<typeof setTimeout> | null = null;

function armMidnightReset(get: () => AiLimitState): void {
  if (midnightTimer) clearTimeout(midnightTimer);
  const ms = Math.max(1000, getMidnightUtc().getTime() - Date.now());
  midnightTimer = setTimeout(() => {
    get().loadLimit();
    armMidnightReset(get);
  }, ms);
}

export const useAiLimitStore = create<AiLimitState>((set, get) => ({
  remaining: DEFAULT_LIMIT,
  limit: DEFAULT_LIMIT,
  baseLimit: DEFAULT_LIMIT,
  used: 0,
  resetsAt: getMidnightUtc(),
  loaded: false,
  reconciled: false,
  isAdmin: false,

  loadLimit() {
    const { count } = readLocalUsage();
    const limit = get().isAdmin ? ADMIN_LIMIT : get().limit;
    // Локальное число показывается сразу, но помечено несверенным:
    // источник истины — /api/getAiQuota (см. loadLimitFromServer).
    set({ used: count, remaining: Math.max(0, limit - count), resetsAt: getMidnightUtc(), loaded: true, reconciled: false });
  },

  async loadLimitFromServer() {
    try {
      const quota = await callAi<{ used: number; limit: number; date: string }>('getAiQuota', {});
      // Сервер — источник истины, в том числе для админа. Клампить ответ
      // клиентской константой значит вернуть тот самый дрейф, ради которого
      // эндпоинт и заводился: ADMIN_LIMIT здесь равен 20, а сервер отдаёт 60,
      // и Math.min() молча показывал бы админу втрое меньший остаток.
      // ADMIN_LIMIT остаётся только заглушкой до ответа (см. loadLimit).
      const serverLimit = quota.limit;
      const limit = Number.isFinite(serverLimit) && serverLimit > 0
        ? serverLimit
        : (get().isAdmin ? ADMIN_LIMIT : DEFAULT_LIMIT);
      const used = quota.date === getUtcDateStr() ? quota.used : 0;
      set({
        used,
        limit,
        baseLimit: limit,
        remaining: Math.max(0, limit - used),
        resetsAt: getMidnightUtc(),
        loaded: true,
        reconciled: true,
      });
    } catch {
      // Сеть недоступна / эндпоинт не отвечает — остаёмся на локальном
      // счётчике сознательно (reconciled остаётся false).
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

if (typeof window !== 'undefined') {
  armMidnightReset(() => useAiLimitStore.getState());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) useAiLimitStore.getState().loadLimit();
  });
}
