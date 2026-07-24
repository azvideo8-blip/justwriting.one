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

const DEFAULT_FLAGS: MemoryFeatureFlags = {
  ff_memory_assembler_shadow: true,
  ff_memory_assembler_chat_memory: false,
  ff_memory_assembler_retrieval: false,
  ff_memory_assembler_turn1: false,
  ff_memory_assembler_portrait: false,
};

let currentFlags: MemoryFeatureFlags = { ...DEFAULT_FLAGS };

export const MemoryFlagsService = {
  getFlags(): MemoryFeatureFlags {
    return { ...currentFlags };
  },

  setFlag<K extends keyof MemoryFeatureFlags>(key: K, value: boolean): void {
    currentFlags[key] = value;
  },

  resetFlags(): void {
    currentFlags = { ...DEFAULT_FLAGS };
  },
};
