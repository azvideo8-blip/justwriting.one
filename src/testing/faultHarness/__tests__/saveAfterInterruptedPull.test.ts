import { afterEach, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { StorageService } from '../../../core/services/StorageService';
import { SyncService } from '../../../core/services/SyncService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { getLocalDb, resetDbInstance } from '../../../core/storage/localDb';
import { clearSessionKey, getSessionKey, setSessionKey } from '../../../core/crypto/encrypt';

const runner = new LifecycleRunner();
const data = (content: string) => ({ title: 'Synthetic interrupted upload', content, wordCount: 1, duration: 1, wpm: 1, tags: [], sessionStartedAt: new Date(1000) });

afterEach(() => { runner.interceptor.onBeforeRequest = undefined; runner.teardown(); resetDbInstance(); forgetDevice(); });

it('a save after a failed pull-before-push stays the latest text even with a smaller UUID', async () => {
  const a = new Device('A'), b = new Device('B');
  activateDevice(a);
  runner.vaultEnabled = true;
  await runner.setup();
  const uid = runner.userId;
  const key = getSessionKey()!;
  let counter = 100;
  const uuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`);
  const { localId } = await StorageService.saveNew(uid, data('base'));
  await SyncService.syncOne(uid, localId);
  activateDevice(b);
  localStorage.setItem('auto_sync_enabled', 'true');
  await SyncService.pullNotes(uid);
  const bId = (await (await getLocalDb(uid)).getAll('documents'))[0]!.id;
  activateDevice(a);
  await StorageService.saveVersion(uid, localId, data('base'));
  await StorageService.saveVersion(uid, localId, data('base'));
  activateDevice(b);
  runner.interceptor.setStep('sync_cloud');
  let failedWrite = false;
  runner.interceptor.onBeforeRequest = (table, op) => {
    runner.interceptor.clearArmedFault();
    if (table === 'versions' && op === 'upsert' && !failedWrite) {
      failedWrite = true;
      runner.interceptor.armFault('postgres_500', 'sync_cloud');
    }
  };
  await StorageService.saveVersion(uid, bId, data('first local edit'));
  expect(failedWrite).toBe(true);
  runner.interceptor.onBeforeRequest = undefined;
  runner.interceptor.clearArmedFault();
  const db = await getLocalDb(uid);
  expect((await db.getAllFromIndex('versions', 'by-document', bId)).map(v => v.version).sort()).toEqual([1, 2, 3]);
  expect((await db.get('documents', bId))?.currentVersion).toBe(2);

  clearSessionKey();
  uuid.mockReturnValueOnce('00000000-0000-4000-8000-000000000001');
  await StorageService.saveVersion(uid, bId, data('latest local edit'));
  expect(await LocalVersionService.getLatestContent(bId, uid), 'The editor must not reopen the older cloud text').toBe('latest local edit');
  const versions = await db.getAllFromIndex('versions', 'by-document', bId);
  expect(new Set(versions.map(v => v.version)).size).toBe(versions.length);
  setSessionKey(key);
  await SyncService.reviveLockedTasks(uid);
  await SyncService.syncPending(uid, { force: true });
});
