import { create } from 'zustand';

/**
 * VIS: два стоячих состояния записи, которые человек обязан видеть на экране
 * письма, а не только в журнале.
 *
 * - `rescueNotWritten` — текст прежнего входа не записан на устройство (T1).
 *   С сейфом открытой копии нет (SEC-56), снимок живёт только в памяти
 *   (`draftWriter.ts:231`): закрыл вкладку — потеря. Повтор идёт сам, поэтому
 *   обещание «приложение повторит» проверено кодом (`useDraftAutosave.ts:280`,
 *   `:309`, `:363`, `:416-421`).
 * - `localWriteStuck` — локальная запись отказала подряд (T3): текст только на
 *   экране.
 *
 * Стор, а не поле контекста сессии: состояния ставят писатели (`useDraftCore`,
 * `useDraftAutosave`), а показывает один баннер в обеих раскладках — через
 * контекст он тащился бы через четыре возвращаемых типа сессии.
 *
 * Флаг один на состояние: попытка автосохранения раз в секунду и раз в 30 с его
 * не удваивает, а принятая запись снимает.
 */
interface DraftWriteAlertStore {
  rescueNotWritten: boolean;
  localWriteStuck: boolean;
  setRescueNotWritten: (v: boolean) => void;
  setLocalWriteStuck: (v: boolean) => void;
}

export const useDraftWriteAlertStore = create<DraftWriteAlertStore>((set) => ({
  rescueNotWritten: false,
  localWriteStuck: false,
  setRescueNotWritten: (rescueNotWritten) => set({ rescueNotWritten }),
  setLocalWriteStuck: (localWriteStuck) => set({ localWriteStuck }),
}));
