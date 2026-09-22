export interface ExcludableDoc {
  excludedFromAI?: boolean | null | undefined;
  trashedAt?: number | string | null | undefined;
}

/**
 * Единый предикат: исключена ли заметка из контекста и поиска ИИ.
 * Заметка недоступна ИИ, если пользователь явно отключил её (excludedFromAI)
 * ИЛИ если заметка перемещена в корзину (trashedAt).
 */
export function isExcludedFromAI(doc?: ExcludableDoc | null | undefined): boolean {
  if (!doc) return false;
  return Boolean(doc.excludedFromAI || doc.trashedAt);
}
