import { auth } from '../../core/firebase/auth';
import { OperationType, FirestoreErrorInfo } from '../../core/errors/errorTypes';
import { reportError } from '../../core/errors/reportError';

export { OperationType };
export type { FirestoreErrorInfo };

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
    },
    operationType,
    path
  };
  
  // Report full error to Sentry
  reportError(errInfo.error, { 
    operationType, 
    path: path || 'unknown',
    uid: auth.currentUser?.uid
  });

  const errorCode = error instanceof Error && 'code' in error ? (error as { code: string }).code : 'unknown';

  console.error('Firestore Error: ', {
    operationType,
    errorCode,
    path: path || null,
  });

  const safeMessage = `Firestore ${operationType} failed (${errorCode}): ${path || 'unknown path'}`;
  throw new Error(safeMessage);
}
