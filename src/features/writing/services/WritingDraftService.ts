import { getClient } from '../../../core/firebase/firestoreClient';
import { getLocalDb, LocalDraft } from '../../../shared/lib/localDb';
import { toTimestampMs } from '../../../core/utils/dateUtils';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';

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

    const [localResult, legacyResult, cloudResult] = await Promise.allSettled([
      (async () => {
        const localDb = await getLocalDb();
        if (hasDraftsStore(localDb)) {
          return await localDb.get('drafts', userId) ?? null;
        }
        return null;
      })(),
      (async () => {
        const raw = localStorage.getItem(`draft-${userId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.content) return { ...parsed, userId } as LocalDraft;
        }
        return null;
      })(),
      (async () => {
        const { db, mod } = await getClient();
        const { doc, getDoc } = mod;
        const docRef = doc(db, 'drafts', userId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          return (await maybeDecrypt(docSnap.data() as Record<string, unknown>, ['content'], ['pinnedThoughts'])) as unknown as LocalDraft;
        }
        return null;
      })(),
    ]);

    const localDraft: LocalDraft | null = localResult.status === 'fulfilled' ? localResult.value : null;
    const legacyDraft: LocalDraft | null = legacyResult.status === 'fulfilled' ? legacyResult.value : null;
    const cloudDraft: LocalDraft | null = cloudResult.status === 'fulfilled' ? cloudResult.value : null;

    const resolvedLocal = localDraft || legacyDraft;

    if (resolvedLocal && cloudDraft) {
      const localTs = toTimestampMs(resolvedLocal.updatedAt) ?? 0;
      const cloudTs = toTimestampMs(cloudDraft.updatedAt) ?? 0;
      let winner: LocalDraft;
      if (Math.abs(localTs - cloudTs) < 60_000) {
        winner = (resolvedLocal.wordCount ?? 0) >= (cloudDraft.wordCount ?? 0) ? resolvedLocal : cloudDraft;
      } else {
        winner = localTs > cloudTs ? localDraft : cloudDraft;
      }
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
    const resolved = resolvedLocal || cloudDraft;
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
    const { doc, setDoc, serverTimestamp } = mod;
    const docRef = doc(db, 'drafts', draft.userId);
    const encrypted = await maybeEncrypt(draft as unknown as Record<string, unknown>, ['content'], ['pinnedThoughts'], true);
    const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
    try {
      await setDoc(docRef, { ...clean, updatedAt: serverTimestamp() }, { merge: true });
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
