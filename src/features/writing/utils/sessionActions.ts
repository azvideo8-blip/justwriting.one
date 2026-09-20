import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { logger } from '../../../shared/errors/logger';

export function reportKeystrokeStats(
  stats: { kpm: number; ikiMedian: number; ikiCv: number; sampleSize: number; kpmWpmRatio?: number },
  wpm: number,
  sessionSeconds: number
): void {
  const kpmWpmRatio = wpm > 0 ? stats.kpm / wpm : 0;
  if (stats.ikiCv > 1.2 && stats.sampleSize > 30) {
    logger.warn('sessionActions', 'High IKI variance detected — possible editor lag', {
      kpm: stats.kpm,
      ikiMedian: stats.ikiMedian,
      ikiCv: stats.ikiCv,
      sampleSize: stats.sampleSize,
      wpm,
      kpmWpmRatio,
      sessionSeconds,
    });
  }
}

export async function cleanupDraftsAfterSave(
  userId: string,
  isGuest: boolean,
  docIdToSync: string | null
): Promise<{ cloudSynced: boolean }> {
  let cloudSynced = false;
  if (isGuest) {
    await clearGuestDraft();
  } else {
    try {
      const { WritingDraftService } = await import('../services/WritingDraftService');
      WritingDraftService.bumpDraftGeneration(userId);
      await WritingDraftService.deleteDraft(userId);
    } catch (delErr) {
      logger.warn('sessionActions', 'Failed to delete draft', { error: String(delErr) });
    }
    if (docIdToSync) {
      try {
        const { SyncService } = await import('../../../core/services/SyncService');
        const cloudId = await SyncService.syncOne(userId, docIdToSync);
        cloudSynced = Boolean(cloudId);
      } catch (e) {
        logger.warn('sessionActions', 'Cloud sync failed', { error: String(e) });
        try {
          const { SyncService } = await import('../../../core/services/SyncService');
          await SyncService.addToQueue(docIdToSync);
        } catch (queueErr) {
          logger.error('sessionActions', 'Failed to add failed sync to syncQueue', {
            error: String(queueErr),
          });
        }
      }
    }
  }
  return { cloudSynced };
}

async function clearGuestDraft() {
  localStorage.removeItem(STORAGE_KEYS.GUEST_DRAFT);
  try {
    const { getLocalDb } = await import('../../../core/storage/localDb');
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      await db.delete('drafts', 'guest_draft');
    }
  } catch (idbErr) {
    logger.warn('sessionActions', 'Failed to delete guest IDB draft', { error: String(idbErr) });
  }
}
