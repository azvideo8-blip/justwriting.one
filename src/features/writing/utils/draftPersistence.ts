import { User } from 'firebase/auth';
import { LocalDraft } from '../../../core/storage/localDb';
import { WritingDraftService } from '../services/WritingDraftService';
import { getLocalStorageUsageKB } from '../../../shared/lib/localStorageUtils';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { logger } from '../../../shared/errors/logger';

export interface DraftPersistResult {
  localOk: boolean;
  remoteOk: boolean;
}

export function buildLocalDraft(
  user: User,
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

export async function persistDraft(
  draft: LocalDraft,
  options: { remote?: boolean } = { remote: true }
): Promise<DraftPersistResult> {
  const usageKB = getLocalStorageUsageKB();
  if (usageKB > 4500) {
    logger.warn('draftPersistence', `localStorage usage: ${usageKB.toFixed(0)}KB — approaching limit`);
  }

  const shouldRemoteSave = options.remote ?? true;
  const promises: [Promise<unknown>, Promise<unknown>] = [
    WritingDraftService.saveToLocal(draft),
    shouldRemoteSave
      ? WritingDraftService.saveToFirestore(draft)
      : Promise.resolve(),
  ];

  const [localResult, remoteResult] = await Promise.allSettled(promises);

  const localOk = localResult.status === 'fulfilled';
  const remoteOk = !shouldRemoteSave || remoteResult.status === 'fulfilled';

  if (localOk) {
    await WritingDraftService.clearLegacyDraft(draft.userId);
  }

  if (!localOk) {
    logger.error('draftPersistence', 'Local save failed', { reason: String(localResult.reason) });
  }
  if (shouldRemoteSave && !remoteOk) {
    logger.warn('draftPersistence', 'Firestore save failed (will retry on next change)', { reason: String(remoteResult.reason) });
  }

  return { localOk, remoteOk };
}
