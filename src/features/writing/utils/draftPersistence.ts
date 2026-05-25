import { User } from 'firebase/auth';
import { LocalDraft } from '../../../core/storage/localDb';
import { WritingDraftService } from '../services/WritingDraftService';
import { getLocalStorageUsageKB } from '../../../shared/lib/localStorageUtils';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';

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
    initialWordCount?: number;
    sessionStartTime?: number;
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

export async function persistDraft(draft: LocalDraft): Promise<DraftPersistResult> {
  const usageKB = getLocalStorageUsageKB();
  if (usageKB > 4500) {
    console.warn(`localStorage usage: ${usageKB.toFixed(0)}KB — approaching limit`);
  }

  const [localResult, remoteResult] = await Promise.allSettled([
    WritingDraftService.saveToLocal(draft),
    WritingDraftService.saveToFirestore(draft),
  ]);

  const localOk = localResult.status === 'fulfilled';
  const remoteOk = remoteResult.status === 'fulfilled';

  if (localOk) {
    await WritingDraftService.clearLegacyDraft(draft.userId);
  }

  if (!localOk) {
    console.error('Local save failed:', localResult.reason);
  }
  if (!remoteOk) {
    console.warn('Firestore save failed (will retry on next change):', remoteResult.reason);
  }

  return { localOk, remoteOk };
}
