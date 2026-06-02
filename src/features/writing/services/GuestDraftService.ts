import { getLocalDb, LocalDraft } from '../../../core/storage/localDb';
import { reportError } from '../../../core/errors/reportError';
import { STORAGE_KEYS } from '../../../core/constants/storageKeys';

const DRAFT_KEY = STORAGE_KEYS.GUEST_DRAFT;
const GUEST_IDB_KEY = 'guest_draft';

export interface GuestDraftData {
  content?: string;
  title?: string;
  pinnedThoughts?: string[];
  seconds?: number;
  wordCount?: number;
  timestamp?: number;
  updatedAt?: number;
}

export async function saveGuestDraftToStorage(draft: GuestDraftData): Promise<void> {
  const withMeta = { ...draft, updatedAt: Date.now() };
  let idbOk = false;
  let lsOk = false;

  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      await db.put('drafts', { ...withMeta, userId: GUEST_IDB_KEY } as LocalDraft);
      idbOk = true;
    }
  } catch (e) {
    reportError(e, { action: 'saveGuestDraft_idb' }, 'warning');
  }

  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(withMeta));
    lsOk = true;
  } catch (e) {
    reportError(e, { action: 'saveGuestDraft_ls' }, 'warning');
  }

  if (!idbOk && !lsOk) {
    throw new Error('GUEST_DRAFT_SAVE_FAILED: both IDB and localStorage failed');
  }
}

export async function loadGuestDraftFromStorage(): Promise<GuestDraftData | null> {
  let idbDraft: GuestDraftData | null = null;
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      const d = await db.get('drafts', GUEST_IDB_KEY);
      if (d) idbDraft = d as GuestDraftData;
    }
  } catch (e) {
    reportError(e, { action: 'loadGuestDraft_idb' }, 'warning');
  }

  let lsDraft: GuestDraftData | null = null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      lsDraft = JSON.parse(raw);
    }
  } catch (e) {
    reportError(e, { action: 'loadGuestDraft_ls_read' }, 'warning');
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch { /* ignore cleanup */ }
  }

  if (idbDraft && lsDraft) {
    const idbTs = idbDraft.updatedAt ?? idbDraft.timestamp ?? 0;
    const lsTs = lsDraft.updatedAt ?? lsDraft.timestamp ?? 0;
    const winner = idbTs >= lsTs ? idbDraft : lsDraft;
    if (winner === lsDraft) {
      try {
        const db = await getLocalDb();
        await db.put('drafts', { ...lsDraft, userId: GUEST_IDB_KEY } as LocalDraft);
      } catch (e) {
        reportError(e, { action: 'loadGuestDraft_ls_sync' }, 'warning');
      }
    }
    return winner;
  }

  if (lsDraft && !idbDraft) {
    try {
      const db = await getLocalDb();
      if (db.objectStoreNames.contains('drafts')) {
        await db.put('drafts', { ...lsDraft, userId: GUEST_IDB_KEY } as LocalDraft);
      }
    } catch (e) {
      reportError(e, { action: 'loadGuestDraft_ls_restore' }, 'warning');
    }
    return lsDraft;
  }

  return idbDraft;
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
