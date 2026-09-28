import { create } from 'zustand';
import { scrubPii } from '../errors/piiScrub';

export type ActivityLevel = 'error' | 'warning' | 'info' | 'success';

export interface ActivityLogItem {
  id: string;
  time: number;
  message: string;
  context?: Record<string, unknown> | undefined;
  level: ActivityLevel;
  source?: string | undefined;
  count: number;
}

interface ActivityLogState {
  entries: ActivityLogItem[];
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  addActivity: (
    messageOrError: unknown,
    context?: Record<string, unknown>,
    level?: ActivityLevel,
    source?: string
  ) => string;
  updateEntry: (id: string, patch: Partial<ActivityLogItem>) => void;
  // Legacy alias for compatibility, eventually remove
  addError: (
    error: unknown,
    context?: Record<string, unknown>,
    level?: ActivityLevel,
    source?: string
  ) => void;
  clearLog: () => void;
  dismissEntry: (id: string) => void;
}

const STORAGE_KEY = 'activity_log_v1';
const MAX_MEMORY_ENTRIES = 200;
const MAX_STORAGE_ENTRIES = 50;
const DEDUPE_WINDOW_MS = 10_000;

function loadInitialEntries(): ActivityLogItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Also try to migrate old error log if new one doesn't exist
    if (!raw) {
      const oldRaw = localStorage.getItem('error_log_v1');
      if (!oldRaw) return [];
      const parsed = JSON.parse(oldRaw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.slice(0, MAX_STORAGE_ENTRIES).map(item => ({
          id: String(item.id || `act_${Date.now()}`),
          time: typeof item.time === 'number' ? item.time : Date.now(),
          message: String(item.message || 'Unknown error'),
          context: item.context && typeof item.context === 'object' ? item.context : undefined,
          level: (item.level === 'warning' || item.level === 'info' || item.level === 'success') ? item.level : 'error',
          source: item.source ? String(item.source) : undefined,
          count: typeof item.count === 'number' && item.count > 0 ? item.count : 1,
        }));
      }
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.slice(0, MAX_STORAGE_ENTRIES).map(item => ({
        id: String(item.id || `act_${Date.now()}`),
        time: typeof item.time === 'number' ? item.time : Date.now(),
        message: String(item.message || 'Unknown event'),
        context: item.context && typeof item.context === 'object' ? item.context : undefined,
        level: (item.level === 'warning' || item.level === 'info' || item.level === 'success') ? item.level : 'error',
        source: item.source ? String(item.source) : undefined,
        count: typeof item.count === 'number' && item.count > 0 ? item.count : 1,
      }));
    }
  } catch {
    // Ignore corrupt storage
  }
  return [];
}

function saveEntries(entries: ActivityLogItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_STORAGE_ENTRIES)));
  } catch {
    // Ignore storage write errors (e.g. quota)
  }
}

// Сообщение уходит в localStorage и в кнопку «скопировать журнал», поэтому
// содержимое заметок в нём быть не может. Режем по длине и вычищаем то, что
// заведомо является данными, а не описанием ошибки.
const MAX_MESSAGE_LENGTH = 200;

export function scrubMessage(raw: string): string {
  return raw
    // строки в кавычках — почти всегда прилетевшее значение, а не текст ошибки
    .replace(/"[^"]{20,}"|'[^']{20,}'|«[^»]{20,}»/g, match => `${match[0]}…${match[match.length - 1]}`)
    // base64-подобные простыни: шифротекст, ключи, вложения
    .replace(/[A-Za-z0-9+/=]{40,}/g, '[data]')
    .slice(0, MAX_MESSAGE_LENGTH);
}

function extractMessage(errorOrMessage: unknown): string {
  let raw = '';
  if (errorOrMessage instanceof Error) {
    raw = errorOrMessage.message || errorOrMessage.name || 'Error';
  } else if (typeof errorOrMessage === 'string') {
    raw = errorOrMessage;
  } else if (errorOrMessage && typeof errorOrMessage === 'object') {
    const obj = errorOrMessage as { message?: unknown; reason?: unknown; code?: unknown; name?: unknown };
    const msg = obj.message ?? obj.reason;
    if (typeof msg === 'string') {
      raw = msg;
    } else {
      const ctor = errorOrMessage.constructor?.name || 'Object';
      const detail = [obj.name, obj.code].filter(v => typeof v === 'string' || typeof v === 'number').join(': ');
      raw = detail ? `${ctor} (${detail})` : ctor;
    }
  } else {
    raw = String(errorOrMessage ?? 'Unknown event');
  }
  return scrubMessage(raw);
}

export const useActivityLogStore = create<ActivityLogState>((set, get) => ({
  entries: loadInitialEntries(),
  panelOpen: false,
  setPanelOpen: (open) => set({ panelOpen: open }),

  addActivity: (messageOrError, rawContext, level = 'info', source) => {
    const message = extractMessage(messageOrError);
    // Контекст проходит тот же PII-фильтр, что и reportError: прямые вызовы
    // addActivity раньше писали контекст дословно, и следующий вызывающий мог
    // положить в него заголовок или фрагмент заметки.
    const context = scrubPii(rawContext);
    const now = Date.now();
    const current = get().entries;
    const first = current[0];

    const isActionMatch =
      first?.context !== undefined && context !== undefined
      && first.context.action !== undefined && context.action !== undefined
      && first.context.action === context.action;
    const isSameSource = first?.source === source || isActionMatch;
    const isSameMessage = first?.message === message;
    const isRecent = first && now - first.time <= DEDUPE_WINDOW_MS;

    if (first && isSameMessage && isSameSource && isRecent) {
      const updated: ActivityLogItem = {
        ...first,
        time: now,
        count: first.count + 1,
        context: Object.keys(context).length > 0 ? { ...(first.context ?? {}), ...context } : first.context,
      };
      const nextEntries = [updated, ...current.slice(1)];
      set({ entries: nextEntries });
      saveEntries(nextEntries);
      return first.id;
    }

    const newItem: ActivityLogItem = {
      id: `act_${now}_${Math.random().toString(36).slice(2, 7)}`,
      time: now,
      message,
      context: Object.keys(context).length > 0 ? context : undefined,
      level,
      source,
      count: 1,
    };

    const nextEntries = [newItem, ...current].slice(0, MAX_MEMORY_ENTRIES);
    set({ entries: nextEntries });
    saveEntries(nextEntries);
    return newItem.id;
  },

  updateEntry: (id, patch) => {
    const current = get().entries;
    const index = current.findIndex(e => e.id === id);
    if (index === -1) return;
    const existing = current[index]!;
    const updated: ActivityLogItem = {
      ...existing,
      ...patch,
      id: existing.id,
    };
    const nextEntries = [...current];
    nextEntries[index] = updated;
    set({ entries: nextEntries });
    saveEntries(nextEntries);
  },

  addError: (error, context, level = 'error', source) => {
    get().addActivity(error, context, level, source);
  },

  clearLog: () => {
    set({ entries: [], panelOpen: false });
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  },

  dismissEntry: (id) => {
    const nextEntries = get().entries.filter(e => e.id !== id);
    set({ entries: nextEntries });
    saveEntries(nextEntries);
  },
}));
