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
