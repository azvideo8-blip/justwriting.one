export interface MemoryFeatureFlags {
  /** If true, W2 memory assembler runs in shadow mode logging to injectionJournal without affecting prod output. */
  ff_memory_assembler_shadow: boolean;
  /** Cutover chat memory to W2 assembler. */
  ff_memory_assembler_chat_memory: boolean;
  /** Cutover retrieval / RAG search context to W2 assembler. */
  ff_memory_assembler_retrieval: boolean;
  /** Cutover turn-1 proactive context to W2 assembler. */
  ff_memory_assembler_turn1: boolean;
  /** Cutover user portrait to W2 assembler. */
  ff_memory_assembler_portrait: boolean;
}

const STORAGE_KEY = 'justwriting_memory_flags';

const DEFAULT_FLAGS: MemoryFeatureFlags = {
  ff_memory_assembler_shadow: true,
  ff_memory_assembler_chat_memory: false,
  ff_memory_assembler_retrieval: false,
  ff_memory_assembler_turn1: false,
  ff_memory_assembler_portrait: false,
};

function loadStoredFlags(): MemoryFeatureFlags {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<MemoryFeatureFlags>;
        return { ...DEFAULT_FLAGS, ...parsed };
      }
    }
  } catch {
    /* fallback to default */
  }
  return { ...DEFAULT_FLAGS };
}

let currentFlags: MemoryFeatureFlags = loadStoredFlags();

function saveStoredFlags(flags: MemoryFeatureFlags): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
    }
  } catch {
    /* ignore storage write failures */
  }
}

export const MemoryFlagsService = {
  getFlags(): MemoryFeatureFlags {
    return { ...currentFlags };
  },

  setFlag<K extends keyof MemoryFeatureFlags>(key: K, value: boolean): void {
    currentFlags[key] = value;
    saveStoredFlags(currentFlags);
  },

  resetFlags(): void {
    currentFlags = { ...DEFAULT_FLAGS };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  },

  reloadFlags(): void {
    currentFlags = loadStoredFlags();
  },
};
