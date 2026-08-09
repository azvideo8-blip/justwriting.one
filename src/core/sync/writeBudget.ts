// Client-side burst guard on cloud writes from the bulk paths — the embedding
// background sync (AIEmbeddingService.save/syncPendingToCloud), the encryption
// migration, and "sync everything" in CloudSyncService.
//
// Written against the Firestore free-tier daily write quota, which is gone with
// the move to self-hosted Postgres. What it prevents is not gone: a re-index or
// one "sync to cloud" click firing hundreds of writes at once. On Firestore that
// starved the user's own note saves for the rest of the day (2026-07-05
// incident). On our own server it is load rather than billing — smaller, but
// still what makes the app unresponsive exactly while it does bulk work.
//
// The cap counts documents and was sized for THIS path: an embedding at 4096
// dimensions is hundreds of KB, so a few dozen of them are not a typical few
// dozen writes.
//
// Moved out of core/firebase/ because it never had anything to do with Firebase
// beyond the quota it was once sized against.
const DAILY_CAP = 25;
const STORAGE_KEY = 'embed_cloud_write_budget';

interface BudgetState {
  date: string;
  count: number;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readState(): BudgetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as BudgetState;
    if (parsed.date !== todayKey()) return { date: todayKey(), count: 0 };
    return parsed;
  } catch {
    return { date: todayKey(), count: 0 };
  }
}

/** Reserve one Firestore write from today's embedding-sync budget. Returns
 *  false (reserving nothing) once today's cap is spent — callers must skip
 *  the cloud write and leave the record local-only for a later day. */
export function tryReserveWriteBudget(): boolean {
  const state = readState();
  if (state.count + 1 > DAILY_CAP) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: state.date, count: state.count + 1 }));
  } catch {
    // localStorage unavailable (private mode, quota) — fail open rather than
    // silently blocking every embedding sync for the rest of the session.
  }
  return true;
}

export function getWriteBudgetStatus(): { used: number; cap: number } {
  const state = readState();
  return { used: state.count, cap: DAILY_CAP };
}

const DAILY_CAP_SUMMARIZE = 100;
const STORAGE_KEY_SUMMARIZE = 'summary_cloud_write_budget';

function readStateSummarize(): BudgetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SUMMARIZE);
    if (!raw) return { date: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as BudgetState;
    if (parsed.date !== todayKey()) return { date: todayKey(), count: 0 };
    return parsed;
  } catch {
    return { date: todayKey(), count: 0 };
  }
}

export function tryReserveSummarizeBudget(): boolean {
  const state = readStateSummarize();
  if (state.count + 1 > DAILY_CAP_SUMMARIZE) return false;
  try {
    localStorage.setItem(STORAGE_KEY_SUMMARIZE, JSON.stringify({ date: state.date, count: state.count + 1 }));
  } catch {
    // fail open
  }
  return true;
}

export function getSummarizeBudgetStatus(): { used: number; cap: number } {
  const state = readStateSummarize();
  return { used: state.count, cap: DAILY_CAP_SUMMARIZE };
}

const DAILY_CAP_BULK = 500;
const STORAGE_KEY_BULK = 'bulk_cloud_write_budget';

function readStateBulk(): BudgetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BULK);
    if (!raw) return { date: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as BudgetState;
    if (parsed.date !== todayKey()) return { date: todayKey(), count: 0 };
    return parsed;
  } catch {
    return { date: todayKey(), count: 0 };
  }
}

export function tryReserveBulkWriteBudget(): boolean {
  const state = readStateBulk();
  if (state.count + 1 > DAILY_CAP_BULK) return false;
  try {
    localStorage.setItem(STORAGE_KEY_BULK, JSON.stringify({ date: state.date, count: state.count + 1 }));
  } catch {
    // fail open
  }
  return true;
}

export function getBulkWriteBudgetStatus(): { used: number; cap: number } {
  const state = readStateBulk();
  return { used: state.count, cap: DAILY_CAP_BULK };
}

// Firestore answers resource-exhausted (project daily write quota) and
// permission-denied (a rule that rejects this record shape) identically for
// every document in a bulk loop — they are properties of the project or the
// schema, not of the row being written. Continuing the loop after one burns
// quota on writes that cannot succeed, and since nothing gets marked synced the
// next pass repeats the whole list. The free-tier database cannot exceed its
// quota even with billing enabled, so the only lever is not spending it.
const STORAGE_KEY_BLOCKED = 'firestore_cloud_writes_blocked';

export function isGlobalWriteFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    const c = code.replace(/^firestore\//, '');
    if (c === 'resource-exhausted' || c === 'permission-denied') return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /resource-exhausted|Quota limit exceeded|Missing or insufficient permissions/i.test(msg);
}

/** Stop all background cloud writes for the rest of today (Pacific quota day). */
export function blockCloudWritesToday(): void {
  try { localStorage.setItem(STORAGE_KEY_BLOCKED, todayKey()); } catch { /* fail open */ }
}

export function areCloudWritesBlockedToday(): boolean {
  try { return localStorage.getItem(STORAGE_KEY_BLOCKED) === todayKey(); } catch { return false; }
}
