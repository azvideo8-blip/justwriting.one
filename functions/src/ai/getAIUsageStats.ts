import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getDb } from '../shared/firestore';
import { TIER_LIMITS, DAILY_LIMIT } from '../shared/aiUtils';
import { z } from 'zod';
import type { Timestamp } from 'firebase-admin/firestore';

const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(val => {
    const [, m, d] = val.split('-').map(Number);
    return (m ?? 0) >= 1 && (m ?? 0) <= 12 && (d ?? 0) >= 1 && (d ?? 0) <= 31;
  }, 'Invalid date: month must be 1-12, day must be 1-31'),
  // When provided, returns per-request events for that user instead of aggregated stats
  targetUid: z.string().min(1).max(128).optional(),
});

export const getAIUsageStats = onCall({
  enforceAppCheck: true,
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
    throw new HttpsError('invalid-argument', 'Invalid arguments.');
  }

  const { date, targetUid } = parsed.data;

  // ── Per-user event breakdown ──────────────────────────────────────────────
  if (targetUid) {
    const eventsSnap = await db
      .collection(`aiUsage/${targetUid}/events`)
      .where('date', '==', date)
      .limit(200)
      .get();

    const events = eventsSnap.docs
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          ts: (data.ts as Timestamp)?.toMillis?.() ?? 0,
          tokensIn: (data.tokensIn as number) ?? 0,
          tokensOut: (data.tokensOut as number) ?? 0,
          model: (data.model as string) ?? 'unknown',
          fn: (data.fn as string) ?? 'unknown',
        };
      })
      .sort((a, b) => b.ts - a.ts);

    return { events };
  }

  // ── Aggregated daily stats (all users) ────────────────────────────────────
  const collectionRef = db.collectionGroup('daily').where('date', '==', date);
  const results: { uid: string; requests: number; promptTokens: number; completionTokens: number }[] = [];
  const totals = { requests: 0, promptTokens: 0, completionTokens: 0 };
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;

  while (hasMore) {
    let q = collectionRef.limit(500);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snapshot = await q.get();
    if (snapshot.empty) break;

    snapshot.forEach(doc => {
      const parentPath = doc.ref.parent.parent;
      if (!parentPath) return;
      const uid = parentPath.id;
      const data = doc.data();
      const requests = (data.requests as number) ?? 0;
      const promptTokens = (data.promptTokens as number) ?? 0;
      const completionTokens = (data.completionTokens as number) ?? 0;
      results.push({ uid, requests, promptTokens, completionTokens });
      totals.requests += requests;
      totals.promptTokens += promptTokens;
      totals.completionTokens += completionTokens;
      lastDoc = doc;
    });

    hasMore = snapshot.size === 500;
  }

  return {
    stats: results,
    totals,
    limits: { ...TIER_LIMITS, perUserDaily: DAILY_LIMIT },
  };
});
