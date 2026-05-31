import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { z } from 'zod';
import { userIdSchema } from '../shared/validators';

const schema = z.object({
  targetUid: userIdSchema,
});

const MAX_DAILY_REQUESTS_SAFETY = 500;
const MAX_DAILY_COST_SAFETY = 5.0; // USD safety limit to prevent runaways

const COST_IN = 0.000000075;
const COST_OUT = 0.00000030;

export const resetUserLimit = onCall({
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const parsed = schema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { targetUid } = parsed.data;
  const db = getFirestore();

  // Verify caller is admin
  const callerDoc = await db.doc(`users/${request.auth.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const date = new Date().toISOString().slice(0, 10);

  // Check safety budget across all users
  const snapshot = await db.collectionGroup('daily').where('date', '==', date).get();
  let totalRequests = 0;
  let totalCost = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    totalRequests += data.requests ?? 0;
    totalCost += (data.promptTokens ?? 0) * COST_IN + (data.completionTokens ?? 0) * COST_OUT;
  });

  if (totalRequests >= MAX_DAILY_REQUESTS_SAFETY || totalCost >= MAX_DAILY_COST_SAFETY) {
    throw new HttpsError(
      'resource-exhausted',
      `Safety limits exceeded. Total requests: ${totalRequests}/${MAX_DAILY_REQUESTS_SAFETY}, Total cost: $${totalCost.toFixed(2)}/$${MAX_DAILY_COST_SAFETY}. Reset blocked.`
    );
  }

  // Delete the limit document (it will re-initialize to 1 on next query)
  await db.doc(`aiDailyLimit/${targetUid}`).delete();

  logger.info('AI Daily Limit reset successfully', { callerUid: request.auth.uid, targetUid, totalRequests, totalCost });

  return { success: true, totalRequests, totalCost };
});
