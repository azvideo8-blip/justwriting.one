import { getLocalDb, LocalDraft } from '../../../shared/lib/localDb';

const DRAFT_KEY = 'jw_guest_draft';
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
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      await db.put('drafts', { ...withMeta, userId: GUEST_IDB_KEY } as LocalDraft);
    }
  } catch { /* ignore */ }
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(withMeta)); } catch { /* ignore */ }
}

export async function loadGuestDraftFromStorage(): Promise<GuestDraftData | null> {
  let idbDraft: GuestDraftData | null = null;
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      const d = await db.get('drafts', GUEST_IDB_KEY);
      if (d) idbDraft = d as GuestDraftData;
    }
  } catch { /* ignore */ }

  let lsDraft: GuestDraftData | null = null;
  const raw = localStorage.getItem(DRAFT_KEY);
  if (raw) {
    try { lsDraft = JSON.parse(raw); } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }

  if (idbDraft && lsDraft) {
    const idbTs = idbDraft.updatedAt ?? idbDraft.timestamp ?? 0;
    const lsTs = lsDraft.updatedAt ?? lsDraft.timestamp ?? 0;
    const winner = idbTs >= lsTs ? idbDraft : lsDraft;
    if (winner === lsDraft && idbDraft) {
      try {
        const db = await getLocalDb();
        await db.put('drafts', { ...lsDraft, userId: GUEST_IDB_KEY } as LocalDraft);
      } catch { /* ignore */ }
    }
    return winner;
  }

  if (lsDraft && !idbDraft) {
    try {
      const db = await getLocalDb();
      if (db.objectStoreNames.contains('drafts')) {
        await db.put('drafts', { ...lsDraft, userId: GUEST_IDB_KEY } as LocalDraft);
      }
    } catch { /* ignore */ }
    return lsDraft;
  }

  return idbDraft;
}

export async function deleteGuestDraftFromStorage(): Promise<void> {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      await db.delete('drafts', GUEST_IDB_KEY);
    }
  } catch { /* ignore */ }
}
