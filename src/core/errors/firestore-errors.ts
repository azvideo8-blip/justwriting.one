import { getCurrentUser } from '../auth';
import { OperationType, FirestoreErrorInfo } from '../../shared/errors/errorTypes';
import { reportError } from '../../shared/errors/reportError';

export { OperationType };
export type { FirestoreErrorInfo };

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): FirestoreErrorInfo {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: getCurrentUser()?.uid,
    },
    operationType,
    path
  };
  
  // AUD-16: путь вида users/<uid>-… несёт uid внутри себя — вычёркивание
  // ключа `uid` не спасало, тот же идентификатор приходил вторым входом.
  // Отладке нужна форма (коллекция), а не значение.
  reportError(errInfo.error, {
    operationType,
    collection: path?.split('/')[0] ?? 'unknown',
  });

  const errorCode = error instanceof Error && 'code' in error ? (error as { code: string }).code : 'unknown';

  if (import.meta.env.DEV) {
    console.error('Firestore Error: ', {
      operationType,
      errorCode,
      path: path || null,
    });
  }

  return errInfo;
}
