import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const getAIUsageStats = onCall({
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const db = getFirestore();
  const callerDoc = await db.doc(`users/${request.auth.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid date format. Use YYYY-MM-DD.');
  }

  const { date } = parsed.data;

  const collectionRef = db.collectionGroup('daily').where('date', '==', date);
  const snapshot = await collectionRef.limit(500).get();

  const results: { uid: string; requests: number; promptTokens: number; completionTokens: number }[] = [];

  snapshot.forEach(doc => {
    const parentPath = doc.ref.parent.parent;
    if (!parentPath) return;
    const uid = parentPath.id;
    const data = doc.data();
    results.push({
      uid,
      requests: data.requests ?? 0,
      promptTokens: data.promptTokens ?? 0,
      completionTokens: data.completionTokens ?? 0,
    });
  });

  return { stats: results };
});
