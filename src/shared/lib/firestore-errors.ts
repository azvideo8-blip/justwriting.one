import { auth } from '../../core/firebase/auth';
import { OperationType, FirestoreErrorInfo } from '../../core/errors/errorTypes';
import { reportError } from '../../core/errors/reportError';

export { OperationType };
export type { FirestoreErrorInfo };

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || 'anonymous',
      email: auth.currentUser?.email || 'none',
      emailVerified: auth.currentUser?.emailVerified || false,
      isAnonymous: auth.currentUser?.isAnonymous || true,
      tenantId: auth.currentUser?.tenantId || 'none',
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName || 'none',
        email: provider.email || 'none',
        photoUrl: provider.photoURL || 'none'
      })) || []
    },
    operationType,
    path
  };
  
  // Report full error to Sentry
  reportError(errInfo.error, { 
    operationType, 
    path: path || 'unknown',
    userId: errInfo.authInfo.userId
  });

  // Throw generic error to user
  const safeMessage = JSON.stringify({
    error: 'An error occurred while accessing the database.',
    operationType,
    path: path || 'unknown'
  });
  
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(safeMessage);
}
