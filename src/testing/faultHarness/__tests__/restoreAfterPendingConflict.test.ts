import { afterEach, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { StorageService } from '../../../core/services/StorageService';
import { SyncService } from '../../../core/services/SyncService';
import { getLocalDb, resetDbInstance } from '../../../core/storage/localDb';

const runner = new LifecycleRunner();
const data = (content: string) => ({ title: 'Synthetic restored note', content, wordCount: 1, duration: 1, wpm: 1, tags: [], sessionStartedAt: new Date(1000) });
afterEach(() => { runner.teardown(); resetDbInstance(); forgetDevice(); });

it('a remote restoration survives pending reconciliation followed by a conflict fork', async () => {
  const a = new Device('A'), b = new Device('B');
  activateDevice(a);
  runner.vaultEnabled = true;
  await runner.setup();
  const uid = runner.userId;
  let serverTime = Date.now();
  runner.interceptor.postgres.serverNow = () => { serverTime += 1000; return serverTime; };
  const { localId } = await StorageService.saveNew(uid, data('base'));
  await SyncService.syncOne(uid, localId);
  const uuid = (await (await getLocalDb(uid)).get('documents', localId))!.uuid!;
  activateDevice(b);
  localStorage.setItem('auto_sync_enabled', 'true');
  await SyncService.pullNotes(uid);
  const bId = (await (await getLocalDb(uid)).getAll('documents'))[0]!.id;
  activateDevice(a);
  await SyncService.addToQueue(localId, uid);
  await StorageService.trashDocument(uid, localId, uuid);
  activateDevice(b);
  await StorageService.saveVersion(uid, bId, data('remote second'));
  await StorageService.saveVersion(uid, bId, data('remote third'));
  expect(runner.interceptor.postgres.getRows('documents').find(d => d.uuid === uuid)?.trashed_at).toBeNull();
  activateDevice(a);
  await SyncService.pullNotes(uid);
  await SyncService.syncPending(uid, { force: true });
  for (let i = 0; i < 3; i++) await SyncService.pullNotes(uid);
  const db = await getLocalDb(uid);
  const original = await db.get('documents', localId);
  expect((await db.getAll('documents')).length, 'The conflict-copy path must actually run').toBeGreaterThan(1);
  expect(original?.trashedAt ?? null, 'The original must follow the remote restoration').toBeNull();
});

// Обратный случай (сиды хаоса 109/187/272): корзина, сделанная здесь без сети,
// ещё не дослана — конфликт версий не вправе её сбросить по облаку.
it('a trash made offline survives a conflict fork and reaches the cloud', async () => {
  const a = new Device('A'), b = new Device('B');
  const online = (on: boolean) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
    if (on) { runner.interceptor.clearArmedFault(); runner.interceptor.setStep('initial_write'); }
    else { runner.interceptor.setStep('device_b_edit'); runner.interceptor.armFault('network_pre', 'device_b_edit'); }
  };
  activateDevice(a);
  runner.vaultEnabled = true;
  await runner.setup();
  const uid = runner.userId;
  let serverTime = Date.now();
  runner.interceptor.postgres.serverNow = () => { serverTime += 1000; return serverTime; };
  const { localId } = await StorageService.saveNew(uid, data('base'));
  await SyncService.syncOne(uid, localId);
  const uuid = (await (await getLocalDb(uid)).get('documents', localId))!.uuid!;
  activateDevice(b);
  localStorage.setItem('auto_sync_enabled', 'true');
  await SyncService.pullNotes(uid);
  const bId = (await (await getLocalDb(uid)).getAll('documents'))[0]!.id;
  await StorageService.saveVersion(uid, bId, data('remote second'));
  activateDevice(a);
  online(false);
  try { await StorageService.saveVersion(uid, localId, data('local offline edit')); } catch { /* записано локально */ }
  await StorageService.trashDocument(uid, localId, uuid);
  expect((await (await getLocalDb(uid)).get('documents', localId))?.metadataDirtyFields).toContain('trashedAt');
  online(true);
  await SyncService.syncPending(uid, { force: true });
  const db = await getLocalDb(uid);
  expect((await db.getAll('documents')).length, 'The conflict-copy path must actually run').toBeGreaterThan(1);
  // Сразу после выгрузки, до заборов: в хаосе метка «увиденного» совпала с
  // облачной, и забор этого уже не исправлял.
  expect((await db.get('documents', localId))?.trashedAt ?? null, 'The offline trash stays here').not.toBeNull();
  for (let i = 0; i < 3; i++) await SyncService.pullNotes(uid);
  expect((await db.get('documents', localId))?.trashedAt ?? null).not.toBeNull();
  expect(runner.interceptor.postgres.getRows('documents').find(d => d.uuid === uuid)?.trashed_at ?? null, 'and reaches the cloud').not.toBeNull();
});
