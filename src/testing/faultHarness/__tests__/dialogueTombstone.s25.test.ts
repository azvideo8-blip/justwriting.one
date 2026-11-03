import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { getLocalDb, type AIDialogue } from '../../../core/storage/localDb';
import { LocalStoreSyncManager, _resetReportedForTests } from '../../../core/services/LocalStoreSyncService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';
import { resetSyncFlagsForTests } from '../../../core/sync/syncFlags';

/**
 * S2-5 (б, владелец 02.11): удаление диалога оставляет в облаке надгробие (0047).
 * Прежде строку стирали физически, и копия, пережившая срок S-58 (90 дней) на
 * другом устройстве, при первой правке вставлялась заново — диалог воскресал везде.
 *
 * Мутации: без надгробия в `flushPending` → «B не воскрешает» красный;
 * без `lostInsert` в `uploadDialogue` → B бросает S-34 и держит копию.
 */
describe('S2-5: надгробие удалённого диалога', () => {
  const runner = new LifecycleRunner();
  const managers = new Map<Device, LocalStoreSyncManager>();
  const managerOf = (dev: Device) => {
    if (!managers.has(dev)) managers.set(dev, new LocalStoreSyncManager());
    return managers.get(dev)!;
  };
  beforeEach(() => { resetSyncFlagsForTests(); _resetReportedForTests(); });
  afterEach(() => { runner.teardown(); managers.clear(); forgetDevice(); });

  const dialogue = (text: string, at: number): AIDialogue => ({
    id: 'd1', title: 't', personaId: 'p', personaName: 'P', personaEmoji: '🙂',
    messages: [{ role: 'user', content: text, id: `m-${at}` } as AIDialogue['messages'][number]],
    createdAt: 1000, updatedAt: at,
  });
  const cloudRows = () => runner.interceptor.postgres.getRows('local_store_records').filter(r => r.store === 'aiDialogues');

  async function setup(flag: boolean): Promise<{ A: Device; B: Device; uid: string }> {
    const A = new Device('A'), B = new Device('B');
    activateDevice(A);
    await runner.setup();
    const uid = runner.userId;
    for (const dev of [A, B]) dev.storage.set('auto_sync_enabled', 'true');
    runner.interceptor.featureFlagOverrides.set('sync_push_rpc', flag);

    await (await getLocalDb(uid)).put('aiDialogues', dialogue('жил', 2000));
    managerOf(A).scheduleStoreSync('aiDialogues', 'd1');
    await managerOf(A).flushPending();
    activateDevice(B);
    await restoreAIDataFromCloud(uid, { sinceMs: 0 });
    expect(await (await getLocalDb(uid)).get('aiDialogues', 'd1'), 'B получила диалог').toBeTruthy();

    // A снимает диалог (срок S-58 вышел / пустой диалог).
    activateDevice(A);
    await (await getLocalDb(uid)).delete('aiDialogues', 'd1');
    managerOf(A).scheduleStoreDelete('aiDialogues', 'd1');
    await managerOf(A).flushPending();
    return { A, B, uid };
  }

  it('B, дописав свою копию, не воскрешает диалог: копия снимается, в облаке надгробие', async () => {
    const { B, uid } = await setup(true);
    expect(cloudRows().map(r => [r.key, r.deleted]), 'надгробие, а не пустое место').toEqual([['d1', true]]);

    activateDevice(B);
    const db = await getLocalDb(uid);
    await db.put('aiDialogues', dialogue('дописала', 3000));
    managerOf(B).scheduleStoreSync('aiDialogues', 'd1');
    const res = await managerOf(B).flushPending();

    expect(res.failed).toBe(0);
    expect(await db.get('aiDialogues', 'd1'), 'копия B снята').toBeUndefined();
    expect(cloudRows().map(r => [r.key, r.deleted]), 'B не воскрешает').toEqual([['d1', true]]);
  });

  it('флаг выключен — прежнее физическое удаление', async () => {
    await setup(false);
    expect(cloudRows()).toEqual([]);
  });

  it('сервер без 0047 — физическое удаление, без ошибки', async () => {
    const A = new Device('A');
    activateDevice(A);
    await runner.setup();
    const uid = runner.userId;
    A.storage.set('auto_sync_enabled', 'true');
    runner.interceptor.featureFlagOverrides.set('sync_push_rpc', true);
    runner.interceptor.postgres.withSyncPush = false;
    await (await getLocalDb(uid)).put('aiDialogues', dialogue('жил', 2000));
    managerOf(A).scheduleStoreSync('aiDialogues', 'd1');
    await managerOf(A).flushPending();
    await (await getLocalDb(uid)).delete('aiDialogues', 'd1');
    managerOf(A).scheduleStoreDelete('aiDialogues', 'd1');
    const res = await managerOf(A).flushPending();
    expect(res.failed).toBe(0);
    expect(cloudRows()).toEqual([]);
  });
});
