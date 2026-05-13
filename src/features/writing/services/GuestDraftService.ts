import { getLocalDb } from '../../../shared/lib/localDb';

const DRAFT_KEY = 'jw_guest_draft';

export interface GuestDraftData {
  content?: string;
  title?: string;
  pinnedThoughts?: string[];
  seconds?: number;
  wordCount?: number;
  timestamp?: number;
}

export async function saveGuestDraftToStorage(draft: GuestDraftData): Promise<void> {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      await db.put('drafts', { ...draft, userId: 'guest_draft' } as import('../../../shared/lib/localDb').LocalDraft);
    }
  } catch { /* ignore */ }
}

export async function loadGuestDraftFromStorage(): Promise<GuestDraftData | null> {
  const raw = localStorage.getItem(DRAFT_KEY);
  let draft: GuestDraftData | null = null;

  if (raw) {
    try {
      draft = JSON.parse(raw);
    } catch (err) {
      console.warn('[GuestDraft] Corrupted localStorage draft, removing:', err);
      localStorage.removeItem(DRAFT_KEY);
    }
  }

  if (!draft) {
    try {
      const db = await getLocalDb();
      if (db.objectStoreNames.contains('drafts')) {
        const d = await db.get('drafts', 'guest_draft');
        if (d) draft = d as GuestDraftData;
      }
    } catch { /* ignore */ }
  }

  return draft;
}

export async function deleteGuestDraftFromStorage(): Promise<void> {
  localStorage.removeItem(DRAFT_KEY);
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      await db.delete('drafts', 'guest_draft');
    }
  } catch { /* ignore */ }
}
