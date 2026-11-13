import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

/** TR-1: исход знакомства. Живёт только в localStorage этого устройства. */
export type TourState = 'done' | `skipped:${number}`;
/** `null` — записи нет; `'unknown'` — хранилище не ответило (это не «записи нет»). */
export type TourStateRead = TourState | null | 'unknown';

export function readTourState(uid: string): TourStateRead {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TOUR_STATE(uid));
    if (raw === null) return null;
    // Битая запись — «уже показывали»: из-за мусора тур второй раз не всплывает.
    return /^skipped:[1-9]$/.test(raw) ? (raw as TourState) : 'done';
  } catch {
    return 'unknown';
  }
}

export function writeTourState(uid: string, value: TourState): void {
  try {
    localStorage.setItem(STORAGE_KEYS.TOUR_STATE(uid), value);
  } catch {
    /* хранилища нет — тур просто покажется ещё раз */
  }
}
