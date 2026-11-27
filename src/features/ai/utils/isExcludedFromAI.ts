import { getLocalDb, type LocalDocument as LocalNoteRow } from '../../../core/storage/localDb';

export interface ExcludableDoc {
  excludedFromAI?: boolean | null | undefined;
  trashedAt?: number | string | null | undefined;
}

/**
 * Единый предикат: исключена ли заметка из контекста и поиска ИИ.
 * Заметка недоступна ИИ, если пользователь явно отключил её (excludedFromAI)
 * ИЛИ если заметка перемещена в корзину (trashedAt).
 * S-51: заметки нет (удалена, не прочитана) — тоже недоступна: её текст в
 * старом ходе иначе уходил в модель, хотя самой заметки уже не было.
 */
export function isExcludedFromAI(doc?: ExcludableDoc | null | undefined): boolean {
  if (!doc) return true;
  return Boolean(doc.excludedFromAI || doc.trashedAt);
}

/**
 * S-63: «Вставить как заметку» прикладывает текст под id `pasted-<ts>` — строки
 * в documents у него нет и не будет. Это не заметка, и правило «заметки нет —
 * скрыта» (S-51) к нему не относится: иначе вставленный текст уходил в модель
 * как «[заметка скрыта от ИИ]».
 */
export const PASTED_ATTACHMENT_ID_PREFIX = 'pasted-';
export function isPastedAttachmentId(id: string): boolean {
  return id.startsWith(PASTED_ATTACHMENT_ID_PREFIX);
}

/**
 * DA-4 (дейлик 27.11): строка заметки по любому её номеру. Ссылки на заметку
 * (`/ai?doc=` из граней, вложения чата) приходят то локальным id, то постоянным
 * `uuid`, то `linkedCloudId` — так же, как их видят `hiddenNoteIdsFromDocs` и
 * `docSnapshot`. Промах по ключу — поиск по двум другим. Не нашлась — undefined.
 */
export async function findNoteRow(documentId: string): Promise<LocalNoteRow | undefined> {
  const db = await getLocalDb();
  const direct = await db.get('documents', documentId);
  if (direct) return direct;
  return (await db.getAll('documents')).find(d => d.uuid === documentId || d.linkedCloudId === documentId);
}

/**
 * HA-1/HA-2 (дейлик 26.11): одна проверка перед отправкой текста заметки модели.
 * Нет id — новый, ещё не сохранённый текст: скрывать нечего. Сбой чтения — «скрыта»:
 * «нет ответа» не значит «можно отправить». Заметка ищется по любому номеру (DA-4).
 */
export async function noteHiddenFromAI(documentId: string | null | undefined): Promise<boolean> {
  if (!documentId) return false;
  try {
    return isExcludedFromAI(await findNoteRow(documentId));
  } catch {
    return true;
  }
}
