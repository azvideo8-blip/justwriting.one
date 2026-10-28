import { DocumentService, type UnreadableCloudListError } from './DocumentService';
import type { Document } from '../../types';

/**
 * R-2 (S1-10): списочный читатель бросает UnreadableCloudListError с
 * прочитанной частью. Полнота нужна только решениям «по отсутствию» (TB-14
 * requeue, сдвиг курсора, сверка перепривязки по времени) — остальным
 * вызывающим прочитанное надо качать/показывать с пометкой неполноты, а не
 * превращать в пустой список. Проверка по имени, не instanceof: тесты мокают
 * модуль DocumentService целиком, и класса в моке нет.
 */
export function isUnreadableCloudList(e: unknown): e is UnreadableCloudListError {
  return e instanceof Error && e.name === 'UnreadableCloudListError' && Array.isArray((e as { docs?: unknown }).docs);
}

export interface PartialCloudList {
  docs: Document[];
  /** id нечитаемых рядов; пусто — список полный. */
  unreadable: string[];
  uuids: string[];
}

export async function readCloudDocumentsPartial(userId: string): Promise<PartialCloudList> {
  try {
    return { docs: await DocumentService.getUserDocuments(userId), unreadable: [], uuids: [] };
  } catch (e) {
    if (!isUnreadableCloudList(e)) throw e;
    return { docs: e.docs, unreadable: e.ids, uuids: e.uuids ?? [] };
  }
}
