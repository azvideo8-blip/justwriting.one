import { DataProvider } from '../../../core/data';
import { getLocalDb, LocalDraft } from '../../../core/storage/localDb';
import { toTimestampMs } from '../../../core/utils/dateUtils';
import { maybeEncrypt, maybeDecrypt, isProfileLoaded } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { withTimeout } from '../../../shared/utils/withTimeout';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
const DRAFT_CLOUD_FIELDS: Record<string, boolean> = {
  content: true,
  title: true,
  pinnedThoughts: true,
  tags: true,
  labelId: true,
  wordCount: true,
  initialWordCount: true,
  activeSessionId: true,
  savedDocumentId: true,
  sessionStartTime: true,
  updatedAt: true,
};

const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const _abortControllers = new Map<string, AbortController>();
// Signature of what was last actually written to the cloud, per user.
const _lastCloudSignature = new Map<string, string>();

// Fields worth a Firestore write. The elapsed-time counters (seconds, wpm,
// accumulatedDuration, totalPauseSeconds, updatedAt) are deliberately absent:
// they change on their own while the writer sits still, so including them made
// the 30s cloud autosave rewrite the entire draft — full note content — every
// 30 seconds of an open session, typing or not. The local IndexedDB draft still
// carries exact timings; the cloud copy is the cross-device fallback, and its
// timer can lag until the text next changes.
const DRAFT_SIGNIFICANT_FIELDS = [
  'content', 'title', 'pinnedThoughts', 'tags', 'labelId',
  'wordCount', 'initialWordCount', 'activeSessionId', 'savedDocumentId', 'sessionStartTime',
] as const;

function draftSignature(draft: LocalDraft): string {
  const record = draft as unknown as Record<string, unknown>;
  return JSON.stringify(DRAFT_SIGNIFICANT_FIELDS.map(k => record[k] ?? null));
}

// Fields allowed by the `drafts/{uid}` Firestore rule (isValidDraft). The local
// draft carries extra transient state (e.g. `status`) that the rule rejects via
// hasOnly(), so only schema fields are sent to the cloud. `updatedAt` is set
// separately with a server timestamp.

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
        const draftData = await DataProvider.getDraft(userId);
        if (draftData) {
          const decrypted: unknown = await maybeDecrypt(draftData, ['content'], ['pinnedThoughts']);
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

  // Раньше называлось saveToFirestore, и это же имя уходило в журнал ошибок.
  // Firestore здесь нет с момента переезда — внутри DataProvider.saveDraft, то
  // есть Supabase, — но сообщение «Firestore save failed» отправляло искать
  // причину в мёртвом слое. Имя в журнале должно называть то место, где отказ
  // случился на самом деле.
  saveDraftToCloud: async (draft: LocalDraft): Promise<boolean> => {
    if (!draft.userId) return false;
    if (!isProfileLoaded(draft.userId)) {
      return false;
    }
    // Nothing worth writing changed since the last successful write. Reported as
    // success: the cloud copy IS current, which is what the caller's staleness
    // flag asks about.
    const signature = draftSignature(draft);
    if (_lastCloudSignature.get(draft.userId) === signature) return true;

    const oldAc = _abortControllers.get(draft.userId);
    if (oldAc) {
      oldAc.abort();
    }
    const ac = new AbortController();
    _abortControllers.set(draft.userId, ac);
    const draftRecord = draft as unknown as Record<string, unknown>;
    const encrypted = await maybeEncrypt(draftRecord, ['content'], ['pinnedThoughts'], draft.userId);
    const clean = Object.fromEntries(
      Object.entries(encrypted).filter(([k, v]) => v !== undefined && (k in DRAFT_CLOUD_FIELDS))
    );
    try {
      await DataProvider.saveDraft(draft.userId, clean);
      _lastCloudSignature.set(draft.userId, signature);
      return true;
    } catch (e) {
      if (ac.signal.aborted) return true;
      reportError(e, { action: 'saveDraftToCloud', userId: draft.userId });
      throw e;
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
    // The next draft must be written even if it opens with identical text.
    _lastCloudSignature.delete(userId);
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
      await DataProvider.deleteDraft(userId);
    } catch (err) {
      reportError(err, { action: 'deleteDraft_cloud', userId });
    }
  }
};
