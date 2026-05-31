import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getDb } from '../shared/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as logger from 'firebase-functions/logger';
import { z } from 'zod';
import { roleSchema, userIdSchema } from '../shared/validators';

const schema = z.object({
  targetUid: userIdSchema,
  role: roleSchema,
});

export const setUserRole = onCall({
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const parsed = schema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { targetUid, role } = parsed.data;

  // Нельзя менять свою роль
  if (request.auth.uid === targetUid) {
    throw new HttpsError('invalid-argument', 'Cannot change your own role.');
  }

  const db = getDb();

  const callerRef = db.doc(`users/${request.auth.uid}`);
  const targetRef = db.doc(`users/${targetUid}`);

  await db.runTransaction(async (tx) => {
    const [callerDoc, targetDoc] = await Promise.all([
      tx.get(callerRef),
      tx.get(targetRef),
    ]);

    if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only admins can assign roles.');
    }

    if (!targetDoc.exists) {
      throw new HttpsError('not-found', 'Target user does not exist.');
    }

    tx.update(targetRef, { role });
  });

  const existingClaims = (await getAuth().getUser(targetUid)).customClaims ?? {};
  await getAuth().setCustomUserClaims(targetUid, { ...existingClaims, role });
  await getAuth().revokeRefreshTokens(targetUid);

  logger.info('Role updated', { callerUid: request.auth.uid, targetUid, role });

  return { success: true };
});
