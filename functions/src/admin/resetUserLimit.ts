import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getDb } from '../shared/firestore';
import * as logger from 'firebase-functions/logger';
import { z } from 'zod';
import { userIdSchema } from '../shared/validators';

const schema = z.object({
  targetUid: userIdSchema,
});

const MAX_DAILY_REQUESTS_SAFETY = 10000;
const MAX_DAILY_COST_SAFETY = 5.0; // USD safety limit to prevent runaways

// DeepSeek v4 Flash (OpenRouter) catalog pricing is $0.09/$0.18 per 1M tokens,
// but a live billed request (2026-07-04, routed to the "DigitalOcean" backend)
// came in ~25% above that ($0.112/$0.224) — OpenRouter can route the same
// model slug to different backend providers at different rates. This is a
// safety cap, so round up rather than use the optimistic catalog rate.
// Verify at https://openrouter.ai/deepseek/deepseek-v4-flash
const COST_IN = 0.00000012;
const COST_OUT = 0.00000024;

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
  const db = getDb();

  // Verify caller is admin
  const callerDoc = await db.doc(`users/${request.auth.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const date = new Date().toISOString().slice(0, 10);

  const shardsSnap = await db.collection(`aiGlobalDaily/${date}/shards`).get();
  let totalRequests = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  shardsSnap.forEach(doc => {
    const data = doc.data();
    totalRequests += data.requests ?? 0;
    promptTokens += data.promptTokens ?? 0;
    completionTokens += data.completionTokens ?? 0;
  });
  const totalCost = promptTokens * COST_IN + completionTokens * COST_OUT;

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
