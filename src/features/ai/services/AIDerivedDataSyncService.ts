// src/features/ai/services/AIDerivedDataSyncService.ts
import { getLocalDb } from '../../../core/storage/localDb';
import { getEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { LocalStoreSyncService, getLocalStoreRecordCounts } from '../../../core/services/LocalStoreSyncService';
import { saveSummaryToCloud } from './AISummaryService';
import { saveEmbeddingToCloud } from './AIEmbeddingService';
import { reportError } from '../../../shared/errors/reportError';

export interface DerivedSyncProgress {
  phase: 'summaries' | 'embeddings' | 'stores';
  current: number;
  total: number;
}

export interface DerivedSyncResult {
  summaries: { synced: number; failed: number };
  embeddings: { synced: number; failed: number };
  stores: { synced: number; failed: number; skippedOversized: number };
  totalSynced: number;
  totalFailed: number;
  skippedLocked: boolean;
}

export const AIDerivedDataSyncService = {
  /**
   * Syncs all local summaries to cloud storage.
   * Explicit manual / backfill pass: exempt from auto_sync_enabled toggle.
   */
  async syncAllSummaries(
    userId: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<{ synced: number; failed: number; skippedLocked: boolean }> {
    if (!userId) return { synced: 0, failed: 0, skippedLocked: false };
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { synced: 0, failed: 0, skippedLocked: true };
    }

    const db = await getLocalDb();
    const summaries = await db.getAll('aiSummaries');
    let synced = 0;
    let failed = 0;

    for (let i = 0; i < summaries.length; i++) {
      const summary = summaries[i]!;
      onProgress?.(i + 1, summaries.length);
      try {
        await saveSummaryToCloud(userId, summary);
        synced++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENCRYPT_REQUIRED') || msg.includes('LOCKED')) {
          return { synced, failed, skippedLocked: true };
        }
        failed++;
        reportError(err, { action: 'syncAllSummaries_doc', docId: summary.documentId });
      }
    }

    return { synced, failed, skippedLocked: false };
  },

  /**
   * Syncs all local vector embeddings to cloud storage.
   * Explicit manual / backfill pass: exempt from auto_sync_enabled toggle.
   */
  async syncAllEmbeddings(
    userId: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<{ synced: number; failed: number; skippedLocked: boolean }> {
    if (!userId) return { synced: 0, failed: 0, skippedLocked: false };
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { synced: 0, failed: 0, skippedLocked: true };
    }

    const db = await getLocalDb();
    const embeddings = await db.getAll('aiEmbeddings');
    let synced = 0;
    let failed = 0;

    for (let i = 0; i < embeddings.length; i++) {
      const emb = embeddings[i]!;
      onProgress?.(i + 1, embeddings.length);
      try {
        const { skipped } = await saveEmbeddingToCloud(userId, emb);
        if (skipped) {
          await db.put('aiEmbeddings', { ...emb, cloudSkipped: true });
        } else {
          await db.put('aiEmbeddings', { ...emb, cloudSyncedAt: Date.now() });
          synced++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENCRYPT_REQUIRED') || msg.includes('LOCKED')) {
          return { synced, failed, skippedLocked: true };
        }
        failed++;
        reportError(err, { action: 'syncAllEmbeddings_doc', docId: emb.documentId });
      }
    }

    return { synced, failed, skippedLocked: false };
  },

  /**
   * Comprehensive derived data upload pass covering all three families:
   * 1. Summaries
   * 2. Embeddings
   * 3. 13 Local Stores
   *
   * Idempotent and resumable. Refuses to upload if vault is locked.
   */
  async syncAllDerivedData(
    userId: string,
    onProgress?: (progress: DerivedSyncProgress) => void
  ): Promise<DerivedSyncResult> {
    const result: DerivedSyncResult = {
      summaries: { synced: 0, failed: 0 },
      embeddings: { synced: 0, failed: 0 },
      stores: { synced: 0, failed: 0, skippedOversized: 0 },
      totalSynced: 0,
      totalFailed: 0,
      skippedLocked: false,
    };

    // Итоги считаются на каждом выходе, а не только на удачном. Иначе проход,
    // прерванный на середине, возвращает «отправлено 0» при сорока уехавших
    // сводках — то есть сделанную работу человек не видит и делает её заново.
    const finish = (): DerivedSyncResult => {
      result.totalSynced = result.summaries.synced + result.embeddings.synced + result.stores.synced;
      result.totalFailed = result.summaries.failed + result.embeddings.failed + result.stores.failed;
      return result;
    };

    if (!userId) return finish();

    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      result.skippedLocked = true;
      return finish();
    }

    // 1. Sync summaries
    const summariesRes = await this.syncAllSummaries(userId, (cur, tot) => {
      onProgress?.({ phase: 'summaries', current: cur, total: tot });
    });
    result.summaries.synced = summariesRes.synced;
    result.summaries.failed = summariesRes.failed;
    if (summariesRes.skippedLocked) {
      result.skippedLocked = true;
      return finish();
    }

    // 2. Sync embeddings
    const embeddingsRes = await this.syncAllEmbeddings(userId, (cur, tot) => {
      onProgress?.({ phase: 'embeddings', current: cur, total: tot });
    });
    result.embeddings.synced = embeddingsRes.synced;
    result.embeddings.failed = embeddingsRes.failed;
    if (embeddingsRes.skippedLocked) {
      result.skippedLocked = true;
      return finish();
    }

    // 3. Sync 13 local stores
    const storesRes = await LocalStoreSyncService.syncAllLocalStores(userId);
    result.stores.synced = storesRes.synced;
    result.stores.failed = storesRes.failed;
    result.stores.skippedOversized = storesRes.skippedOversized;
    if (storesRes.skippedLocked) {
      result.skippedLocked = true;
      return finish();
    }

    return finish();
  },

  /**
   * Returns counts of local derived data records across all 3 families.
   */
  async getLocalDerivedCounts(): Promise<{ summaries: number; embeddings: number; stores: number; total: number }> {
    try {
      const db = await getLocalDb();
      const summaries = await db.count('aiSummaries');
      const embeddings = await db.count('aiEmbeddings');
      const stores = await getLocalStoreRecordCounts();
      return {
        summaries,
        embeddings,
        stores,
        total: summaries + embeddings + stores,
      };
    } catch {
      return { summaries: 0, embeddings: 0, stores: 0, total: 0 };
    }
  },
};
