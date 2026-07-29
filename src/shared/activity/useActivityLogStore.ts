import { create } from 'zustand';

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
  ) => void;
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

function extractMessage(errorOrMessage: unknown): string {
  if (errorOrMessage instanceof Error) return errorOrMessage.message || errorOrMessage.name || 'Error';
  if (typeof errorOrMessage === 'string') return errorOrMessage;
  if (errorOrMessage && typeof errorOrMessage === 'object') {
    const msg = (errorOrMessage as { message?: unknown; reason?: unknown }).message ?? (errorOrMessage as { reason?: unknown }).reason;
    if (typeof msg === 'string') return msg;
    try {
      return JSON.stringify(errorOrMessage);
    } catch {
      return String(errorOrMessage);
    }
  }
  return String(errorOrMessage ?? 'Unknown event');
}

export const useActivityLogStore = create<ActivityLogState>((set, get) => ({
  entries: loadInitialEntries(),
  panelOpen: false,
  setPanelOpen: (open) => set({ panelOpen: open }),

  addActivity: (messageOrError, context, level = 'info', source) => {
    const message = extractMessage(messageOrError);
    const now = Date.now();
    const current = get().entries;
    const first = current[0];

    const isActionMatch =
      first?.context && context && first.context.action && context.action && first.context.action === context.action;
    const isSameSource = first?.source === source || isActionMatch;
    const isSameMessage = first?.message === message;
    const isRecent = first && now - first.time <= DEDUPE_WINDOW_MS;

    if (first && isSameMessage && isSameSource && isRecent) {
      const updated: ActivityLogItem = {
        ...first,
        time: now,
        count: first.count + 1,
        context: context ?? first.context,
      };
      const nextEntries = [updated, ...current.slice(1)];
      set({ entries: nextEntries });
      saveEntries(nextEntries);
      return;
    }

    const newItem: ActivityLogItem = {
      id: `act_${now}_${Math.random().toString(36).slice(2, 7)}`,
      time: now,
      message,
      context,
      level,
      source,
      count: 1,
    };

    const nextEntries = [newItem, ...current].slice(0, MAX_MEMORY_ENTRIES);
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
