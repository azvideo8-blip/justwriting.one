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

  const parsed = schema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { targetUid, role } = parsed.data;

  // Нельзя менять свою роль
  if (request.auth.uid === targetUid) {
    throw new HttpsError('invalid-argument', 'Cannot change your own role.');
  }

  const db = getFirestore();

  await db.runTransaction(async (tx) => {
    const callerRef = db.doc(`users/${request.auth!.uid}`);
    const targetRef = db.doc(`users/${targetUid}`);

    const [callerDoc, targetDoc] = await Promise.all([
      tx.get(callerRef),
      tx.get(targetRef),
    ]);

    // Проверяем роль ВНУТРИ транзакции
    if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only admins can assign roles.');
    }

    if (!targetDoc.exists) {
      throw new HttpsError('not-found', `User ${targetUid} does not exist.`);
    }

    tx.update(targetRef, { role });
  });

  logger.info('Role updated', {
    callerUid: request.auth.uid,
    targetUid,
    role,
  });

  return { success: true };
});
