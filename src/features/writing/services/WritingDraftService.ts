import { getLocalDb, LocalDraft } from '../../../shared/lib/localDb';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';

const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isDraftExpired(draft: LocalDraft): boolean {
  const updated = toMs(draft.updatedAt);
  return updated > 0 && Date.now() - updated > DRAFT_MAX_AGE_MS;
}

function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && 'toDate' in (v as object)) return (v as { toDate: () => Date }).toDate().getTime();
  if (typeof v === 'object' && 'toMillis' in (v as object)) return (v as { toMillis: () => number }).toMillis();
  if (typeof v === 'object' && 'seconds' in (v as object)) return (v as { seconds: number }).seconds * 1000;
  return 0;
}

function hasDraftsStore(localDb: IDBDatabase): boolean {
  return localDb.objectStoreNames.contains('drafts');
}

export const WritingDraftService = {
  loadDraft: async (userId: string): Promise<LocalDraft | null> => {
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
      const winner = toMs(localDraft.updatedAt) > toMs(cloudDraft.updatedAt) ? localDraft : cloudDraft;
      if (isDraftExpired(winner)) {
        await WritingDraftService.deleteDraft(userId);
        return null;
      }
      return winner;
    }
    const resolved = localDraft || cloudDraft;
    if (resolved && isDraftExpired(resolved)) {
      await WritingDraftService.deleteDraft(userId);
      return null;
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
    const docRef = doc(db, 'drafts', draft.userId);
    await setDoc(docRef, draft, { merge: true });
  },

  deleteDraft: async (userId: string) => {
    try {
      const localDb = await getLocalDb();
      if (hasDraftsStore(localDb as unknown as IDBDatabase)) {
        await localDb.delete('drafts', userId);
      }
    } catch (err) {
      console.error('[DraftService] Failed to delete local draft:', err);
    }
    try {
      await deleteDoc(doc(db, 'drafts', userId));
    } catch (err) {
      console.error('[DraftService] Failed to delete cloud draft:', err);
    }
  }
};
