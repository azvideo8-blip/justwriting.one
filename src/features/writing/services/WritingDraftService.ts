import { getLocalDb, LocalDraft } from '../../../shared/lib/localDb';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { toTimestampMs } from '../../../core/utils/dateUtils';

const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const _saveGeneration = new Map<string, number>();

function isDraftExpired(draft: LocalDraft): boolean {
  const updated = toTimestampMs(draft.updatedAt) ?? 0;
  return updated > 0 && Date.now() - updated > DRAFT_MAX_AGE_MS;
}

function hasDraftsStore(localDb: IDBDatabase): boolean {
  return localDb.objectStoreNames.contains('drafts');
}

export const WritingDraftService = {
  loadDraft: async (userId: string): Promise<LocalDraft | null> => {
    let deletedAt = 0;
    try {
      const s = sessionStorage.getItem(`draft-deleted-${userId}`);
      if (s) deletedAt = parseInt(s, 10);
    } catch { /* ignore */ }

    let localDraft: LocalDraft | null = null;
    try {
      const localDb = await getLocalDb();
      if (hasDraftsStore(localDb as unknown as IDBDatabase)) {
        localDraft = await localDb.get('drafts', userId) ?? null;
      }
    } catch (err) {
      console.error('[DraftService] Failed to load local draft:', err);
    }

    if (!localDraft) {
      try {
        const raw = localStorage.getItem(`draft-${userId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.content) {
            localDraft = { ...parsed, userId } as LocalDraft;
          }
        }
      } catch (err) {
        console.warn('[DraftService] Failed to parse localStorage draft:', err);
      }
    }

    let cloudDraft: LocalDraft | null = null;
    try {
      const docRef = doc(db, 'drafts', userId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        cloudDraft = docSnap.data() as LocalDraft;
      }
    } catch (err) {
      console.error('[DraftService] Failed to load cloud draft:', err);
    }

    if (localDraft && cloudDraft) {
      const winner = (toTimestampMs(localDraft.updatedAt) ?? 0) > (toTimestampMs(cloudDraft.updatedAt) ?? 0) ? localDraft : cloudDraft;
      if (deletedAt && (toTimestampMs(winner.updatedAt) ?? 0) <= deletedAt) {
        await WritingDraftService.deleteDraft(userId);
        return null;
      }
      if (isDraftExpired(winner)) {
        await WritingDraftService.deleteDraft(userId);
        return null;
      }
      return winner;
    }
    const resolved = localDraft || cloudDraft;
    if (resolved) {
      if (deletedAt && (toTimestampMs(resolved.updatedAt) ?? 0) <= deletedAt) {
        await WritingDraftService.deleteDraft(userId);
        return null;
      }
      if (isDraftExpired(resolved)) {
        await WritingDraftService.deleteDraft(userId);
        return null;
      }
    }
    return resolved;
  },

  clearLegacyDraft: async (userId: string) => {
    try {
      localStorage.removeItem(`draft-${userId}`);
    } catch { /* ignore */ }
  },

  importDraft: async (userId: string, draft: LocalDraft) => {
    try {
      const localDb = await getLocalDb();
      const newDraft = { ...draft, userId };
      await localDb.put('drafts', newDraft);
    } catch (err) {
      console.error('[DraftService] Failed to import draft to local:', err);
    }
    try {
      const docRef = doc(db, 'drafts', userId);
      await setDoc(docRef, { ...draft, userId }, { merge: true });
    } catch (err) {
      console.error('[DraftService] Failed to import draft to Firestore:', err);
    }
  },

  saveToLocal: async (draft: LocalDraft) => {
    try {
      const localDb = await getLocalDb();
      await localDb.put('drafts', draft);
    } catch (err) {
      console.error('[DraftService] Failed to save draft locally:', err);
    }
  },

  saveToFirestore: async (draft: LocalDraft) => {
    if (!draft.userId) return;
    const genAtStart = _saveGeneration.get(draft.userId) ?? 0;
    const docRef = doc(db, 'drafts', draft.userId);
    await setDoc(docRef, draft, { merge: true });
    if (_saveGeneration.get(draft.userId) !== genAtStart) {
      try { await deleteDoc(docRef); } catch { /* ignore */ }
    }
  },

  deleteDraft: async (userId: string) => {
    if (!userId) return;
    _saveGeneration.set(userId, (_saveGeneration.get(userId) ?? 0) + 1);
    try { sessionStorage.setItem(`draft-deleted-${userId}`, Date.now().toString()); } catch { /* ignore */ }
    try {
      const localDb = await getLocalDb();
      if (hasDraftsStore(localDb as unknown as IDBDatabase)) {
        await localDb.delete('drafts', userId);
      }
    } catch (err) {
      console.error('[DraftService] Failed to delete local draft:', err);
    }
    try {
      localStorage.removeItem(`draft-${userId}`);
    } catch { /* ignore */ }
    try {
      await deleteDoc(doc(db, 'drafts', userId));
    } catch (err) {
      console.error('[DraftService] Failed to delete cloud draft:', err);
    }
  }
};
