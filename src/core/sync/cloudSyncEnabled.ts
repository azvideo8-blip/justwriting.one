import { getCurrentUser } from '../auth';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

/**
 * Единственный ответ на вопрос «можно ли сейчас отправлять что-либо в облако».
 * Раньше на тумблер смотрела только выгрузка заметок, а разбор, сводки и
 * диалоги уезжали всегда — то есть выключенная синхронизация оставляла на
 * устройстве заметки и продолжала отправлять портрет и разговоры.
 *
 * Примечание: ручные действия пользователя («Отправить все заметки в облако»,
 * «Отправить разбор и диалоги в облако») намеренно выполняются независимо
 * от этого флага, так как явное нажатие кнопки — более сильный сигнал, чем
 * фоновая настройка.
 */
export function cloudSyncEnabled(uid?: string | null): boolean {
  if (typeof localStorage === 'undefined') return false;
  const targetUid = uid !== undefined ? uid : getCurrentUser()?.uid;
  if (!targetUid) return false;
  try {
    let raw = localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(targetUid));
    if (raw === null) {
      const legacy = localStorage.getItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ENABLED);
      if (legacy !== null) {
        localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(targetUid), legacy);
        localStorage.removeItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ENABLED);
        raw = legacy;
      }
    }
    return raw === 'true';
  } catch {
    return false;
  }
}

/** Событие этой вкладки: `storage` приходит только в другие вкладки, и без
 * него индикатор синхронизации держал старое «выключено» после включения. */
export const CLOUD_SYNC_CHANGED = 'jw:cloud-sync-changed';

/** Единственный писатель выбора «синхронизировать с облаком». Ответ на вопрос
 * засчитывается заодно — где бы человек ни выбрал, второй раз не спрашиваем. */
export function setCloudSyncEnabled(uid: string, on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(uid), String(on));
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ASKED(uid), 'true');
  } catch { /* private mode */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CLOUD_SYNC_CHANGED, { detail: uid }));
}
