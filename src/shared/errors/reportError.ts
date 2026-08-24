import * as Sentry from '@sentry/react';
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
      if (error.stack) copy.stack = error.stack;
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

  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
  if (!sentryDsn || !sentryDsn.startsWith('https://')) return;

  Sentry.withScope((scope) => {
    scope.setLevel(level);
    Object.entries(safeContext).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureException(safeMessage instanceof Error ? safeMessage : new Error(String(safeMessage)));
  });
}

let _globalListenersInstalled = false;

export function setupGlobalErrorListeners(): void {
  if (_globalListenersInstalled || typeof window === 'undefined') return;
  _globalListenersInstalled = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    if (!event.message && !event.error) return;
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
