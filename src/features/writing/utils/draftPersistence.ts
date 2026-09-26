import type { AppUser } from '../../../core/auth/types';
import { LocalDraft } from '../../../core/storage/localDb';
import { WritingDraftService } from '../services/WritingDraftService';
import { getLocalStorageUsageKB } from '../../../shared/lib/localStorageUtils';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { logger } from '../../../shared/errors/logger';


export function buildLocalDraft(
  user: AppUser,
  draftData: {
    title: string;
    content: string;
    pinnedThoughts: string[];
    seconds: number;
    wpm: number;
    wordCount: number;
    initialWordCount?: number | undefined;
    sessionStartTime?: number | undefined;
    activeSessionId: string | null;
    status: string;
  }
): LocalDraft {
  const contentState = useContentStore.getState();
  const timerState = useTimerStore.getState();
  const metaState = useSessionMetaStore.getState();
  return {
    userId: user.uid,
    ...draftData,
    sessionStartTime: draftData.sessionStartTime ?? null,
    accumulatedDuration: timerState.accumulatedDuration,
    totalPauseSeconds: timerState.totalPauseSeconds,
    savedDocumentId: metaState.savedDocumentId,
    tags: contentState.tags,
    labelId: contentState.labelId,
    updatedAt: Date.now(),
  } as LocalDraft;
}

export interface DraftPersistResult {
  localOk: boolean;
  remoteOk: boolean;
  localSkipped?: boolean;
  remoteSkipped?: boolean;
  remoteError?: unknown;
}

export async function persistDraft(
  draft: LocalDraft,
  options: { remote?: boolean; generation?: number } = { remote: true }
): Promise<DraftPersistResult> {
  const usageKB = getLocalStorageUsageKB();
  if (usageKB > 4500) {
    logger.warn('draftPersistence', `localStorage usage: ${usageKB.toFixed(0)}KB — approaching limit`);
  }

  const generation = options.generation ?? WritingDraftService.getDraftGeneration(draft.userId);

  const shouldRemoteSave = options.remote ?? true;
  const promises: [Promise<unknown>, Promise<unknown>] = [
    WritingDraftService.saveToLocal(draft, generation),
    shouldRemoteSave
      ? WritingDraftService.saveDraftToCloud(draft, generation)
      : Promise.resolve(true),
  ];

  const [localResult, remoteResult] = await Promise.allSettled(promises);

  const localOk = localResult.status === 'fulfilled';
  const localSkipped = localOk && localResult.value === false;
  const remoteOk = !shouldRemoteSave || (remoteResult.status === 'fulfilled' && remoteResult.value === true);
  const remoteError = remoteResult.status === 'rejected' ? remoteResult.reason : undefined;

  if (localOk) {
    await WritingDraftService.clearLegacyDraft(draft.userId);
  }

  if (!localOk) {
    logger.error('draftPersistence', 'Local save failed', { reason: String(localResult.reason) });
  }
  if (shouldRemoteSave && !remoteOk) {
    const err = remoteError as { code?: unknown; status?: unknown; message?: unknown } | undefined;
    const code = typeof err?.code === 'string' ? err.code : typeof err?.code === 'number' ? String(err.code) : undefined;
    const status = typeof err?.status === 'string' ? err.status : typeof err?.status === 'number' ? String(err.status) : undefined;
    const msg = typeof err?.message === 'string' ? err.message : String(remoteError || 'Did not write');
    const isPermanent = code === '23514' || status === '400' || msg.includes('check constraint') || msg.includes('23514');

    if (isPermanent) {
      logger.error('draftPersistence', 'Cloud save permanently refused by constraint/validation', { reason: msg, code, status });
    } else {
      logger.warn('draftPersistence', 'Cloud save failed (will retry on next change)', { reason: msg });
    }
  }

  return { localOk, localSkipped, remoteOk, remoteError };
}
