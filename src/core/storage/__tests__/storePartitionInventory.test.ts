import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { getLocalDb, LEGACY_WIPE_STORES } from '../localDb';
import { SUPPORTED_LOCAL_STORES } from '../../services/LocalStoreSyncService';

describe('LEGACY-3: Store partition inventory test', () => {
  const DB_NAME = 'test-store-inventory-db';

  const OWNED = new Set([
    'documents',
    'versions',
    'profile',
    'drafts',
    'pending_sessions',
    'syncQueue',
  ]);

  const WIPED = new Set(LEGACY_WIPE_STORES);

  const LOCAL_ONLY = new Set([
    'aiDomainVectors',
    'aiInjectionJournal',
  ]);

  const OWN_TABLE = new Set([
    'aiSummaries',
    'aiEmbeddings',
  ]);

  const SYNCED = new Set<string>(SUPPORTED_LOCAL_STORES);

  beforeEach(async () => {
    await deleteDB(DB_NAME).catch(() => {});
  });

  it('WIPED is a subset of objectStoreNames (kills typos)', async () => {
    const db = await getLocalDb(DB_NAME);
    const storeNames = new Set(Array.from(db.objectStoreNames));

    for (const store of WIPED) {
      expect(storeNames.has(store), `Store ${store} from WIPED list does not exist in schema`).toBe(true);
    }
  });

  it('objectStoreNames minus OWNED strictly equals WIPED (kills omissions)', async () => {
    const db = await getLocalDb(DB_NAME);
    const storeNames = new Set(Array.from(db.objectStoreNames));

    // Ensure all OWNED stores exist
    for (const store of OWNED) {
      expect(storeNames.has(store as never), `Store ${store} from OWNED list does not exist in schema`).toBe(true);
    }

    const unownedStores = new Set([...storeNames].filter(s => !OWNED.has(s)));
    expect(unownedStores).toEqual(WIPED);

    // OWNED and WIPED must be disjoint
    const overlap = [...OWNED].filter(s => WIPED.has(s as never));
    expect(overlap, 'OWNED and WIPED must be disjoint').toEqual([]);
  });

  it('WIPED equals SYNCED union LOCAL_ONLY union OWN_TABLE and all subsets are disjoint', () => {
    // Check disjointness
    const syncedAndLocalOnly = [...SYNCED].filter(s => LOCAL_ONLY.has(s));
    expect(syncedAndLocalOnly, 'SYNCED and LOCAL_ONLY overlap').toEqual([]);

    const syncedAndOwnTable = [...SYNCED].filter(s => OWN_TABLE.has(s));
    expect(syncedAndOwnTable, 'SYNCED and OWN_TABLE overlap').toEqual([]);

    const localOnlyAndOwnTable = [...LOCAL_ONLY].filter(s => OWN_TABLE.has(s));
    expect(localOnlyAndOwnTable, 'LOCAL_ONLY and OWN_TABLE overlap').toEqual([]);

    // Check union equals WIPED
    const union = new Set([...SYNCED, ...LOCAL_ONLY, ...OWN_TABLE]);
    expect(union).toEqual(WIPED);
  });
});
