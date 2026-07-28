import { getLocalDb } from '../../../core/storage/localDb';
import { getClient } from '../../../core/firebase/firestoreClient';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { getEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { logger } from '../../../shared/errors/logger';
import { decodeCloudSummary } from './AISummaryService';
import { decodeCloudEmbedding } from './AIEmbeddingService';

export interface AIRestoreResult {
  summaries: number;
  embeddings: number;
  failed: number;
  skippedLocked: boolean;
}

/**
 * Pulls AI analysis back from the cloud into local storage.
 *
 * Signing out wipes every local store (SEC-29), which is correct on a shared
 * device but also deletes summaries and embeddings that cost real LLM calls to
 * produce. Both live in Firestore, so they never have to be recomputed — but
 * nothing walked those collections to bring them home, and the embedding
 * indexer deliberately never reads the cloud in its loop, so it would have
 * re-embedded every note from scratch instead.
 *
 * Read-only against the cloud, and it never overwrites a local record that is
 * already there: a restore must not clobber work newer than the cloud copy.
 */
export async function restoreAIDataFromCloud(userId: string): Promise<AIRestoreResult> {
  const result: AIRestoreResult = { summaries: 0, embeddings: 0, failed: 0, skippedLocked: false };
  if (!userId) return result;

  // With E2E on but the vault locked, every decrypt throws. Restoring now would
  // just burn reads and log noise; the caller retries after unlock.
  if (getEncryptionEnabled(userId) && !getSessionKey()) {
    result.skippedLocked = true;
    return result;
  }

  const db = await getLocalDb();
  const { db: fs, mod } = await getClient();

  const existingSummaries = new Set((await db.getAllKeys('aiSummaries')).map(String));
  const existingEmbeddings = new Set((await db.getAllKeys('aiEmbeddings')).map(String));

  try {
    const snap = await mod.getDocs(mod.collection(fs, 'users', userId, 'summaries'));
    for (const d of snap.docs) {
      if (existingSummaries.has(d.id)) continue;
      try {
        await db.put('aiSummaries', await decodeCloudSummary(d.data() as Record<string, unknown>, d.id));
        result.summaries++;
      } catch {
        result.failed++;
      }
    }
  } catch (e) {
    reportError(e, { action: 'restoreAIData_summaries', userId });
  }

  try {
    const snap = await mod.getDocs(mod.collection(fs, 'users', userId, 'embeddings'));
    for (const d of snap.docs) {
      if (existingEmbeddings.has(d.id)) continue;
      try {
        await db.put('aiEmbeddings', await decodeCloudEmbedding(d.data() as Record<string, unknown>, d.id));
        result.embeddings++;
      } catch {
        result.failed++;
      }
    }
  } catch (e) {
    reportError(e, { action: 'restoreAIData_embeddings', userId });
  }

  if (result.summaries || result.embeddings || result.failed) {
    logger.info('AIRestoreService', 'Restored AI data from cloud', { ...result });
  }
  return result;
}
