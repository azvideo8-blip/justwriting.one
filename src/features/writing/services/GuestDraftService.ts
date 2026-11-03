import { getLocalDb, type LocalDraft } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';
import { GUEST_DRAFT_TTL_MS, STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { applyWrite, buildGuestDraftRecord, GUEST_IDB_KEY, parseDraftRow, serializeDraftRow, type DraftRecord } from './draftWriter';

const DRAFT_KEY = STORAGE_KEYS.GUEST_DRAFT;

export async function saveGuestDraftToStorage(
  draft: DraftRecord,
  // Заметка ревьюера 03.11 13:55 (сид 103): гостевая отсрочка называет эпоху
  // мутатору — иначе снятие writer-стража возвращает класс «поздняя запись в
  // окне сохранения».
  opts: { uid?: string | undefined; epoch?: number | undefined } = {},
): Promise<void> {
  // DW4-4: гость называет владельцем себя — гостевой текст не имеет
  // владельца-аккаунта по смыслу (DW-6), а зеркало ведёт аккаунты.
  const rec = buildGuestDraftRecord({ ...draft, owner: opts.uid });
  let idbFailed = false;
  let lsFailed = false;
  try {
    // Строка отсрочки живёт под `guest_draft` (адрес читают load/migration),
    // а `uid` гостя — не ключ: `saveToLocal` пишет гостевые строки по `uid`.
    await applyWrite(rec, 'edit', { uid: opts.uid, target: 'row', epoch: opts.epoch, rowKey: GUEST_IDB_KEY });
  } catch (e) {
    idbFailed = true;
    reportError(e, { action: 'saveGuestDraft_idb' }, 'warning');
  }
  try {
    await applyWrite(rec, 'edit', { uid: opts.uid, target: 'copy', epoch: opts.epoch });
  } catch (e) {
    lsFailed = true;
    reportError(e, { action: 'saveGuestDraft_ls' }, 'warning');
  }
  if (idbFailed && lsFailed) {
    throw new Error('GUEST_DRAFT_SAVE_FAILED: both IDB and localStorage failed');
  }
}

export async function loadGuestDraftFromStorage(): Promise<DraftRecord | null> {
  let idbDraft: DraftRecord | null = null;
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      idbDraft = parseDraftRow(await db.get('drafts', GUEST_IDB_KEY));
    }
  } catch (e) {
    reportError(e, { action: 'loadGuestDraft_idb' }, 'warning');
  }

  let lsDraft: DraftRecord | null = null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      lsDraft = parseDraftRow(JSON.parse(raw));
    }
  } catch (e) {
    reportError(e, { action: 'loadGuestDraft_ls_read' }, 'warning');
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch { /* ignore cleanup */ }
  }

  let resultDraft: DraftRecord | null = null;

  if (idbDraft && lsDraft) {
    const idbTs = idbDraft.updatedAt ?? idbDraft.timestamp ?? 0;
    const lsTs = lsDraft.updatedAt ?? lsDraft.timestamp ?? 0;
    const winner = idbTs >= lsTs ? idbDraft : lsDraft;
    if (winner === lsDraft) {
      try {
        const db = await getLocalDb();
        await db.put('drafts', serializeDraftRow(winner, { kind: 'idb', key: GUEST_IDB_KEY }) as unknown as LocalDraft);
      } catch (e) {
        reportError(e, { action: 'loadGuestDraft_ls_sync' }, 'warning');
      }
    }
    resultDraft = winner;
  } else if (lsDraft && !idbDraft) {
    try {
      const db = await getLocalDb();
      if (db.objectStoreNames.contains('drafts')) {
        await db.put('drafts', serializeDraftRow(lsDraft, { kind: 'idb', key: GUEST_IDB_KEY }) as unknown as LocalDraft);
      }
    } catch (e) {
      reportError(e, { action: 'loadGuestDraft_ls_restore' }, 'warning');
    }
    resultDraft = lsDraft;
  } else {
    resultDraft = idbDraft;
  }

  if (resultDraft) {
    const ts = resultDraft.updatedAt ?? resultDraft.timestamp;
    if (typeof ts === 'number' && ts > 1_000_000_000_000 && Date.now() - ts > GUEST_DRAFT_TTL_MS) {
      await deleteGuestDraftFromStorage();
      return null;
    }
  }

  return resultDraft;
}


export async function deleteGuestDraftFromStorage(): Promise<void> {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (e) {
    reportError(e, { action: 'deleteGuestDraft_ls' }, 'warning');
  }
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      await db.delete('drafts', GUEST_IDB_KEY);
    }
  } catch (e) {
    reportError(e, { action: 'deleteGuestDraft_idb' }, 'warning');
  }
}
