import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getDb } from '../shared/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as admin from 'firebase-admin';
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

  try {
    await db.runTransaction(async (tx) => {
      const [callerDoc, targetDoc] = await Promise.all([
        tx.get(callerRef),
        tx.get(targetRef),
      ]);

      if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
        throw new Error('PERMISSION_DENIED');
      }

      if (!targetDoc.exists) {
        throw new Error('NOT_FOUND');
      }

      tx.update(targetRef, { role });
    });
  } catch (e: any) {
    const msg = e?.message ?? '';
    if (msg === 'PERMISSION_DENIED') throw new HttpsError('permission-denied', 'Only admins can assign roles.');
    if (msg === 'NOT_FOUND') throw new HttpsError('not-found', 'Target user does not exist.');
    throw new HttpsError('internal', 'Transaction failed.');
  }

  try {
    const existingUser = await getAuth().getUser(targetUid);
    const existingClaims = existingUser.customClaims ?? {};
    const previousRole = existingClaims.role as string | undefined;
    await getAuth().setCustomUserClaims(targetUid, { ...existingClaims, role });
    if (previousRole === 'admin') {
      await getAuth().revokeRefreshTokens(targetUid);
    }
  } catch (authError) {
    logger.error('Auth claims update failed, rolling back Firestore role', { targetUid, role, authError });
    try {
      await db.doc(`users/${targetUid}`).update({ role: admin.firestore.FieldValue.delete() });
    } catch (rollbackError) {
      logger.error('CRITICAL: role rollback failed — Firestore role and auth claims are now inconsistent. Manual intervention required.', { targetUid, role, authError, rollbackError });
      throw new HttpsError('internal', 'Failed to update auth claims AND failed to roll back Firestore role. Manual fix required.');
    }
    throw new HttpsError('internal', 'Failed to update auth claims. Firestore role has been rolled back.');
  }

  logger.info('Role updated', { callerUid: request.auth.uid, targetUid, role });

  return { success: true };
});
