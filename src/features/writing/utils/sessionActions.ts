import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { logger } from '../../../shared/errors/logger';
import { WritingDraftService } from '../services/WritingDraftService';
import { SyncService } from '../../../core/services/SyncService';

export function reportKeystrokeStats(
  stats: { kpm: number; ikiMedian: number; ikiCv: number; sampleSize: number; kpmWpmRatio?: number },
  wpm: number,
  sessionSeconds: number
): void {
  const kpmWpmRatio = wpm > 0 ? stats.kpm / wpm : 0;
  // Разброс интервалов между нажатиями отличает задержку редактора от пауз
  // человека («подумал, написал фразу») никак: у живого письма он больше 1.2
  // почти всегда. Как предупреждение в журнал он шёл ложной тревогой на каждую
  // сессию, поэтому только в консоль разработчика. Настоящая задержка — это
  // время от нажатия до отрисовки, а не ритм.
  if (stats.ikiCv > 1.2 && stats.sampleSize > 30) {
    logger.info('sessionActions', 'High IKI variance (typing rhythm, not a fault)', {
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
    // N-54: deleteDraft не бросает — результат читается, а не ловится.
    WritingDraftService.bumpDraftGeneration(userId);
    if (!(await WritingDraftService.deleteDraft(userId))) {
      logger.warn('sessionActions', 'Draft not deleted after save — it may reappear as an unsaved draft');
    }
    if (docIdToSync) {
      try {
        await SyncService.addToQueue(docIdToSync);
      } catch (queueErr) {
        logger.error('sessionActions', 'Failed to add to syncQueue before sync', {
          error: String(queueErr),
        });
      }
      try {
        const cloudId = await SyncService.syncOne(userId, docIdToSync);
        cloudSynced = Boolean(cloudId);
      } catch (e) {
        logger.warn('sessionActions', 'Cloud sync failed, task remains in syncQueue', { error: String(e) });
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
