import { getClient } from '../../../core/firebase/firestoreClient';
import { getLocalDb, LocalDraft } from '../../../core/storage/localDb';
import { toTimestampMs } from '../../../core/utils/dateUtils';
import { maybeEncrypt, maybeDecrypt, isProfileLoaded } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { withTimeout } from '../../../shared/utils/withTimeout';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const _abortControllers = new Map<string, AbortController>();

// Fields allowed by the `drafts/{uid}` Firestore rule (isValidDraft). The local
// draft carries extra transient state (e.g. `status`) that the rule rejects via
// hasOnly(), so only schema fields are sent to the cloud. `updatedAt` is set
// separately with a server timestamp.
const DRAFT_CLOUD_FIELDS = new Set([
  'userId', 'content', 'title', 'pinnedThoughts', 'tags', '_encrypted',
  'seconds', 'wpm', 'wordCount', 'initialWordCount', 'activeSessionId',
  'sessionStartTime', 'accumulatedDuration', 'totalPauseSeconds',
  'savedDocumentId', 'labelId',
]);

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
      const s = sessionStorage.getItem(STORAGE_KEYS.DRAFT_DELETED(userId));
      if (s) deletedAt = parseInt(s, 10);
    } catch (e) { reportError(e, { action: 'loadDraft_sessionStorageRead', userId }); }

    const [localResult, legacyResult, cloudResult] = await Promise.allSettled([
      (async () => {
        const localDb = await getLocalDb();
        if (hasDraftsStore(localDb)) {
          return await localDb.get('drafts', userId) ?? null;
        }
        return null;
      })(),
      (async () => {
        const raw = localStorage.getItem(STORAGE_KEYS.DRAFT(userId));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.content) return { ...parsed, userId } as LocalDraft;
        }
        return null;
      })(),
      withTimeout((async () => {
        const { db, mod } = await getClient();
        const { doc, getDoc } = mod;
        const docRef = doc(db, 'drafts', userId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const decrypted: unknown = await maybeDecrypt(docSnap.data() as Record<string, unknown>, ['content'], ['pinnedThoughts']);
          return decrypted as LocalDraft;
        }
        return null;
      })(), 10000),
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
        winner = localTs > cloudTs ? resolvedLocal : cloudDraft;
      }
      if (deletedAt && (toTimestampMs(winner.updatedAt) ?? 0) <= deletedAt) {
        await WritingDraftService.deleteDraft(userId);
        return null;
      }
      if (isDraftExpired(winner)) {
        await WritingDraftService.deleteDraft(userId);
        return null;
      }
      if (winner === cloudDraft) {
        await WritingDraftService.saveToLocal(cloudDraft).catch(() => {});
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
      if (resolved === cloudDraft) {
        await WritingDraftService.saveToLocal(cloudDraft).catch(() => {});
      }
    }
    return resolved;
  },

  clearLegacyDraft: async (userId: string) => {
    try {
      localStorage.removeItem(STORAGE_KEYS.DRAFT(userId));
    } catch (e) { reportError(e, { action: 'clearLegacyDraft', userId }); }
  },

  saveToLocal: async (draft: LocalDraft) => {
    try {
      const localDb = await getLocalDb();
      await localDb.put('drafts', draft);
    } catch (err) {
      reportError(err, { action: 'saveToLocal', userId: draft.userId });
      // D-1: re-throw so Promise.allSettled sees 'rejected' and localOk is
      // false — prevents the UI from showing "Saved" when the draft is lost.
      throw err;
    }
  },

  saveToFirestore: async (draft: LocalDraft) => {
    if (!draft.userId) return;
    if (!isProfileLoaded(draft.userId)) {
      return;
    }
    const oldAc = _abortControllers.get(draft.userId);
    if (oldAc) {
      oldAc.abort();
    }
    const ac = new AbortController();
    _abortControllers.set(draft.userId, ac);
    const { db, mod } = await getClient();
    if (ac.signal.aborted) return;
    const { doc, setDoc, serverTimestamp } = mod;
    const docRef = doc(db, 'drafts', draft.userId);
    const draftRecord: Record<string, unknown> = { ...draft };
    const encrypted = await maybeEncrypt(draftRecord, ['content'], ['pinnedThoughts'], draft.userId);
    const clean = Object.fromEntries(
      Object.entries(encrypted).filter(([k, v]) => v !== undefined && DRAFT_CLOUD_FIELDS.has(k))
    );
    try {
      await setDoc(docRef, { ...clean, updatedAt: serverTimestamp() });
    } catch (e) {
      if (ac.signal.aborted) return;
      reportError(e, { action: 'saveToFirestore', userId: draft.userId });
      throw new Error('Draft save aborted');
    } finally {
      if (_abortControllers.get(draft.userId) === ac) {
        _abortControllers.delete(draft.userId);
      }
    }
  },

  deleteDraft: async (userId: string) => {
    if (!userId) return;
    _abortControllers.get(userId)?.abort();
    _abortControllers.delete(userId);
    try { sessionStorage.setItem(STORAGE_KEYS.DRAFT_DELETED(userId), Date.now().toString()); } catch (e) { reportError(e, { action: 'deleteDraft_sessionStorageWrite', userId }); }
    try {
      const localDb = await getLocalDb();
      if (hasDraftsStore(localDb)) {
        await localDb.delete('drafts', userId);
      }
    } catch (err) {
      reportError(err, { action: 'deleteDraft_local', userId });
    }
    try {
      localStorage.removeItem(STORAGE_KEYS.DRAFT(userId));
    } catch (e) { reportError(e, { action: 'deleteDraft_legacyLocalStorage', userId }); }
    try {
      const { db, mod } = await getClient();
      const { doc, deleteDoc } = mod;
      await deleteDoc(doc(db, 'drafts', userId));
    } catch (err) {
      reportError(err, { action: 'deleteDraft_cloud', userId });
    }
  }
};
