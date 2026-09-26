/**
 * Смена аккаунта во вкладке — перезагрузка страницы.
 *
 * Всё, что держит память вкладки (текст в редакторе, кэши, фоновая
 * синхронизация, состояние ИИ), принадлежит тому, кто был во вкладке. Защита
 * по месту (владелец у черновика, у запроса, у базы) закрывала утечки к
 * другому аккаунту по одной за раунд аудита; перезагрузка закрывает класс:
 * новый человек начинает с чистой памяти.
 *
 * Перед перезагрузкой дожидаемся тех, кто зарегистрировался (черновик
 * сохраняется прежнему владельцу), но не дольше FLUSH_LIMIT_MS.
 */
const FLUSH_LIMIT_MS = 1500;
const NOTICE_KEY = 'jw_account_change_notice';

const flushers = new Set<() => Promise<unknown>>();
let pending = false;
let nextLocation: string | null = null;
let skipFlush = false;

export function onBeforeAccountReload(fn: () => Promise<unknown>): () => void {
  flushers.add(fn);
  return () => { flushers.delete(fn); };
}

export function isAccountReloadPending(): boolean {
  return pending;
}

/** Куда вести после перезагрузки (выход — на /login). Без него — та же страница. */
export function setAccountReloadTarget(path: string | null): void {
  nextLocation = path;
}

/** Выход со стиранием данных: черновик НЕ сохранять — он лёг бы обратно в
 *  только что очищенную базу. */
export function skipFlushOnAccountReload(skip = true): void {
  skipFlush = skip;
}

export type AccountChangeNotice = 'signed_out' | 'signed_out_wiped' | 'wipe_failed' | 'account_deleted';

/** Сообщение, которое покажется уже на новой странице. */
export function setAccountChangeNotice(notice: AccountChangeNotice): void {
  try { sessionStorage.setItem(NOTICE_KEY, notice); } catch { /* намеренно: без сообщения выход всё равно состоится */ }
}

export function takeAccountChangeNotice(): AccountChangeNotice | null {
  try {
    const v = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    return v as AccountChangeNotice | null;
  } catch {
    return null;
  }
}

export async function reloadForAccountChange(): Promise<void> {
  if (pending) return;
  pending = true;
  if (!skipFlush) {
    await Promise.race([
      Promise.allSettled([...flushers].map(f => f())),
      new Promise(r => setTimeout(r, FLUSH_LIMIT_MS)),
    ]);
  }
  if (nextLocation) window.location.assign(nextLocation);
  else window.location.reload();
}

export function _resetAccountReloadForTesting(): void {
  flushers.clear();
  pending = false;
  nextLocation = null;
  skipFlush = false;
}
