import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
// Must use the shared named-database accessor: a bare getFirestore() targets
// "(default)", a different, empty database — telemetry and cooldown rows would
// land where neither firestore.rules nor the admin read path can see them.
import { getDb } from '../shared/firestore';

const telemetrySchema = z.object({
  telemetryId: z.string().min(1).max(100),
  activeTheme: z.string().max(100).optional(),
  notesCountBucket: z.string().max(20).optional(),
  averageWordCount: z.number().min(0).optional(),
  reasoningRatio: z.number().min(0).max(1).optional(),
  doorRatios: z.object({
    thinking: z.number(),
    feeling: z.number(),
    behavior: z.number(),
  }).nullish(),
  sentAt: z.string().max(50).optional(),
});

const TELEMETRY_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours per user

export const sendTelemetry = onCall({
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const uid = request.auth.uid;
  const parsed = telemetrySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid telemetry payload.');
  }

  const db = getDb();
  const cooldownRef = db.doc(`telemetryCooldown/${uid}`);

  const cooldownSnap = await cooldownRef.get();
  if (cooldownSnap.exists) {
    const lastSentAt = cooldownSnap.data()?.lastSentAt;
    if (typeof lastSentAt === 'number' && Date.now() - lastSentAt < TELEMETRY_MIN_INTERVAL_MS) {
      throw new HttpsError('resource-exhausted', 'Telemetry rate limit exceeded.');
    }
  }

  await cooldownRef.set({
    lastSentAt: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const telemetryData = parsed.data;
  await db.doc(`anonymizedTelemetry/${telemetryData.telemetryId}`).set(telemetryData, { merge: true });

  return { success: true };
});
