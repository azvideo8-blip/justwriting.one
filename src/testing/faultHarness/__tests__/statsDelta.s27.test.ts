import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { StorageService } from '../../../core/services/StorageService';
import { SyncService } from '../../../core/services/SyncService';
import { DocumentService } from '../../../core/services/DocumentService';
import { pendingStatsDeltas, isStatsDeltaQueued } from '../../../core/services/pendingDelta';
import { resetSyncFlagsForTests } from '../../../core/sync/syncFlags';

/**
 * S2-7 (I4): прибавка счётчиков с ключом повтора. Ответ потерян после записи
 * (`network_post`) — сервер прибавил, клиент не знает. Повтор уходит с тем же
 * `opId` и не прибавляет второй раз; новая прибавка ложится. До SYNC2 таймаут
 * гасил долг (недосчёт), а любая другая ошибка клала его снова (двойной счёт).
 *
 * Мутации: новый opId на повторе (очередь без журнала) → «network_post» красный
 * (сессий +3); снятие записи журнала до ответа → «network_pre» красный (−1).
 */

describe('S2-7: прибавки счётчиков через sync_push', () => {
  const runner = new LifecycleRunner();
  beforeEach(() => resetSyncFlagsForTests());
  afterEach(() => { runner.teardown(); forgetDevice(); });

  async function cloudNote(uid: string): Promise<string> {
    const { localId } = await StorageService.saveNew(uid, { title: 'Note', content: 'one', wordCount: 1, duration: 5, wpm: 10, tags: [], sessionStartedAt: new Date() });
    await SyncService.addToQueue(localId);
    await SyncService.syncOne(uid, localId);
    const row = runner.interceptor.postgres.getRows('documents').find(d => d.user_id === uid)!;
    return String(row.uuid);
  }

  const counters = (uuid: string) => {
    const r = runner.interceptor.postgres.getRows('documents').find(d => d.uuid === uuid)!;
    return { sessions: Number(r.sessions_count ?? 0), duration: Number(r.total_duration ?? 0) };
  };

  const after = (uid: string, uuid: string, sessionsDelta: number, durationDelta: number) =>
    DocumentService.updateDocumentAfterSession(uid, uuid, { totalWords: 1, durationDelta, currentVersion: 1, sessionsDelta });

  async function setup(): Promise<{ uid: string; uuid: string }> {
    const A = new Device('A');
    activateDevice(A);
    await runner.setup();
    const uid = runner.userId;
    localStorage.setItem('auto_sync_enabled', 'true');
    // Стенд переживает тесты файла: «сервер без 0047» оставлял RPC выключенным, и
    // следующий тест молча ехал старым путём.
    return { uid, uuid: await cloudNote(uid) };
  }

  it('network_post: сервер прибавил, ответ потерян — повтор не удваивает, новая прибавка ложится', async () => {
    const { uid, uuid } = await setup();
    const base = counters(uuid);

    runner.interceptor.setStep('device_b_edit');
    runner.interceptor.armFault('network_post', 'device_b_edit', 'documents');
    const err = await after(uid, uuid, 1, 30).catch(e => e);
    runner.interceptor.clearArmedFault();
    runner.interceptor.setStep('initial_write');
    expect(isStatsDeltaQueued(err)).toBe(true);
    expect(pendingStatsDeltas(uid, uuid)).toHaveLength(1);
    expect(counters(uuid)).toEqual({ sessions: base.sessions + 1, duration: base.duration + 30 });

    await after(uid, uuid, 1, 10);
    expect(counters(uuid)).toEqual({ sessions: base.sessions + 2, duration: base.duration + 40 });
    expect(pendingStatsDeltas(uid, uuid)).toHaveLength(0);
  });

  it('network_pre: ничего не легло — повтор доносит прибавку ровно один раз', async () => {
    const { uid, uuid } = await setup();
    const base = counters(uuid);

    runner.interceptor.setStep('device_b_edit');
    runner.interceptor.armFault('network_pre', 'device_b_edit', 'documents');
    await after(uid, uuid, 1, 30).catch(() => undefined);
    runner.interceptor.clearArmedFault();
    runner.interceptor.setStep('initial_write');
    expect(counters(uuid)).toEqual(base);

    await after(uid, uuid, 1, 10);
    expect(counters(uuid)).toEqual({ sessions: base.sessions + 2, duration: base.duration + 40 });
  });

  it('заметки в облаке нет — прибавка ждёт в журнале', async () => {
    const { uid } = await setup();
    await after(uid, 'not-in-cloud-yet', 1, 30);
    expect(pendingStatsDeltas(uid, 'not-in-cloud-yet')).toHaveLength(1);
  });

  it('ревью SYNC2: журнал прибавок не записался — прибавка уходит из памяти, сессия не теряется', async () => {
    const { uid, uuid } = await setup();
    const base = counters(uuid);
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('sync_pending_delta')) throw new DOMException('quota', 'QuotaExceededError');
      return orig.call(this, key, value);
    };
    try {
      await after(uid, uuid, 1, 30);
    } finally {
      Storage.prototype.setItem = orig;
    }
    expect(counters(uuid)).toEqual({ sessions: base.sessions + 1, duration: base.duration + 30 });
  });
});

