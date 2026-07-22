import * as Sentry from '@sentry/react';
import { useErrorLogStore } from './useErrorLogStore';

type ErrorContext = Record<string, string | number | boolean | null | undefined>;

const PII_KEYS = new Set(['userId', 'documentId', 'uid', 'email', 'linkedCloudId']);

export function reportError(
  error: unknown,
  context: ErrorContext = {},
  level: 'error' | 'warning' = 'error'
): void {
  try {
    const source =
      typeof context.source === 'string'
        ? context.source
        : typeof context.action === 'string'
          ? context.action
          : undefined;
    useErrorLogStore.getState().addError(error, context, level, source);
  } catch {
    // Avoid error log store failure interrupting reportError
  }

  if (import.meta.env.DEV) {
    console.error('[reportError]', error, context);
  }

  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
  if (!sentryDsn || !sentryDsn.startsWith('https://')) return;

  const safeContext: ErrorContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (!PII_KEYS.has(key)) {
      safeContext[key] = value;
    }
  }

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
