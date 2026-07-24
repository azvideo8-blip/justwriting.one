import { getAuth } from 'firebase/auth';
import { getClient } from '../../core/firebase/firestoreClient';
import { getLocalDb } from '../../core/storage/localDb';

// Re-import from bridge to avoid core→features layer violation
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type DoorsResult = { thinking: number; feeling: number; behavior: number; total: number; lowData: boolean };

const TELEMETRY_ID_KEY = 'telemetry_id';
const TELEMETRY_LAST_SEND_KEY = 'telemetry_last_send';
const ROTATION_DAYS = 30;
const SEND_INTERVAL_DAYS = 14;

function getOrCreateTelemetryId(): string {
  try {
    const existing = localStorage.getItem(TELEMETRY_ID_KEY);
    const lastRotation = localStorage.getItem('telemetry_id_created');
    const now = Date.now();

    if (!existing || !lastRotation || (now - parseInt(lastRotation, 10)) > ROTATION_DAYS * 86_400_000) {
      const newId = crypto.randomUUID();
      localStorage.setItem(TELEMETRY_ID_KEY, newId);
      localStorage.setItem('telemetry_id_created', String(now));
      return newId;
    }

    return existing;
  } catch {
    return crypto.randomUUID();
  }
}

function bucketize(count: number): string {
  if (count <= 10) return '0-10';
  if (count <= 50) return '11-50';
  if (count <= 100) return '51-100';
  return '100+';
}

function getActiveTheme(): string {
  try { return localStorage.getItem('app-theme') ?? 'amethyst'; } catch { return 'amethyst'; }
}

export const TelemetryService = {
  async maybeSendTelemetry(): Promise<void> {
    try {
      const lastSend = localStorage.getItem(TELEMETRY_LAST_SEND_KEY);
      const now = Date.now();

      if (lastSend && (now - parseInt(lastSend, 10)) < SEND_INTERVAL_DAYS * 86_400_000) {
        return;
      }
      const db = await getLocalDb();
      const docs = await db.getAll('documents');
      const totalWords = docs.reduce((s, d) => s + (d.totalWords ?? 0), 0);
      const avgWords = docs.length > 0 ? Math.round(totalWords / docs.length / 50) * 50 : 0;

      // Door ratios — inline simplified version to avoid core→features import
      let doorRatios: { thinking: number; feeling: number; behavior: number } | null = null;
      // Skip door analysis in telemetry to respect layer boundaries
      // (contactDoors is a feature; telemetry is core)

      // Reasoning ratio (AX-11: reasoning is now a separate boolean flag)
      const dialogues = await db.getAll('aiDialogues');
      const reasoningCount = dialogues.filter(d => d.reasoning === true).length;
      const reasoningRatio = dialogues.length > 0 ? Math.round((reasoningCount / dialogues.length) * 100) / 100 : 0;

      const payload = {
        telemetryId: getOrCreateTelemetryId(),
        activeTheme: getActiveTheme(),
        notesCountBucket: bucketize(docs.length),
        averageWordCount: avgWords,
        reasoningRatio,
        doorRatios,
        sentAt: new Date().toISOString(),
      };

      const user = getAuth().currentUser;
      if (user) {
        const { getFunctions, httpsCallable } = await import('firebase/functions');
        const sendTelemetryFn = httpsCallable(getFunctions(), 'sendTelemetry');
        await sendTelemetryFn(payload);
      }


      localStorage.setItem(TELEMETRY_LAST_SEND_KEY, String(now));
    } catch {
      // Non-critical — silently fail
    }
  },
};
