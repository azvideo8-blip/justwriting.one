import { ownRow } from '../data/providers/pageAll';
import { getSupabase } from '../supabase/client';
import { SyncService } from '../services/SyncService';
import { CloudSyncService } from '../services/CloudSyncService';

const CHANGE_CURSOR_KEY_PREFIX = 'change_cursor_last_seen_';

/**
 * Reads the last seen change cursor from localStorage for the given user.
 */
export function getStoredCursor(userId: string): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(`${CHANGE_CURSOR_KEY_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

/**
 * Stores the verbatim server cursor in localStorage for the given user.
 * Never computed or advanced locally.
 */
export function setStoredCursor(userId: string, cursor: string): void {
  if (!userId || !cursor) return;
  try {
    localStorage.setItem(`${CHANGE_CURSOR_KEY_PREFIX}${userId}`, cursor);
  } catch {
    // Non-critical if storage quota exceeded
  }
}

/**
 * Clears the stored cursor for a user.
 */
export function clearStoredCursor(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(`${CHANGE_CURSOR_KEY_PREFIX}${userId}`);
  } catch {
    // намеренно: хранилище недоступно — и курсора в нём нет
  }
}

/**
 * Checks whether the server cursor is ahead of the stored cursor.
 */
export function isServerCursorAhead(
  serverCursor: string | null | undefined,
  storedCursor: string | null | undefined,
): boolean {
  if (!serverCursor) return false;
  if (!storedCursor) return true;
  const serverTime = new Date(serverCursor).getTime();
  const storedTime = new Date(storedCursor).getTime();
  if (isNaN(serverTime)) return false;
  if (isNaN(storedTime)) return true;
  return serverTime > storedTime;
}

/**
 * Reads the latest change cursor from PostgreSQL (greatest of documents.updated_at and versions.created_at).
 * Returns the verbatim ISO timestamp string, or null if no records exist.
 */
export async function fetchServerCursor(userId: string): Promise<string | null> {
  const supabase = getSupabase();
  const [docRes, verRes] = await Promise.all([
    supabase
      .from('documents')
      .select('updated_at, user_id')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('versions')
      .select('created_at, user_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (docRes.error) throw docRes.error;
  if (verRes.error) throw verRes.error;
  // N-35: чужая свежая метка сдвинула бы курсор вперёд, и свои изменения
  // старее неё больше не забирались бы. Чужая строка — ошибка чтения, курсор стоит.
  ownRow(docRes.data, userId);
  ownRow(verRes.data, userId);

  const docUpdated = docRes.data?.updated_at as string | undefined;
  const verCreated = verRes.data?.created_at as string | undefined;

  if (!docUpdated && !verCreated) return null;
  if (!docUpdated) return verCreated!;
  if (!verCreated) return docUpdated;

  const docTime = new Date(docUpdated).getTime();
  const verTime = new Date(verCreated).getTime();

  return docTime >= verTime ? docUpdated : verCreated;
}

export interface CheckAndSyncOptions {
  downloadAll?: (userId: string) => Promise<unknown>;
  reconcileLinked?: (userId: string) => Promise<unknown>;
  fetchServerCursorFn?: (userId: string) => Promise<string | null>;
}

/**
 * SYNC-CURSOR-2: checks if the cloud has moved ahead without this client.
 * If server is ahead of the stored cursor, calls downloadAllFromCloud and
 * reconcileLinkedDocuments. Advances the stored cursor ONLY after both complete without throwing.
 */
export async function checkAndSyncCursor(
  userId: string,
  options?: CheckAndSyncOptions,
): Promise<{ checked: boolean; synced: boolean; serverCursor: string | null }> {
  if (!userId) return { checked: false, synced: false, serverCursor: null };

  const fetchCursor = options?.fetchServerCursorFn ?? fetchServerCursor;
  const serverCursor = await fetchCursor(userId);

  const storedCursor = getStoredCursor(userId);

  if (!isServerCursorAhead(serverCursor, storedCursor)) {
    return { checked: true, synced: false, serverCursor };
  }

  const downloadAll = options?.downloadAll ?? (async (uid: string) => SyncService.downloadAllFromCloud(uid));
  const reconcileLinked = options?.reconcileLinked ?? (async (uid: string) => CloudSyncService.reconcileLinkedDocuments(uid));

  // EA-4: проходы сообщают о сбоях возвращаемым значением ({ failed, locked }),
  // а не исключением. Курсор двигаем, только если оба прошли чисто: иначе
  // пропущенные заметки (или всё, при запертом сейфе) остались бы за курсором
  // и не подтянулись до следующего изменения в облаке.
  const results = await Promise.all([
    downloadAll(userId),
    reconcileLinked(userId),
  ]);
  // R-2: неполный список облака (битый ряд) — тоже не чистый проход: за курсором
  // осталась бы строка, которую никто не прочитал.
  const incomplete = results.some(r => {
    const x = r as { failed?: number; locked?: boolean; incomplete?: boolean } | null | undefined;
    return Boolean(x?.locked) || Boolean(x?.incomplete) || (x?.failed ?? 0) > 0;
  });

  if (serverCursor && !incomplete) {
    setStoredCursor(userId, serverCursor);
  }

  return { checked: true, synced: true, serverCursor };
}
