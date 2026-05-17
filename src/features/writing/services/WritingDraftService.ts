import { getClient } from '../../../core/firebase/firestoreClient';
import { getLocalDb, LocalDraft } from '../../../shared/lib/localDb';
import { toTimestampMs } from '../../../core/utils/dateUtils';

const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const _abortControllers = new Map<string, AbortController>();

function isDraftExpired(draft: LocalDraft): boolean {
  const updated = toTimestampMs(draft.updatedAt) ?? 0;
  return updated > 0 && Date.now() - updated > DRAFT_MAX_AGE_MS;
}

function hasDraftsStore(localDb: { objectStoreNames: DOMStringList }): boolean {
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
      if (hasDraftsStore(localDb)) {
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
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
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
    const ac = new AbortController();
    _abortControllers.set(draft.userId, ac);
    const { db, mod } = await getClient();
    if (ac.signal.aborted) return;
    const { doc, setDoc } = mod;
    const docRef = doc(db, 'drafts', draft.userId);
    const clean = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined));
    try {
      await setDoc(docRef, clean, { merge: true });
    } catch {
      if (ac.signal.aborted) return;
      throw new Error('Draft save aborted');
    }
    _abortControllers.delete(draft.userId);
  },

  deleteDraft: async (userId: string) => {
    if (!userId) return;
    _abortControllers.get(userId)?.abort();
    _abortControllers.delete(userId);
    try { sessionStorage.setItem(`draft-deleted-${userId}`, Date.now().toString()); } catch { /* ignore */ }
    try {
      const localDb = await getLocalDb();
      if (hasDraftsStore(localDb)) {
        await localDb.delete('drafts', userId);
      }
    } catch (err) {
      console.error('[DraftService] Failed to delete local draft:', err);
    }
    try {
      localStorage.removeItem(`draft-${userId}`);
    } catch { /* ignore */ }
    try {
      const { db, mod } = await getClient();
      const { doc, deleteDoc } = mod;
      await deleteDoc(doc(db, 'drafts', userId));
    } catch (err) {
      console.error('[DraftService] Failed to delete cloud draft:', err);
    }
  }
};
