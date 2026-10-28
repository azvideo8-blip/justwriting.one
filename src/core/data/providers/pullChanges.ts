import { getSupabase } from '../../supabase/client';
import type { PullChangesPage, PullChangesRow, PullChangesTable } from '../types';
import { ownRows } from './pageAll';

/**
 * S1-4: забор «всё после номера N» — keyset по `rev`, без смещения.
 *
 * Отличие от `pageAll`: там `range(from, to)` считается от начала таблицы, и
 * между страницами вставка сдвигает окно — строки пропускаются или читаются
 * дважды. Здесь курсор — номер последней ПРИМЕНЁННОЙ строки, поэтому страница
 * обязана идти строго по возрастанию `rev` и только `> since`; любой другой
 * ответ — «не прочитан», а не «данных нет».
 *
 * `lastRev` — номер последней строки страницы, а не максимум таблицы или
 * последовательности: устройство не имеет права забегать вперёд того, что
 * действительно получило.
 */

/** Сервер не знает колонку `rev` (0045 не применена): забор невозможен. */
export class RevUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevUnavailableError';
  }
}

function isMissingRevColumn(error: unknown): boolean {
  // PostgREST на отсутствующую колонку отвечает 42703. Другого источника этой
  // ошибки у запроса нет: в фильтре, сортировке и выборке участвует только rev.
  return typeof error === 'object' && error !== null
    && (error as { code?: unknown }).code === '42703';
}

function assertPageOrder(rows: PullChangesRow[], sinceRev: number, table: PullChangesTable): void {
  let prev = sinceRev;
  for (const row of rows) {
    const rev = row.rev;
    if (typeof rev !== 'number' || !Number.isFinite(rev) || rev <= prev) {
      throw new Error(
        `PULL_OUT_OF_ORDER: ${table} page expected rev > ${prev}, got ${String(rev)} — ответ не прочитан`,
      );
    }
    prev = rev;
  }
}

export async function pullChangesSince(
  userId: string,
  table: PullChangesTable,
  sinceRev: number,
  limit = 1000,
): Promise<PullChangesPage> {
  if (!Number.isInteger(sinceRev) || sinceRev < 0) {
    throw new Error(`PULL_SINCE_INVALID: ${String(sinceRev)}`);
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`PULL_LIMIT_INVALID: ${String(limit)}`);
  }

  const supabase = getSupabase();
  const query = table === 'documents'
    // Надгробия обязательны: удаление приезжает новой строкой, а не отсутствием
    // в списке. `select('*')` намеренно — заметке нужны все поля строки.
    ? supabase.from('documents').select('*')
    // Версии — только идентичность: шифр всех версий сюда тянуть незачем,
    // содержимое приедет существующим путём по изменённым заметкам.
    : supabase.from('versions').select('document_uuid, user_id, rev');

  const { data, error } = await query
    .eq('user_id', userId)
    .gt('rev', sinceRev)
    .order('rev', { ascending: true })
    .limit(limit);

  if (error != null) {
    if (isMissingRevColumn(error)) {
      throw new RevUnavailableError(
        `rev is unavailable: ${String((error as { message?: unknown }).message ?? '')}`,
      );
    }
    throw error;
  }

  const rows = ownRows((data ?? []) as PullChangesRow[], userId);
  assertPageOrder(rows, sinceRev, table);

  return { rows, lastRev: rows.length > 0 ? rows[rows.length - 1]!.rev : sinceRev };
}
