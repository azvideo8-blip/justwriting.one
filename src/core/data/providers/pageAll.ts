import { reportError } from '../../../shared/errors/reportError';

export const PAGE_SIZE = 1000;

export interface PageQueryResult<T> {
  data: T[] | null;
  error: unknown;
}

export type PageQueryBuilder<T> = (
  from: number,
  to: number,
) => PromiseLike<PageQueryResult<T>>;

/**
 * DUP-5: Canonical PostgREST pagination loop.
 * Any bulk read query against tables that grow per note or version must be paginated
 * in batches of PAGE_SIZE (1000) to prevent silent truncation by PostgREST.
 */
export async function pageAll<T>(
  buildQuery: PageQueryBuilder<T>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  let from = 0;
  const allRows: T[] = [];
  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error != null) throw error;
    if (data === null || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

/**
 * TB-14: каждый запрос фильтрует по владельцу, но это просьба к серверу, а не
 * гарантия. Сломанный RLS или подменённый ответ отдаст чужие строки, и без
 * сейфа чужой открытый текст лёг бы в заметки этого человека. Чужие строки
 * списка отбрасываются. Одиночная чужая строка — ошибка чтения, а не «строки
 * нет»: «нет» дальше читалось бы как «удалено».
 */
export function ownRows<T>(rows: T[], userId: string, col = 'user_id'): T[] {
  const own = rows.filter(r => (r as Record<string, unknown>)[col] === userId);
  if (own.length !== rows.length) {
    reportError(new Error('FOREIGN_ROWS: the server returned rows of another account'),
      { action: 'foreignRowsDropped', dropped: rows.length - own.length }, 'warning');
  }
  return own;
}

export function ownRow<T>(row: T | null, userId: string, col = 'user_id'): T | null {
  if (row != null && (row as Record<string, unknown>)[col] !== userId) {
    throw new Error('FOREIGN_ROW: the server returned a row of another account');
  }
  return row;
}
