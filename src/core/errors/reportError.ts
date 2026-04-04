import * as Sentry from '@sentry/react';

type ErrorContext = Record<string, string | number | boolean | null | undefined>;

export function reportError(
  error: unknown,
  context: ErrorContext = {},
  level: 'error' | 'warning' = 'error'
): void {
  console.error('[reportError]', error, context);

  if (!import.meta.env.VITE_SENTRY_DSN) return;

  Sentry.withScope((scope) => {
    scope.setLevel(level);
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}
