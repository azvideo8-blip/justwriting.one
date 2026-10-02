import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  LocalStoreSyncManager,
  getLocalStoreSyncSummary,
  healCorruptDeleteJournal,
  MAX_LOCAL_RECORD_BYTES,
} from '../LocalStoreSyncService';
import { DataProvider } from '../../data';
import { getLocalDb } from '../../storage/localDb';
import { reportError } from '../../../shared/errors/reportError';

const USER = 'u_l4_journal';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', async (orig) => ({
  ...(await orig<object>()),
  maybeEncrypt: async (x: unknown) => x,
  getEncryptionEnabled: () => false,
}));
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

async function putHugeDialogue(id: string): Promise<void> {
  const db = await getLocalDb();
  await db.put('aiDialogues', {
    id,
    title: 'Huge',
    messages: [{ role: 'user', content: 'x'.repeat(MAX_LOCAL_RECORD_BYTES + 1024) }],
    createdAt: 1,
    updatedAt: 1,
    personaId: 'default',
    personaName: 'Assistant',
    personaEmoji: '🤖',
  });
}

// R5-005: засыпаний нет (flushPending(true) не ждёт таймер) — время уходит на
// холодное открытие fake-indexeddb и пять проходов; под нагрузкой это
// превышало дефолтные 5 с. Поломка журнала краснеет assertion'ом сразу.
describe('R4-004: corrupt journals are not overwritten by writers', { timeout: 30_000 }, () => {
  let save: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    save = vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
  });

  it('corrupt dead-upsert journal: a new dead mark does not overwrite the raw, the upload marker stays', async () => {
    localStorage.setItem('ai_sync_dead_upserts', '{corrupt');
    save.mockRejectedValue(new Error('Failed to fetch'));
    // M-11: без записи в IDB проход снимал маркер раньше, чем доходил до markDeadUpsert.
    const db = await getLocalDb();
    await db.put('aiPortrait', { id: 'p1', portrait: '# x', updatedAt: 1, generatedAtDelta: 0 });

    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiPortrait', 'p1');
    // Пятый отказ — предел попыток: проход доходит до markDeadUpsert.
    for (let i = 0; i < 5; i++) await tab.flushPending(true);

    expect(save).toHaveBeenCalledTimes(5);
    expect(localStorage.getItem('ai_sync_dead_upserts')).toBe('{corrupt');
    // M-11: отметка не записалась — маркер загрузки остаётся, а сводка не говорит «синхронизировано».
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 1, dead: 0, oversized: 0, unknown: true });
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'readDeadUpserts' }),
      'warning',
    );
  });

  it('corrupt oversized journal: a new oversized mark does not overwrite the raw, the upload marker stays', async () => {
    localStorage.setItem(`ai_sync_oversized_records:${USER}`, '{corrupt');
    await putHugeDialogue('huge_dialogue');

    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiDialogues', 'huge_dialogue');
    const res = await tab.flushPending(true);

    expect(res.skippedOversized).toBe(1);
    expect(localStorage.getItem(`ai_sync_oversized_records:${USER}`)).toBe('{corrupt');
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 1, dead: 0, oversized: 0, unknown: true });
  });
});

describe('R4-017: oversized records are visible as not synced', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('an oversized record lands in the summary under its own account key', async () => {
    await putHugeDialogue('huge_dialogue');

    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiDialogues', 'huge_dialogue');
    const res = await tab.flushPending(true);

    expect(res.skippedOversized).toBe(1);
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 0, dead: 0, oversized: 1, unknown: false });
    expect(localStorage.getItem(`ai_sync_oversized_records:${USER}`)).not.toBeNull();
    expect(localStorage.getItem('ai_sync_oversized_records')).toBeNull();
  });
});

describe('R4-019: stale .corrupt backups are deleted with a logged count', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('the heal wipes old backups and names how many', () => {
    localStorage.setItem('ai_sync_pending_deletes.corrupt.111', '[]');
    localStorage.setItem('ai_sync_pending_deletes.corrupt.222', 'garbage');

    healCorruptDeleteJournal('garbage', USER);

    expect(localStorage.getItem('ai_sync_pending_deletes.corrupt.111')).toBeNull();
    expect(localStorage.getItem('ai_sync_pending_deletes.corrupt.222')).toBeNull();
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'healCorruptDeleteJournal_staleBackups', count: 2 }),
      'warning',
    );
  });
});
