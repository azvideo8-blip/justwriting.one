import { create } from 'zustand';

export interface ErrorLogItem {
  id: string;
  time: number;
  message: string;
  context?: Record<string, unknown> | undefined;
  level: 'error' | 'warning';
  source?: string | undefined;
  count: number;
}

interface ErrorLogState {
  entries: ErrorLogItem[];
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  addError: (
    error: unknown,
    context?: Record<string, unknown>,
    level?: 'error' | 'warning',
    source?: string
  ) => void;
  clearLog: () => void;
  dismissEntry: (id: string) => void;
}

const STORAGE_KEY = 'error_log_v1';
const MAX_MEMORY_ENTRIES = 50;
const MAX_STORAGE_ENTRIES = 20;
const DEDUPE_WINDOW_MS = 10_000;

function loadInitialEntries(): ErrorLogItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.slice(0, MAX_STORAGE_ENTRIES).map(item => ({
        id: String(item.id || `err_${Date.now()}`),
        time: typeof item.time === 'number' ? item.time : Date.now(),
        message: String(item.message || 'Unknown error'),
        context: item.context && typeof item.context === 'object' ? item.context : undefined,
        level: item.level === 'warning' ? 'warning' : 'error',
        source: item.source ? String(item.source) : undefined,
        count: typeof item.count === 'number' && item.count > 0 ? item.count : 1,
      }));
    }
  } catch {
    // Ignore corrupt storage
  }
  return [];
}

function saveEntries(entries: ErrorLogItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_STORAGE_ENTRIES)));
  } catch {
    // Ignore storage write errors (e.g. quota)
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || 'Error';
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const msg = (error as { message?: unknown; reason?: unknown }).message ?? (error as { reason?: unknown }).reason;
    if (typeof msg === 'string') return msg;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error ?? 'Unknown error');
}

export const useErrorLogStore = create<ErrorLogState>((set, get) => ({
  entries: loadInitialEntries(),
  panelOpen: false,
  setPanelOpen: (open) => set({ panelOpen: open }),

  addError: (error, context, level = 'error', source) => {
    const message = extractErrorMessage(error);
    const now = Date.now();
    const current = get().entries;
    const first = current[0];

    const isActionMatch =
      first?.context && context && first.context.action && context.action && first.context.action === context.action;
    const isSameSource = first?.source === source || isActionMatch;
    const isSameMessage = first?.message === message;
    const isRecent = first && now - first.time <= DEDUPE_WINDOW_MS;

    if (first && isSameMessage && isSameSource && isRecent) {
      const updated: ErrorLogItem = {
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

    const newItem: ErrorLogItem = {
      id: `err_${now}_${Math.random().toString(36).slice(2, 7)}`,
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
