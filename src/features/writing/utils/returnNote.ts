import type { LocalDocument } from '../../../core/storage/localDb';

/**
 * RA1-3: последняя запись, к которой можно вернуться с пустого главного.
 *
 * - сегодняшняя не считается «после паузы» — иначе карточка висела бы весь
 *   день после каждой записи;
 * - BR-6 (ревью 25.10): сегодня писали — карточки нет вовсе, а не «предложить
 *   что-то посвежее из прошлых дней»: человек уже в деле, подсказка про паузу
 *   ложная;
 * - корзина не последняя запись: предлагать «Продолжить» удалённое нельзя;
 * - из подходящих берём самую свежую (порядок в базе не гарантирован).
 */
export function pickReturnNote(docs: readonly LocalDocument[], startOfToday: number): LocalDocument | null {
  let best: LocalDocument | null = null;
  for (const d of docs) {
    if (d.trashedAt) continue;
    if (!d.lastSessionAt) continue;
    if (d.lastSessionAt >= startOfToday) return null;
    if (!best || d.lastSessionAt > best.lastSessionAt) best = d;
  }
  return best;
}
