import * as Sentry from '@sentry/react';
import { useActivityLogStore } from '../activity/useActivityLogStore';

type ErrorContext = Record<string, string | number | boolean | null | undefined>;

// Ключи, значения которых не попадают ни в журнал, ни в отчёт об ошибке.
// Заголовок заметки — такие же личные данные, как её текст: «Развод, день 4»
// говорит достаточно. Он попадал в журнал активности в localStorage, а оттуда в
// буфер обмена по кнопке «скопировать журнал».
// Вычёркивание идёт по точному имени ключа, поэтому список должен покрывать
// семью, а не отдельных её представителей: `docId` рядом с `documentId` — это
// тот же идентификатор под другим именем, и одного его хватало, чтобы обойти
// защиту. `tag`, `theme` и `label` — придуманные человеком слова, то самое,
// что шифруется в облаке и не должно лежать открытым в журнале на устройстве.
const PII_KEYS = new Set([
  'userId', 'uid', 'email', 'linkedCloudId',
  'documentId', 'docId', 'docUuid', 'localId', 'versionId', 'sessionId',
  'personaId', 'domainId', 'labelId', 'noteId', 'threadId',
  'title', 'docTitle', 'content', 'text', 'rawContent', 'summary',
  'tag', 'theme', 'label', 'name', 'query', 'snippet', 'prompt', 'answer', 'message',
]);

export function reportError(
  error: unknown,
  context: ErrorContext = {},
  level: 'error' | 'warning' = 'error'
): void {
  const safeContext: ErrorContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (!PII_KEYS.has(key)) {
      safeContext[key] = value;
    }
  }

  try {
    const source =
      typeof safeContext.source === 'string'
        ? safeContext.source
        : typeof safeContext.action === 'string'
          ? safeContext.action
          : undefined;
    useActivityLogStore.getState().addError(error, safeContext, level, source);
  } catch {
    // Avoid error log store failure interrupting reportError
  }

  if (import.meta.env.DEV) {
    console.error('[reportError]', error, safeContext);
  }

  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
  if (!sentryDsn || !sentryDsn.startsWith('https://')) return;

  Sentry.withScope((scope) => {
    scope.setLevel(level);
    Object.entries(safeContext).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
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
