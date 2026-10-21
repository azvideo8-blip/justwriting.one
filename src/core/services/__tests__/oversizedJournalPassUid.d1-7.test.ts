import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * П-4 (D1-7): журнал «слишком большое» писался по `getCurrentUser()`, а читатель
 * прохода — по uid прохода. Смена аккаунта посреди дренажа оставляла проход без
 * пометки, и забор решал спор в пользу облака (`AIRestoreService`).
 */

const USER_A = 'u_d1_7_a';
const USER_B = 'u_d1_7_b';
const auth = vi.hoisted(() => ({ current: 'u_d1_7_a' }));

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: auth.current }),
  getCurrentUserId: () => auth.current,
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', async (orig) => ({
  ...(await orig<object>()),
  maybeEncrypt: async (x: unknown) => x,
  getEncryptionEnabled: () => false,
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { LocalStoreSyncManager, getLocalStoreSyncSummary, MAX_LOCAL_RECORD_BYTES } from '../LocalStoreSyncService';
import { DataProvider } from '../../data';
import { getLocalDb } from '../../storage/localDb';

const J = 'ai_sync_oversized_records';

beforeEach(async () => {
  auth.current = USER_A;
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(DataProvider, 'getLocalStoreRecord').mockImplementation(async () => {
    // Смена аккаунта ровно посреди прохода: заголовок прохода уже взят (A).
    auth.current = USER_B;
    return null as never;
  });
  vi.spyOn(DataProvider as Required<typeof DataProvider>, 'getLocalStoreRecordPages').mockResolvedValue([]);
  vi.spyOn(DataProvider, 'deleteLocalStoreRecordsByKeys').mockResolvedValue(undefined as never);
  vi.spyOn(DataProvider, 'getLocalStoreRecordsByKeyPrefix').mockResolvedValue([]);

  const db = await getLocalDb(USER_A);
  await db.clear('aiDialogues');
  await db.put('aiDialogues', {
    id: 'huge_d1_7',
    title: 'Huge',
    messages: [{ role: 'user', content: 'x'.repeat(MAX_LOCAL_RECORD_BYTES + 1024) }],
    createdAt: 1,
    updatedAt: 1,
    personaId: 'default',
    personaName: 'Assistant',
    personaEmoji: '🤖',
  } as never);
});

describe('П-4: журнал «слишком большое» — по uid прохода', () => {
  it('смена аккаунта посреди дренажа не уводит пометку в чужой журнал', async () => {
    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiDialogues', 'huge_d1_7');

    const res = await tab.flushPending(true);

    expect(res.skippedOversized, 'запись отвергнута по размеру').toBe(1);
    expect(localStorage.getItem(`${J}:${USER_A}`), 'пометка в журнале прохода').not.toBeNull();
    expect(localStorage.getItem(`${J}:${USER_B}`), 'в чужом журнале пометки нет').toBeNull();
    expect(getLocalStoreSyncSummary(USER_A).oversized).toBe(1);
  });
});
