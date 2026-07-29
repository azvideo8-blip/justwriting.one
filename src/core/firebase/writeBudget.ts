// Client-side daily cap on Firestore writes from the embedding background-sync
// path (AIEmbeddingService.save/syncPendingToCloud). This project's Firestore
// runs on a free-tier sandbox database with a hard daily write-operation quota
// shared by the WHOLE app (notes, versions, embeddings — everything). A single
// note write is small and unavoidable; the real risk is THIS path — re-syncing
// embeddings after an embedding-model/dimension change (which marks every
// existing embedding stale) or a manual "reindex all" / "sync to cloud" click —
// bursting hundreds of writes in one go and starving the user's own note saves
// for the rest of the day. See docs/optimisation 05.07.2026 for the incident
// this guards against (2026-07-05 Firestore free-tier write quota exhaustion).
//
// 2026-07-29: 300 was far too high. The quota is denominated in write UNITS,
// which scale with document size, and an embedding at 4096 dimensions is
// hundreds of KB — roughly fifty of them consume the entire 40k daily
// allowance on their own. The cap counts documents, so it has to be set for
// the size of THIS document, not for a typical one.
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
