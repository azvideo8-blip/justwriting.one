import { getLocalDb, LocalDraft } from '../../../shared/lib/localDb';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';

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
    } catch {}

    let cloudDraft: LocalDraft | null = null;
    try {
      const docRef = doc(db, 'drafts', userId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        cloudDraft = docSnap.data() as LocalDraft;
      }
    } catch {}

    if (localDraft && cloudDraft) {
      return localDraft.updatedAt > cloudDraft.updatedAt ? localDraft : cloudDraft;
    }
    return localDraft || cloudDraft;
  },

  importDraft: async (userId: string, draft: LocalDraft) => {
    try {
      const localDb = await getLocalDb();
      const newDraft = { ...draft, userId };
      await localDb.put('drafts', newDraft);
    } catch {}
    try {
      const docRef = doc(db, 'drafts', userId);
      await setDoc(docRef, { ...draft, userId }, { merge: true });
    } catch {}
  },

  saveToLocal: async (draft: LocalDraft) => {
    try {
      const localDb = await getLocalDb();
      await localDb.put('drafts', draft);
    } catch {}
  },

  saveToFirestore: async (draft: LocalDraft) => {
    try {
      const docRef = doc(db, 'drafts', draft.userId);
      await setDoc(docRef, draft, { merge: true });
    } catch {}
  },

  deleteDraft: async (userId: string) => {
    try {
      const localDb = await getLocalDb();
      if (hasDraftsStore(localDb as unknown as IDBDatabase)) {
        await localDb.delete('drafts', userId);
      }
    } catch {}
  }
};
