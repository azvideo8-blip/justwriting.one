import { create } from 'zustand';

/**
 * VIS T3: локальная запись отказала подряд, текст только на экране. Человек
 * обязан видеть это из письма, а не только в журнале.
 *
 * Стор, а не поле контекста сессии: состояние ставят писатели, а показывает один
 * баннер в обеих раскладках. Флаг один на состояние: попытка автосохранения раз в
 * секунду его не удваивает, а принятая запись снимает.
 */
interface DraftWriteAlertStore {
  localWriteStuck: boolean;
  setLocalWriteStuck: (v: boolean) => void;
}

export const useDraftWriteAlertStore = create<DraftWriteAlertStore>((set) => ({
  localWriteStuck: false,
  setLocalWriteStuck: (localWriteStuck) => set({ localWriteStuck }),
}));
