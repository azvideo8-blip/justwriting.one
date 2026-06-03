import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getDb } from '../shared/firestore';
import { setActiveModel, getActiveModel } from '../shared/aiProvider';

// Allowed model IDs — keeps the list sane and prevents arbitrary injection.
const ALLOWED_MODELS = [
  'accounts/fireworks/models/deepseek-v4-flash',
  'accounts/fireworks/models/deepseek-v4-pro',
  'accounts/fireworks/models/gpt-oss-120b',
  'accounts/fireworks/models/gpt-oss-20b',
] as const;

const inputSchema = z.object({
  model: z.enum(ALLOWED_MODELS),
});

export const setAIModel = onCall({
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const db = getDb();
  const callerDoc = await db.doc(`users/${request.auth.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid or disallowed model ID.');
  }

  await setActiveModel(parsed.data.model);
  return { success: true, model: parsed.data.model };
});

export const getAIConfig = onCall({
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const db = getDb();
  const callerDoc = await db.doc(`users/${request.auth.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const model = await getActiveModel();
  return { model, allowedModels: ALLOWED_MODELS };
});
