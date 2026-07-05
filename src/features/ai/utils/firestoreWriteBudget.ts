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
const DAILY_CAP = 300;
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
