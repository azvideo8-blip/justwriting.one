import { format } from 'date-fns';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';
import { getCurrentUser } from '../auth';
import { DataProvider } from '../data';
import { reportError } from '../../shared/errors/reportError';
import { cloudSyncEnabled } from '../sync/cloudSyncEnabled';
import { maybeEncrypt, maybeDecrypt } from '../crypto/cryptoHelpers';

// One row per user in local_store_records, in the SAME envelope every other
// store record uses ({ data: json, updatedAt } → maybeEncrypt on 'data'). A bare
// { dates: [...] } would be counted as a plaintext row by the postulate census
// for a vault user, and the vault migration would encrypt it into a shape this
// file could not read back — then overwrite it in plaintext again.
const STORE = 'streak_freezes';
const KEY = 'dates';

async function readCloudDates(userId: string): Promise<string[] | null> {
  const record = await DataProvider.getLocalStoreRecord(userId, STORE, KEY);
  if (!record?.payload) return [];
  const dec = await maybeDecrypt(record.payload as Record<string, unknown>, ['data'], []);
  const parsed: unknown = typeof dec.data === 'string' ? JSON.parse(dec.data) : null;
  return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : [];
}

async function writeCloudDates(userId: string, dates: Set<string>): Promise<void> {
  const payload = await maybeEncrypt({ data: JSON.stringify([...dates]), updatedAt: Date.now() }, ['data'], [], userId);
  await DataProvider.saveLocalStoreRecord(userId, STORE, KEY, payload);
}

function resolveKey(userId?: string | null): string {
  const uid = userId !== undefined ? userId : getCurrentUser()?.uid;
  return STORAGE_KEYS.STREAK_FREEZES(uid);
}

function resolveUid(userId?: string | null): string | null {
  return userId !== undefined ? userId : (getCurrentUser()?.uid ?? null);
}

export function getFrozenDates(userId?: string | null): Set<string> {
  try {
    const key = resolveKey(userId);
    let raw = localStorage.getItem(key);
    // Before S-19 the key was not per-user. Adopt the old entry once for the
    // first account that reads, so an existing freeze this month is not lost.
    if (raw === null && key !== STORAGE_KEYS.GUEST_STREAK_FREEZES) {
      const legacy = localStorage.getItem(STORAGE_KEYS.GUEST_STREAK_FREEZES);
      if (legacy !== null) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(STORAGE_KEYS.GUEST_STREAK_FREEZES);
        raw = legacy;
      }
    }
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function saveFrozenDates(dates: Set<string>, userId?: string | null): void {
  try {
    const key = resolveKey(userId);
    localStorage.setItem(key, JSON.stringify([...dates]));
    const uid = resolveUid(userId);
    if (uid && !uid.startsWith('guest') && cloudSyncEnabled()) {
      // A locked vault throws ENCRYPT_REQUIRED here; the local copy is already
      // written and the next syncStreakFreezesWithCloud pushes it.
      void writeCloudDates(uid, dates).catch(err => {
        reportError(err, { action: 'saveFrozenDates_cloud', userId: uid });
      });
    }
  } catch {
    // ignore
  }
}

export function clearFrozenDates(userId?: string | null): void {
  try {
    localStorage.removeItem(resolveKey(userId));
  } catch {
    // ignore
  }
}

export function wasFreezeUsedThisMonth(userId?: string | null): boolean {
  const month = format(new Date(), 'yyyy-MM');
  for (const d of getFrozenDates(userId)) {
    if (d.startsWith(month)) return true;
  }
  return false;
}

/**
 * S-19: Synchronizes streak freeze dates with cloud (local_store_records).
 * Merges local and remote sets (union) so that freezes consumed on device A
 * propagate to device B, preventing broken streaks and duplicate monthly freezes.
 */
export async function syncStreakFreezesWithCloud(userId: string, force = false): Promise<Set<string>> {
  if (!userId || (!force && !cloudSyncEnabled())) return getFrozenDates(userId);
  try {
    const cloudDates = (await readCloudDates(userId)) ?? [];
    const localDates = getFrozenDates(userId);
    const merged = new Set([...localDates, ...cloudDates]);

    if (merged.size > localDates.size) {
      try {
        localStorage.setItem(STORAGE_KEYS.STREAK_FREEZES(userId), JSON.stringify([...merged]));
      } catch {
        // ignore
      }
    }

    if (merged.size > cloudDates.length) {
      await writeCloudDates(userId, merged);
    }

    return merged;
  } catch (err) {
    reportError(err, { action: 'syncStreakFreezesWithCloud', userId });
    return getFrozenDates(userId);
  }
}

