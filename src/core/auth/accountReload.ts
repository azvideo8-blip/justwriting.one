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
import { reportError } from '../../shared/errors/reportError';
import { clearSignOutWipeMark, setSignOutWipeMark, signOutWipeMarkFresh } from './signOutWipeMark';

const FLUSH_LIMIT_MS = 1500;
const NOTICE_KEY = 'jw_account_change_notice';
// CK-3: кому принадлежит сообщение. После выхода `user` уже null, а расхождение
// часов лежит под ключом аккаунта — без этого uid новая страница не узнала бы причину.
const NOTICE_UID_KEY = 'jw_account_change_notice_uid';

const flushers = new Set<() => Promise<unknown>>();
let pending = false;
let nextLocation: string | null = null;
let skipFlush = false;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

// `skipFlush` живёт в памяти одной вкладки, а `SIGNED_OUT` приходит во все: соседняя
// вкладка записала бы свой черновик обратно в стёртую базу — поэтому ещё метка
// в localStorage (signOutWipeMark.ts).

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
  if (skip) setSignOutWipeMark();
  else clearSignOutWipeMark();
}

export type AccountChangeNotice = 'signed_out' | 'signed_out_wiped' | 'signed_out_key_kept' | 'wipe_failed' | 'account_deleted' | 'account_deleted_wipe_failed' | 'lost_session' | 'clock_skew';

/** Сообщение, которое покажется уже на новой странице. */
export function setAccountChangeNotice(notice: AccountChangeNotice, uid?: string | null): void {
  try {
    sessionStorage.setItem(NOTICE_KEY, notice);
    if (uid) sessionStorage.setItem(NOTICE_UID_KEY, uid);
    else sessionStorage.removeItem(NOTICE_UID_KEY);
  } catch { /* намеренно: без сообщения выход всё равно состоится */ }
}

/** Аккаунт, к которому относится сообщение (CK-3: расхождение часов — по uid). */
export function getAccountChangeNoticeUid(): string | null {
  try { return sessionStorage.getItem(NOTICE_UID_KEY); } catch { return null; }
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
  if (!skipFlush && !signOutWipeMarkFresh()) {
    await Promise.race([
      Promise.allSettled([...flushers].map(f => f())),
      new Promise(r => setTimeout(r, FLUSH_LIMIT_MS)),
    ]);
  }
  const target = nextLocation;
  if (typeof window !== 'undefined') {
    if (target) window.location.assign(target);
    else window.location.reload();

    // Страховка: если через ~3 с после вызова страница всё ещё жива (например,
    // пользователь или расширение заблокировали переход) — повторяем через replace
    // и пишем warning в журнал, чтобы pending не оставался вечным без действия.
    // Вето beforeunload здесь = подмена аккаунта во вкладке: если отменить выгрузку
    // страницы, вкладка остаётся с данными, черновиками и интерфейсом старого
    // аккаунта поверх новой сессии, а слушатели auth заглушены.
    fallbackTimer = setTimeout(() => {
      reportError(
        new Error('Account reload timed out; retrying navigation via replace'),
        { action: 'account_reload_timeout', target: target ?? 'reload' },
        'warning'
      );
      if (target) window.location.replace(target);
      else window.location.replace(window.location.href);
    }, 3000);
  }
}

export function _resetAccountReloadForTesting(): void {
  flushers.clear();
  pending = false;
  nextLocation = null;
  skipFlush = false;
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
}
