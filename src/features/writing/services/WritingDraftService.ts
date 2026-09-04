import { DataProvider } from '../../../core/data';
import { draftDbSchema } from '../../../core/data/schemas';
import { getLocalDb, LocalDraft } from '../../../core/storage/localDb';
import { toTimestampMs } from '../../../core/utils/dateUtils';
import { maybeEncrypt, maybeDecrypt, isProfileLoaded } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { withTimeout } from '../../../shared/utils/withTimeout';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
const DRAFT_CLOUD_FIELDS: Record<string, boolean> = {
  // Признак шифрования обязан уезжать вместе с данными. Без него колонка в
  // облаке хранит шифротекст, а читающая сторона считает его открытым текстом:
  // maybeDecrypt пытается разобрать pinnedThoughts как JSON, разбор падает — и
  // поле заменяется пустым массивом. Закреплённые мысли исчезали молча.
  _encrypted: true,
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
const _draftGenerations = new Map<string, number>();
// Signature of what was last actually written to the cloud, per user.
const _lastCloudSignature = new Map<string, string>();

export function getDraftGeneration(userId: string): number {
  return _draftGenerations.get(userId) ?? 0;
}

export function bumpDraftGeneration(userId: string): number {
  const next = (_draftGenerations.get(userId) ?? 0) + 1;
  _draftGenerations.set(userId, next);
  return next;
}

// Fields worth a cloud draft write. The elapsed-time counters (seconds, wpm,
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

// Fields accepted by the cloud drafts table (DRAFT_FIELDS). The local
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
  getDraftGeneration,
  bumpDraftGeneration,

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
          const decrypted: unknown = await maybeDecrypt(draftData, ['content', 'title'], ['pinnedThoughts', 'tags']);
          // Битый облачный черновик не доходит до таймеров и сравнений дат:
          // локальная копия побеждает, мусор в состояние приложения не входит.
          const parsed = draftDbSchema.safeParse(decrypted);
          if (!parsed.success) {
            reportError(parsed.error, { action: 'loadDraft_cloud_invalid', userId });
            return null;
          }
          return parsed.data as unknown as LocalDraft;
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

  saveToLocal: async (draft: LocalDraft, generation?: number): Promise<void> => {
    if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
      return;
    }
    try {
      const localDb = await getLocalDb();
      if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
        return;
      }
      await localDb.put('drafts', draft);
    } catch (err) {
      if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
        return;
      }
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
  saveDraftToCloud: async (draft: LocalDraft, generation?: number): Promise<boolean> => {
    if (!draft.userId) return false;
    if (!isProfileLoaded(draft.userId)) {
      return false;
    }
    if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
      return false;
    }
    // Nothing worth writing changed since the last successful write. Reported as
    // success: the cloud copy IS current, which is what the caller's staleness
    // flag asks about.
    const signature = draftSignature(draft);
    if (_lastCloudSignature.get(draft.userId) === signature) return true;

    const draftRecord = draft as unknown as Record<string, unknown>;
    const encrypted = await maybeEncrypt(draftRecord, ['content', 'title'], ['pinnedThoughts', 'tags'], draft.userId);
    if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
      return false;
    }
    const clean = Object.fromEntries(
      Object.entries(encrypted).filter(([k, v]) => v !== undefined && (k in DRAFT_CLOUD_FIELDS))
    );
    try {
      if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
        return false;
      }
      await DataProvider.saveDraft(draft.userId, clean);
      _lastCloudSignature.set(draft.userId, signature);
      return true;
    } catch (e) {
      if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
        return false;
      }
      reportError(e, { action: 'saveDraftToCloud', userId: draft.userId });
      throw e;
    }
  },

  deleteDraft: async (userId: string) => {
    if (!userId) return;
    bumpDraftGeneration(userId);
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
