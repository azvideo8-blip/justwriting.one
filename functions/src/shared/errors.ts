import { HttpsError } from 'firebase-functions/v2/https';

export const unauthenticated = () =>
  new HttpsError('unauthenticated', 'Authentication required.');

export const forbidden = (msg = 'Insufficient permissions.') =>
  new HttpsError('permission-denied', msg);

export const badInput = (msg = 'Invalid or missing payload.') =>
  new HttpsError('invalid-argument', msg);

export const notFound = (entity: string) =>
  new HttpsError('not-found', `${entity} not found.`);

export function reportError(
  error: unknown,
  context: Record<string, string | number | boolean | null | undefined> = {},
  level: 'error' | 'warning' = 'error'
): void {
  console.error('[reportError]', error, context);
}
