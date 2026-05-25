import * as Sentry from '@sentry/react';
import { STORAGE_KEYS } from '../../../core/constants/storageKeys';

export function reportKeystrokeStats(
  stats: { kpm: number; ikiMedian: number; ikiCv: number; sampleSize: number; kpmWpmRatio?: number },
  wpm: number,
  sessionSeconds: number
): void {
  const kpmWpmRatio = wpm > 0 ? stats.kpm / wpm : 0;
  Sentry.withScope((scope) => {
    scope.setExtra('iki_stats', { ...stats, wpm, kpmWpmRatio, sessionSeconds });
    if (stats.ikiCv > 1.2 && stats.sampleSize > 30) {
      scope.setLevel('warning');
      Sentry.captureMessage('High IKI variance detected — possible editor lag');
    }
  });
}

export async function cleanupDraftsAfterSave(
  userId: string,
  isGuest: boolean,
  docIdToSync: string | null
): Promise<void> {
  if (isGuest) {
    await clearGuestDraft();
  } else {
    try {
      const { WritingDraftService } = await import('../services/WritingDraftService');
      await WritingDraftService.deleteDraft(userId);
    } catch (delErr) {
      console.warn('[cleanupDraftsAfterSave] Failed to delete draft:', delErr);
    }
    if (docIdToSync) {
      const { SyncService } = await import('../../../core/services/SyncService');
      SyncService.syncOne(userId, docIdToSync).catch(e => {
        console.warn('[cleanupDraftsAfterSave] Cloud sync failed:', e);
      });
    }
  }
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
    console.warn('[clearGuestDraft] Failed to delete guest IDB draft:', idbErr);
  }
}
