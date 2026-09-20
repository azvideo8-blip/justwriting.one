import { useActivityLogStore } from '../activity/useActivityLogStore';
import { scrubPii, redactMessage } from './piiScrub';

type ErrorContext = Record<string, string | number | boolean | null | undefined>;

export function reportError(
  error: unknown,
  context: ErrorContext = {},
  level: 'error' | 'warning' = 'error'
): void {
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
    useActivityLogStore.getState().addError(safeMessage, safeContext, level, source);
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
