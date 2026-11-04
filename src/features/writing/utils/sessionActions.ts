import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { logger } from '../../../shared/errors/logger';
import { WritingDraftService } from '../services/WritingDraftService';
import { applySave } from '../services/draftWriter';
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
    // Дейлик 03.11 Н-1: то же вето DY10-10, что у аккаунта — без подъёма
    // поколения закрытие вкладки в окне сохранения возвращало сохранённый текст
    // гостевым черновиком. Шаг 5 DW-4: подъём делает мутатор (`applySave`).
    applySave(userId);
    await clearGuestDraft();
  } else {
    // N-54: deleteDraft не бросает — результат читается, а не ловится.
    // RA1-2: ждём только локальную половину. Облачное удаление черновика —
    // отдельно и только при связи; без сети надгробие снесёт его при
    // следующей загрузке, а кнопка «Сохранить» не держит человека 5–10 с.
    const deleted = await WritingDraftService.deleteDraftLocal(userId);
    if (!deleted.localOk) {
      logger.warn('sessionActions', 'Draft not deleted after save — it may reappear as an unsaved draft');
    }
    if (docIdToSync) {
      try {
        await SyncService.addToQueue(docIdToSync, userId);
      } catch (queueErr) {
        logger.error('sessionActions', 'Failed to add to syncQueue before sync', {
          error: String(queueErr),
        });
      }
    }
    const online = typeof navigator === 'undefined' || navigator.onLine;
    if (!online) return { cloudSynced: false };
    const cloudDeleted = await WritingDraftService.deleteDraftCloud(userId);
    if (!cloudDeleted.cloudOk) {
      logger.warn('sessionActions', 'Cloud draft not deleted — retry is queued');
    }
    if (docIdToSync) {
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
