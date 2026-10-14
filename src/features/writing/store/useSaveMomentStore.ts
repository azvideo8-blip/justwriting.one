import { create } from 'zustand';

/**
 * MC-4: момент после «Сохранить» на телефоне. Окно завершения говорит его само
 * (тихая строка в шапке письма вместо всплывающего тоста), а три «не в облаке»
 * случая — той же строкой, но предупреждением: они обязаны остаться видимыми
 * (поправка ревьюера к MC-4).
 */
export interface SaveMoment {
  /** Идентификатор показа: одно и то же содержимое, показанное второй раз,
   *  должно перезапустить анимацию. */
  id: number;
  words: number;
  /** Серия после сохранения; `null` — не показывать хвост «· серия N дня». */
  streakDays: number | null;
  /** Текст-предупреждение (локальная копия, слишком большая заметка …). */
  warningText: string | null;
  /** Текст сохранённой заметки — призрак, который гаснет вместо мгновенного
   *  «редактор опустел». */
  text: string;
}

interface SaveMomentStore {
  moment: SaveMoment | null;
  announce: (m: Omit<SaveMoment, 'id'>) => void;
  clear: () => void;
}

export const useSaveMomentStore = create<SaveMomentStore>((set) => ({
  moment: null,
  announce: (m) => set({ moment: { ...m, id: Date.now() } }),
  clear: () => set({ moment: null }),
}));

/** Сколько живёт строка: успех — 1,2 с, предупреждение — 3 с. */
export const SAVE_MOMENT_MS = 1_200;
export const SAVE_WARNING_MS = 3_000;
