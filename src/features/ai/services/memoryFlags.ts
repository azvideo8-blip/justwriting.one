import { reportError } from '../../../shared/errors/reportError';

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
  /**
   * Cutover consolidated beliefs (W3) to W2 assembler.
   *
   * DEEP-P3, решено 2026-09-07: остаётся выключенным до закрытой беты.
   *
   * Включённый флаг подставляет в системный промпт КАЖДОГО хода строки вида
   * «[Убеждение] «…» (впервые записал <дата>, доказательства: [#docId])» —
   * утверждения о человеке, выведенные моделью из его же заметок
   * (`AIMemoryAssembler`, категория 'belief'). Сегодня их видно только на
   * админской вкладке `/diagnostics` → «Убеждения», и она read-only.
   *
   * Условие включения: сначала экран, где человек видит свои убеждения с
   * датами и ссылками на заметки-доказательства и может удалить любое,
   * причём удаление переживает следующую консолидацию (заготовка —
   * `aiBeliefRejections`) и доезжает до облака, иначе убеждение вернётся с
   * другого устройства. Ассистент не должен опираться на утверждения о
   * человеке, которых человек не видел и не может исправить.
   *
   * Вернуться к вопросу вместе с остальным cutover'ом памяти: соседние
   * четыре флага выключены по той же причине и решаются одним разговором.
   */
  ff_memory_assembler_beliefs: boolean;
}

const STORAGE_KEY = 'justwriting_memory_flags';

const DEFAULT_FLAGS: MemoryFeatureFlags = {
  ff_memory_assembler_shadow: true,
  ff_memory_assembler_chat_memory: false,
  ff_memory_assembler_retrieval: false,
  ff_memory_assembler_turn1: false,
  ff_memory_assembler_portrait: false,
  ff_memory_assembler_beliefs: false,
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
  } catch (e) {
    // Это выбор человека: не сохранился — должно быть видно.
    reportError(e, { action: 'saveStoredFlags' }, 'warning');
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
