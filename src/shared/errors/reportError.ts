import { useActivityLogStore } from '../activity/useActivityLogStore';
import { scrubPii, redactMessage } from './piiScrub';
import { describeError } from './describeError';

type ErrorContext = Record<string, string | number | boolean | null | undefined>;

// Браузер не достучался до сервера: ноутбук просыпается, пропал Wi-Fi. Это не
// поломка — фоновые проходы повторяют запрос сами, — поэтому в журнал такое
// идёт предупреждением, а не красной ошибкой. Тексты Chrome / Safari / Firefox.
const NETWORK_FAILURE_RE = /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource)/;
// B-9 (ревью 0.10.1): `@supabase/postgrest-js` при сбое `fetch` не бросает
// `TypeError`, а возвращает обычный объект `{ message: 'TypeError: Load failed',
// code: '', status: 0 }` (node_modules/@supabase/postgrest-js/dist/index.mjs:416-456),
// и провайдер делает `throw error`. Прежняя проверка `instanceof TypeError` такую
// форму не видела, и обрыв сети писался в журнал красной ошибкой.
const WRAPPED_NETWORK_FAILURE_RE = /^(TypeError|FetchError|NetworkError): (Failed to fetch|Load failed|NetworkError when attempting to fetch resource)/;

/** Сообщение ошибки в любой форме: `Error`, строка или plain-объект от провайдера. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : '';
}

export function isNetworkFailure(error: unknown): boolean {
  const text = errorText(error);
  if (!text) return false;
  return (error instanceof TypeError && NETWORK_FAILURE_RE.test(text)) || WRAPPED_NETWORK_FAILURE_RE.test(text);
}

// Страница уходит (перезагрузка, переход, обновление версии): браузер обрывает
// запросы в полёте, и Safari называет это тем же «Load failed». Это не сбой сети,
// а следствие ухода — синхронизация повторит запросы на новой странице. Такие
// обрывы в журнал не пишем (скрин владельца 2026-10-17: «Нет связи» ×3 ровно в
// секунду перезагрузки). Возврат из кэша навигации (pageshow) флажок снимает.
let pageUnloading = false;

// Safari при выгрузке и заморозке страницы рвёт соединение с IndexedDB:
// операции в полёте падают «без активной транзакции» или отменяются
// (AbortError). База переоткрывается сама (localDb слушает 'close'), фон
// повторит проход — это не поломка (журнал владельца 2026-10-17 22:06).
const CONNECTION_TEARDOWN_RE = /without an in-progress transaction|Connection to Indexed Database server lost|database connection is closing/i;

// Ревью 0.10.1: AbortError бывает и у настоящей неудачной записи (idb отменяет
// транзакцию без своей ошибки). Спокойно пишем только «ничейный» (unhandledrejection)
// и только при уходе со страницы — молчим; сбой записи с action остаётся error.
function isQuietAbort(error: unknown, context: ErrorContext): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  // B-9: у postgrest отмена приходит не экземпляром `DOMException`, а тем же
  // plain-объектом с собранным сообщением — «AbortError: …».
  if (name !== 'AbortError' && !/^AbortError:/.test(errorText(error))) return false;
  return pageUnloading || context.source === 'unhandledrejection';
}

export function isConnectionTeardown(error: unknown): boolean {
  return CONNECTION_TEARDOWN_RE.test(errorText(error));
}

import { isVaultLocked as getIsVaultLocked, registerVaultLockedChecker } from './vaultLockState';
export { registerVaultLockedChecker };

// F-1: сбой «нет ключа» — это запертый сейф, ожидаемое состояние, а не
// поломка: такое идёт в журнал уровнем info. Смотрим на текст, а не на стор:
// импорт стора отсюда замыкает цикл модулей. Эти строки бросаются только
// когда ключа нет (cryptoHelpers, CloudSyncService по `_locked`).
const VAULT_LOCKED_RE = /session key not available|\bLOCKED\b|[Vv]ault is locked/;

export function isVaultLockedFailure(
  error: unknown,
  context: ErrorContext = {},
  isVaultLocked?: () => boolean
): boolean {
  const text = errorText(error);
  const reason = [context.reason, context.error].filter(v => typeof v === 'string').join(' ');
  if (!VAULT_LOCKED_RE.test(`${text} ${reason}`)) {
    return false;
  }
  const check = isVaultLocked ?? getIsVaultLocked;
  // N-70: понижение до info делаем только если сейф действительно заперт
  if (!check()) {
    return false;
  }
  return true;
}

export function reportError(
  error: unknown,
  context: ErrorContext = {},
  level: 'error' | 'warning' | 'info' = 'error'
): void {
  if (isNetworkFailure(error)) {
    if (pageUnloading) return;
    level = 'warning';
  } else if (isConnectionTeardown(error) || isQuietAbort(error, context)) {
    if (pageUnloading) return;
    level = 'info';
  }
  if (isVaultLockedFailure(error, context)) level = 'info';
  // Список PII-ключей общий с журналом активности (piiScrub.ts): фильтр,
  // стоящий здесь, не должен обходиться прямыми вызовами addActivity.
  const safeContext: ErrorContext = scrubPii(context);

  // AUD-17: сам текст сообщения тоже проходит фильтр — по форме (uuid, email,
  // длинный base64), раз по имени ключа строку не поймать.
  let safeMessage: unknown = error;
  if (typeof error === 'string') {
    safeMessage = redactMessage(error);
  } else if (error instanceof Error) {
    try {
      // Копия с очищенным message: исходную ошибку не мутируем.
      const copy = new Error(redactMessage(error.message));
      copy.name = error.name;
      // Стек несёт первую строку вида «Error: <сообщение>» — если перенести
      // его как есть, вычеркнутый uuid или адрес почты уезжает в журнал внутри
      // стека. Прогоняем те же три формы и по стеку.
      if (error.stack) copy.stack = redactMessage(error.stack);
      safeMessage = copy;
    } catch {
      safeMessage = error;
    }
  }

  try {
    const source =
      typeof safeContext.source === 'string'
        ? safeContext.source
        : typeof safeContext.action === 'string'
          ? safeContext.action
          : undefined;
    // Журнал читает человек — описание по-русски; исходный английский текст
    // остаётся разработчику в контексте (`raw`).
    const rawText = safeMessage instanceof Error ? safeMessage.message : typeof safeMessage === 'string' ? safeMessage : '';
    const ru = rawText ? describeError(rawText, safeContext) : null;
    if (ru) {
      let described: unknown = ru;
      if (safeMessage instanceof Error) {
        const e = new Error(ru);
        e.name = safeMessage.name;
        if (safeMessage.stack) e.stack = safeMessage.stack;
        described = e;
      }
      useActivityLogStore.getState().addError(described, { ...safeContext, raw: rawText }, level, source);
    } else {
      useActivityLogStore.getState().addError(safeMessage, safeContext, level, source);
    }
  } catch {
    // Avoid error log store failure interrupting reportError
  }

  if (import.meta.env.DEV) {
    console.error('[reportError]', safeMessage, safeContext);
  }
}

/**
 * Ошибка чужого окна — не наша ошибка.
 *
 * Когда сайт открыт внутри чужого фрейма (панель предпросмотра, встраивание,
 * расширение браузера), внешний скрипт лезет к нашему окну и получает
 * `SecurityError: Blocked a frame ... from accessing a cross-origin frame`.
 * Событие всплывает в наш `window.onerror`, и человек видит значок «1 ошибка»
 * на ровном месте, а в журнал уходит шум с чужого кода.
 *
 * Родиться у нас такая ошибка не может: в исходниках нет ни одного обращения к
 * `window.parent`, `window.top` или `frameElement`. Поэтому её отсекаем — узко,
 * по имени и тексту, чтобы не проглотить настоящую.
 */
function isForeignFrameError(error: unknown, message: string): boolean {
  const name = (error as { name?: string } | null)?.name ?? '';
  const text = `${(error as { message?: string } | null)?.message ?? ''} ${message}`;
  return name === 'SecurityError' && /cross-origin frame|Blocked a frame/i.test(text);
}

let _globalListenersInstalled = false;

export function setupGlobalErrorListeners(): void {
  if (_globalListenersInstalled || typeof window === 'undefined') return;
  _globalListenersInstalled = true;

  // Только pagehide: beforeunload бывает отменён («уйти без сохранения?» →
  // остаться), и флажок застрял бы, пряча настоящие сбои сети дальше.
  window.addEventListener('pagehide', () => { pageUnloading = true; });
  window.addEventListener('pageshow', () => { pageUnloading = false; });

  window.addEventListener('error', (event: ErrorEvent) => {
    if (!event.message && !event.error) return;
    if (isForeignFrameError(event.error, event.message)) return;
    reportError(event.error || event.message, {
      source: 'window.onerror',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportError(event.reason, {
      source: 'unhandledrejection',
    });
  });
}
