import * as Sentry from '@sentry/react';

type ErrorContext = Record<string, string | number | boolean | null | undefined>;

const PII_KEYS = new Set(['userId', 'documentId', 'uid', 'email', 'linkedCloudId']);

export function reportError(
  error: unknown,
  context: ErrorContext = {},
  level: 'error' | 'warning' = 'error'
): void {
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
