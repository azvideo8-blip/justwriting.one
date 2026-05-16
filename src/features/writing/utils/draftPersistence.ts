import { User } from 'firebase/auth';
import { LocalDraft } from '../../../shared/lib/localDb';
import { WritingDraftService } from '../services/WritingDraftService';
import { getLocalStorageUsageKB } from '../../../shared/lib/localStorageUtils';
import { useWritingStore } from '../store/useWritingStore';

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
  const store = useWritingStore.getState();
  return {
    userId: user.uid,
    ...draftData,
    sessionStartTime: draftData.sessionStartTime ?? null,
    accumulatedDuration: store.accumulatedDuration,
    totalPauseSeconds: store.totalPauseSeconds,
    savedDocumentId: store.savedDocumentId,
    tags: store.tags,
    labelId: store.labelId,
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

  if (!localOk) {
    console.error('Local save failed:', localResult.reason);
  }
  if (!remoteOk) {
    console.warn('Firestore save failed (will retry on next change):', remoteResult.reason);
  }

  return { localOk, remoteOk };
}
