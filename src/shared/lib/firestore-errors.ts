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

  // Throw generic error to user
  const safeMessage = 'An error occurred while accessing the database. Please try again.';
  
  console.error('Firestore Error: ', {
    operationType,
    errorCode: error instanceof Error && 'code' in error ? (error as { code: string }).code : 'unknown',
    path: path || null,
  });
  throw new Error(safeMessage);
}
