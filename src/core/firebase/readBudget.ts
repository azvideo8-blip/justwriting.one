const DAILY_READ_CAP = 15000;
const STORAGE_KEY_READ = 'cloud_read_budget';

interface ReadBudgetState {
  date: string;
  count: number;
  callers: Record<string, number>;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readState(): ReadBudgetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_READ);
    if (!raw) return { date: todayKey(), count: 0, callers: {} };
    const parsed = JSON.parse(raw) as ReadBudgetState;
    if (parsed.date !== todayKey()) return { date: todayKey(), count: 0, callers: {} };
    return parsed;
  } catch {
    return { date: todayKey(), count: 0, callers: {} };
  }
}

/**
 * Thrown instead of returning an empty result when the budget is spent. A read
 * that did not happen must never reach a caller as "there is nothing there":
 * `getUserDocuments()` returning `[]` on a failed read is what marked every
 * linked note "Cloud Copy Lost" beside an Unlink button and cost the owner
 * their whole library's links (fixed in 3b387b25). A spent budget is the same
 * "could not ask", just on a schedule.
 */
export class ReadBudgetExhaustedError extends Error {
  constructor(caller: string) {
    super(`Read budget exhausted (${caller})`);
    this.name = 'ReadBudgetExhaustedError';
  }
}

/** Aborts the read when today's budget is spent. Callers must treat the throw
 *  as "unknown", never as "empty". */
export function assertReadBudget(caller: string): void {
  if (!canSpendReadBudget()) throw new ReadBudgetExhaustedError(caller);
}

/**
 * Checks if the global read budget allows making another request.
 * Call this BEFORE a bulk read. If false, you must abort the read.
 */
export function canSpendReadBudget(): boolean {
  if (areCloudReadsBlockedToday()) return false;
  const state = readState();
  return state.count < DAILY_READ_CAP;
}

/** 
 * Spends the read budget based on the actual documents returned by the query.
 * Call this AFTER a bulk read.
 */
export function spendReadBudget(docsReturned: number, callerName: string): void {
  const state = readState();
  const newCount = state.count + docsReturned;
  const newCallers = { ...state.callers };
  newCallers[callerName] = (newCallers[callerName] || 0) + docsReturned;
  
  try {
    localStorage.setItem(STORAGE_KEY_READ, JSON.stringify({
      date: state.date,
      count: newCount,
      callers: newCallers
    }));
  } catch {
    // fail open
  }
}

export function getReadBudgetStatus(): { used: number; cap: number; callers: Record<string, number> } {
  const state = readState();
  return { used: state.count, cap: DAILY_READ_CAP, callers: state.callers };
}

const STORAGE_KEY_READ_BLOCKED = 'firestore_cloud_reads_blocked';

export function blockCloudReadsToday(): void {
  try { localStorage.setItem(STORAGE_KEY_READ_BLOCKED, todayKey()); } catch { /* fail open */ }
}

export function areCloudReadsBlockedToday(): boolean {
  try { return localStorage.getItem(STORAGE_KEY_READ_BLOCKED) === todayKey(); } catch { return false; }
}
