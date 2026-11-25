// F-1: запертый сейф — ожидаемое состояние, а не поток ошибок. Задачи ждут
// ключа без попыток и карантина, журнал не краснеет, после открытия уходят сами.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';
import { generateDataKey, setSessionKey, clearSessionKey } from '../../crypto/encrypt';
import { setEncryptionEnabled } from '../../crypto/cryptoHelpers';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { reportError } from '../../../shared/errors/reportError';

vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));

const USER = 'user_vault_locked';

async function seedDoc(id: string) {
  const db = await getLocalDb(USER);
  await db.put('documents', {
    id, guestId: USER, title: 'n', currentVersion: 1, totalWords: 1,
    totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
    tags: [], linkedCloudId: '',
  } as never);
}

async function queueTask(documentId: string, type: 'document' | 'delete' = 'document') {
  const db = await getLocalDb(USER);
  await db.put('syncQueue', {
    id: `sync_${type}_${documentId}`,
    documentId,
    type,
    createdAt: Date.now(),
    ownerId: USER,
    revocable: true,
  });
}

async function task(id: string) {
  return (await getLocalDb(USER)).get('syncQueue', id);
}

beforeEach(async () => {
  const db = await getLocalDb(USER);
  await db.clear('documents');
  await db.clear('syncQueue');
  vi.restoreAllMocks();
  useActivityLogStore.getState().clearLog();
  clearSessionKey();
  setEncryptionEnabled(USER, true);
  vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue(undefined as never);
});

describe('F-1: locked vault pauses sync instead of failing it', () => {
  it('doc tasks wait untouched, deletes still go, and everything drains after unlock', async () => {
    await seedDoc('d1');
    await queueTask('d1');
    await queueTask('gone', 'delete');
    const upload = vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_d1');
    const remove = vi.spyOn(CloudSyncService, 'removeCloudCopy').mockResolvedValue(undefined as never);

    for (let i = 0; i < 12; i++) await SyncService.syncPending(USER);

    expect(upload).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
    const t = await task('sync_document_d1');
    expect(t?.dead ?? false).toBe(false);
    expect(t?.attempts ?? 0).toBe(0);
    expect(await task('sync_delete_gone')).toBeUndefined();
    expect(await SyncService.getPendingCount(USER)).toBe(1);
    expect(await SyncService.getDeadCount(USER)).toBe(0);

    setSessionKey(await generateDataKey());
    const res = await SyncService.syncPending(USER);
    expect(res.drained).toBe(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await task('sync_document_d1')).toBeUndefined();
  });

  it('vault locking mid-drain does not count an attempt or quarantine (ENCRYPT_REQUIRED)', async () => {
    await seedDoc('d2');
    await queueTask('d2');
    setSessionKey(await generateDataKey());
    // Ключ пропал уже после того, как дренаж решил выгружать.
    vi.spyOn(StorageService, 'addCloudCopy').mockImplementation(async () => {
      clearSessionKey();
      throw new Error('ENCRYPT_REQUIRED: session key not available');
    });

    for (let i = 0; i < 12; i++) {
      setSessionKey(await generateDataKey());
      await SyncService.syncPending(USER);
    }

    const t = await task('sync_document_d2');
    expect(t?.dead ?? false).toBe(false);
    expect(t?.attempts ?? 0).toBe(0);
    expect(t?.lastError).toContain('ENCRYPT_REQUIRED');
    expect(await SyncService.getPendingCount(USER)).toBe(1);
  });

  it('writes nothing above info to the journal while the vault is locked', async () => {
    await seedDoc('d3');
    await queueTask('d3');
    setSessionKey(await generateDataKey());
    vi.spyOn(StorageService, 'addCloudCopy').mockImplementation(async () => {
      clearSessionKey();
      throw new Error('ENCRYPT_REQUIRED: session key not available');
    });
    await SyncService.syncPending(USER);
    clearSessionKey();
    await SyncService.syncPending(USER);

    const loud = useActivityLogStore.getState().entries.filter(e => e.level === 'error' || e.level === 'warning');
    expect(loud.map(e => `${e.level}: ${e.message} ${JSON.stringify(e.context)}`)).toEqual([]);
  });
});

describe('F-1: reportError demotes locked-vault failures to info', () => {
  it.each([
    ['Sync failed', { reason: 'Error: ENCRYPT_REQUIRED: session key not available' }],
    ['LOCKED: cannot add local copy of locked document', {}],
    ['Vault is locked', {}],
  ])('%s → info', (msg, ctx) => {
    reportError(new Error(msg), ctx);
    expect(useActivityLogStore.getState().entries[0]?.level).toBe('info');
  });

  it('other failures keep their level', () => {
    reportError(new Error('Sync failed'), { reason: 'LOCK_HELD: another tab' });
    reportError(new Error('DECRYPTION_ERROR: bad bytes'));
    expect(useActivityLogStore.getState().entries.map(e => e.level)).toEqual(['error', 'error']);
  });
});
