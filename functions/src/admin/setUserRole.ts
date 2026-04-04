import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { z } from 'zod';
import { roleSchema, userIdSchema } from '../shared/validators';

const schema = z.object({
  targetUid: userIdSchema,
  role: roleSchema,
});

export const setUserRole = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  // Verify caller is admin
  const callerDoc = await getFirestore().doc(`users/${request.auth.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can assign roles.');
  }

  const parsed = schema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { targetUid, role } = parsed.data;

  const targetDoc = await getFirestore().doc(`users/${targetUid}`).get();
  if (!targetDoc.exists) {
    throw new HttpsError('not-found', `User ${targetUid} does not exist.`);
  }

  await getFirestore().doc(`users/${targetUid}`).update({ role });

  logger.info('Role updated', { callerUid: request.auth.uid, targetUid, role });

  return { success: true };
});
